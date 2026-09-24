package club.freechess.FreeChessClub;

import android.util.Base64;
import android.content.Intent;
import android.os.SystemClock;
import android.os.Build;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkRequest;
import android.net.NetworkCapabilities;
import android.content.Context;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ScheduledFuture;
import android.util.Log;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okio.ByteString;

/**
 * Native transport in the app process protected by the existing foreground
 * service. No browser socket or JS timer is needed to keep this connection alive.
 * Activity/page destruction ends the session; freezing/resuming does not.
 */
@CapacitorPlugin(name = "FicsSocket")
public class FicsSocketPlugin extends Plugin {
    private final Map<String, Connection> connections = new HashMap<>();
    private final OkHttpClient client = new OkHttpClient.Builder()
        .pingInterval(30, TimeUnit.SECONDS)
        .build();

    private FicsNotifications notifications;
    private volatile boolean background, recoveryEnabled;
    private ConnectivityManager connectivity;
    private ConnectivityManager.NetworkCallback networkCallback;
    private final ScheduledExecutorService keepAliveTimer = Executors.newSingleThreadScheduledExecutor();

    @Override
    public void load() {
        notifications = new FicsNotifications(getContext());
        connectivity = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override public void onAvailable(Network network) { retryWhenAvailable(); }
            @Override public void onLost(Network network) {
                synchronized (FicsSocketPlugin.this) {
                    if (!networkAvailable()) {
                        for (Connection connection : connections.values()) {
                            synchronized (connection) {
                                if (connection.hasLogin && !connection.recovering) connection.transportLost("Network unavailable");
                            }
                        }
                    }
                }
            }
        };
        if (Build.VERSION.SDK_INT >= 24) connectivity.registerDefaultNetworkCallback(networkCallback);
        else connectivity.registerNetworkCallback(new NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET).build(), networkCallback);
        keepAliveTimer.scheduleWithFixedDelay(this::sendKeepAlives, 1, 1, TimeUnit.MINUTES);
    }

    // JS arms this only after login; it must never send commands at a password prompt.
    @PluginMethod
    public synchronized void authenticated(PluginCall call) {
        Connection connection = connections.get(call.getString("id"));
        if (connection == null) { call.reject("Socket unavailable"); return; }
        synchronized (connection) {
            if (connection.ended || call.getInt("generation", -1) != connection.generation) { call.resolve(); return; }
            connection.loginUser = call.getString("user", "guest");
            connection.loginPassword = call.getString("password", "");
            connection.registered = Boolean.TRUE.equals(call.getBoolean("registered"));
            connection.initialCommands.clear();
            JSArray commands = call.getArray("commands", new JSArray());
            for (int i = 0; i < commands.length(); i++) {
                String command = commands.optString(i);
                // Only idempotent protocol settings are replayed, never arbitrary moves/tells.
                if (command.matches("(?:set (?:seek|echo|style|interface)|iset (?:defprompt|nowrap|pendinfo|ms)) [^\r\n]*"))
                    connection.initialCommands.add(command);
            }
            recoveryEnabled = Boolean.TRUE.equals(call.getBoolean("backgroundRecovery"));
            connection.hasLogin = true;
            connection.keepAlive.start(SystemClock.elapsedRealtime());
        }
        call.resolve();
    }

    @PluginMethod
    public synchronized void configureRecovery(PluginCall call) {
        recoveryEnabled = Boolean.TRUE.equals(call.getBoolean("enabled"));
        for (Connection connection : connections.values()) connection.resumeRecovery();
        call.resolve();
    }

    private synchronized void retryWhenAvailable() {
        for (Connection connection : connections.values()) connection.resumeRecovery();
    }

    private boolean networkAvailable() {
        if (connectivity == null) return true;
        Network network = connectivity.getActiveNetwork();
        NetworkCapabilities capabilities = network == null ? null : connectivity.getNetworkCapabilities(network);
        return capabilities != null && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    private synchronized void sendKeepAlives() {
        for (Connection connection : connections.values()) connection.sendKeepAlive();
    }

    @PluginMethod
    public void configureNotifications(PluginCall call) {
        notifications.configure(Boolean.TRUE.equals(call.getBoolean("enabled")));
        call.resolve();
    }

    @Override
    protected synchronized void handleOnPause() {
        background = true;
        notifications.background(true);
        if (!recoveryEnabled) for (Connection connection : connections.values()) connection.pauseRecovery();
    }

    @Override
    protected synchronized void handleOnNewIntent(Intent intent) {
        FicsNotifications.Action action = notifications.take(intent);
        if (action == null) return;
        Connection connection = connections.get(action.session);
        if (connection == null) return;
        synchronized (connection) {
            if (connection.ended) return;
            if (!action.command.equals("tap")) {
                if (!connection.alerts.current(action.event)) return;
                if (!connection.socket.send(ByteString.of(FicsTimeseal.command(
                        action.command + " " + action.event.offerId, System.currentTimeMillis())))) return;
                connection.alerts.consume(action.event);
            }
        }
        notifyListeners("notificationAction", new JSObject().put("actionId", "tap").put("target", action.target()), true);
    }

    @PluginMethod
    public synchronized void connect(PluginCall call) {
        String id = call.getString("id");
        if (id == null || connections.containsKey(id)) {
            call.reject("Invalid socket connection");
            return;
        }
        // There is one FICS session per interface. A page reload loses its JS
        // parser, so retire the old connection rather than orphaning a login.
        for (Connection previous : connections.values()) previous.stopKeepAliveAndCancel();
        connections.clear();
        notifications.begin(id);
        Connection connection = new Connection(id);
        connections.put(id, connection);
        connection.openSocket();
        call.resolve();
    }

    @PluginMethod
    public synchronized void send(PluginCall call) {
        Connection connection = connections.get(call.getString("id"));
        String data = call.getString("data");
        if (connection == null || data == null) {
            call.reject("Socket unavailable");
            return;
        }
        synchronized (connection) {
            if (connection.ended || connection.recovering || call.getInt("generation", -1) != connection.generation) {
                call.resolve(); // A command from the old UI session must never reach a new socket.
                return;
            }
            String command = call.getString("command", "").trim();
            if (command.matches("(?i)(?:quit|exit|bye)")) connection.intentional = true;
            try {
                if (!connection.socket.send(ByteString.of(Base64.decode(data, Base64.NO_WRAP)))) {
                    connection.transportLost("Socket is closing");
                }
                call.resolve();
            } catch (IllegalArgumentException exception) { call.reject("Invalid socket data"); }
        }
    }

    @PluginMethod
    public synchronized void close(PluginCall call) {
        Connection connection = connections.get(call.getString("id"));
        if (connection != null) {
            synchronized (connection) { connection.intentional = true; connection.finish(1000, "", true); }
            notifications.end(connection.id);
            connection.socket.close(1000, "");
        }
        call.resolve();
    }

    @PluginMethod
    public synchronized void dispose(PluginCall call) {
        Connection connection = connections.remove(call.getString("id"));
        if (connection != null) { notifications.end(connection.id); connection.stopKeepAliveAndCancel(); }
        call.resolve();
    }

    @PluginMethod
    public synchronized void drain(PluginCall call) {
        String id = call.getString("id");
        Connection connection = connections.get(id);
        if (connection == null) {
            call.resolve(new JSObject().put("events", new JSArray()).put("more", false));
            return;
        }
        JSObject result = connection.drain();
        if (connection.isFinished()) connections.remove(id);
        call.resolve(result);
    }

    @Override
    protected synchronized void handleOnResume() {
        background = false;
        notifications.background(false);
        for (Connection connection : connections.values()) connection.resumeRecovery();
        // Resignal even if WebView discarded the earlier notification while
        // suspended. Payloads live in our bounded native queue, not JS callbacks.
        for (Connection connection : connections.values()) connection.signal();
    }

    @Override
    protected synchronized void handleOnDestroy() {
        if (connectivity != null && networkCallback != null) connectivity.unregisterNetworkCallback(networkCallback);
        for (Connection connection : connections.values()) connection.stopKeepAliveAndCancel();
        keepAliveTimer.shutdownNow();
        connections.clear();
        notifications.begin(null);
        client.dispatcher().executorService().shutdown();
        client.connectionPool().evictAll();
    }

    private final class Connection extends WebSocketListener {
        private static final int MAX_BYTES = 2 * 1024 * 1024;
        private static final int MAX_EVENTS = 4096;
        private final String id;
        private final ArrayDeque<JSObject> events = new ArrayDeque<>();
        private FicsNotificationParser alerts;
        private final FicsKeepAlive keepAlive = new FicsKeepAlive();
        private final long startedAt = SystemClock.elapsedRealtime();
        private FicsTimeseal timeseal = new FicsTimeseal();
        private WebSocket socket;
        private WebSocket.Factory socketFactory = client;
        private int generation = 1;
        private boolean hasLogin, registered, recovering, intentional;
        private String loginUser = "guest", loginPassword = "";
        private final List<String> initialCommands = new ArrayList<>();
        private final FicsRetryPolicy retryPolicy = new FicsRetryPolicy();
        private ScheduledFuture<?> retryTask, loginTimeout;
        private FicsLogin login;
        private int queuedBytes;
        private boolean notificationPending;
        private boolean ended;

        Connection(String id) {
            this.id = id;
            resetAlerts();
        }

        private void resetAlerts() {
            alerts = new FicsNotificationParser(new FicsNotificationParser.Sink() {
                public void show(FicsNotificationParser.Event event) { notifications.show(id, event); }
                public void remove(String key) { notifications.remove(id, key); }
            });
        }

        synchronized void stopKeepAliveAndCancel() {
            intentional = true;
            ended = true;
            stopTimers();
            clearCredentials();
            if (socket != null) socket.cancel();
        }

        private void clearCredentials() { loginUser = "guest"; loginPassword = ""; login = null; hasLogin = false; }
        private void stopTimers() {
            keepAlive.stop();
            if (retryTask != null) retryTask.cancel(false);
            if (loginTimeout != null) loginTimeout.cancel(false);
            retryTask = null; loginTimeout = null;
        }

        synchronized void openSocket() {
            if (ended || intentional) return;
            final int attempt = generation;
            timeseal = new FicsTimeseal();
            WebSocketListener listener = new WebSocketListener() {
                @Override public void onOpen(WebSocket ws, Response response) {
                    synchronized (Connection.this) { if (generation == attempt && !ended) Connection.this.onOpen(ws, response); else ws.cancel(); }
                }
                @Override public void onMessage(WebSocket ws, String text) {
                    synchronized (Connection.this) { if (generation == attempt && !ended) Connection.this.onMessage(ws, text); }
                }
                @Override public void onMessage(WebSocket ws, ByteString bytes) {
                    synchronized (Connection.this) { if (generation == attempt && !ended) Connection.this.onMessage(ws, bytes); }
                }
                @Override public void onClosing(WebSocket ws, int code, String reason) {
                    synchronized (Connection.this) { if (generation == attempt && !ended) Connection.this.onClosing(ws, code, reason); }
                }
                @Override public void onClosed(WebSocket ws, int code, String reason) {
                    synchronized (Connection.this) { if (generation == attempt && !ended) Connection.this.onClosed(ws, code, reason); }
                }
                @Override public void onFailure(WebSocket ws, Throwable error, Response response) {
                    synchronized (Connection.this) { if (generation == attempt && !ended) Connection.this.onFailure(ws, error, response); }
                }
            };
            socket = socketFactory.newWebSocket(new Request.Builder()
                .url("wss://www.freechess.org:5001").header("Origin", "https://localhost").build(), listener);
            if (recovering) {
                loginTimeout = keepAliveTimer.schedule(() -> {
                    synchronized (Connection.this) {
                        if (!ended && recovering && generation == attempt) transportLost("FICS login timed out");
                    }
                }, 30, TimeUnit.SECONDS);
            }
        }

        synchronized void pauseRecovery() {
            if (retryTask != null) retryTask.cancel(false);
            retryTask = null;
            if (recovering && loginTimeout != null) {
                generation++;
                stopTimers();
                if (socket != null) socket.cancel();
                replaceWithReconnectEvent("Waiting for the app to return to the foreground");
            }
        }

        synchronized void resumeRecovery() {
            if (!recovering || ended || intentional) return;
            if (background && !recoveryEnabled) { pauseRecovery(); return; }
            if (loginTimeout != null || retryTask != null) return;
            scheduleRetry(0);
        }

        private void scheduleRetry(long delay) {
            if (ended || intentional || (background && !recoveryEnabled)) return;
            retryTask = keepAliveTimer.schedule(() -> {
                synchronized (FicsSocketPlugin.this) {
                    synchronized (Connection.this) {
                        retryTask = null;
                        if (ended || intentional || (background && !recoveryEnabled)) return;
                        if (!networkAvailable()) { scheduleRetry(retryPolicy.nextDelay()); return; }
                        openSocket();
                    }
                }
            }, delay, TimeUnit.MILLISECONDS);
        }

        private void replaceWithReconnectEvent(String reason) {
            ArrayDeque<JSObject> history = new ArrayDeque<>();
            for (JSObject event : events) {
                if ("message".equals(event.optString("type"))) history.add(event.put("historical", true));
            }
            events.clear(); queuedBytes = 0; notificationPending = false;
            enqueue(new JSObject().put("type", "reconnecting").put("reason", reason));
            for (JSObject event : history) enqueue(event);
        }

        private synchronized void transportLost(String reason) {
            if (ended) return;
            if (!hasLogin || intentional) { finish(1006, reason, false); return; }
            recordDisconnect(1006, "retrying transport");
            generation++; // Invalidates callbacks, UI commands, and actions from the old socket.
            stopTimers();
            if (socket != null) socket.cancel();
            recovering = true;
            login = null;
            resetAlerts();
            notifications.begin(id);
            notifications.connectionState("Reconnecting to FICS", "Waiting to restore your connection.");
            replaceWithReconnectEvent(reason);
            scheduleRetry(retryPolicy.nextDelay());
        }

        synchronized void sendKeepAlive() {
            if (ended || !keepAlive.due(SystemClock.elapsedRealtime())) return;
            if (!socket.send(ByteString.of(FicsTimeseal.command("ping", System.currentTimeMillis())))) {
                transportLost("FICS keepalive could not be sent");
            }
        }

        private void recordDisconnect(int code, String category) {
            // Metadata only: do not log incoming messages, credentials, or raw exception text.
            Log.i("FicsSocket", "Disconnect: " + category + ", code=" + code
                + ", ageSeconds=" + (SystemClock.elapsedRealtime() - startedAt) / 1000
                + ", queuedEvents=" + events.size() + ", queuedSize=" + queuedBytes);
        }

        @Override
        public synchronized void onOpen(WebSocket webSocket, Response response) {
            if (!recovering) { enqueue(new JSObject().put("type", "open")); return; }
            login = new FicsLogin(loginUser, loginPassword, registered, new FicsLogin.Listener() {
                public void send(String command) { sendLoginCommand(webSocket, command); }
                public void rejected(String reason) { finish(1008, reason, true); webSocket.cancel(); }
                public void ready(String user, byte[] remainder) {
                    if (loginTimeout != null) loginTimeout.cancel(false);
                    loginTimeout = null;
                    for (String command : initialCommands) {
                        if (!sendLoginCommand(webSocket, command)) return;
                    }
                    notifications.connectionState("Connected as " + user, "Keeping your game connection active.");
                    recovering = false;
                    login = null;
                    retryPolicy.reset();
                    keepAlive.start(SystemClock.elapsedRealtime());
                    enqueue(new JSObject().put("type", "reconnected").put("user", user).put("registered", registered));
                    deliver(remainder);
                }
            });
            sendLoginCommand(webSocket, "TIMESEAL2|freeseal|icsgo|");
        }

        private boolean sendLoginCommand(WebSocket webSocket, String command) {
            if (webSocket.send(ByteString.of(FicsTimeseal.command(command, System.currentTimeMillis())))) return true;
            transportLost("FICS login command could not be sent");
            return false;
        }

        @Override
        public void onMessage(WebSocket webSocket, String text) {
            receive(webSocket, text.getBytes(StandardCharsets.UTF_8));
        }

        @Override
        public void onMessage(WebSocket webSocket, ByteString bytes) {
            receive(webSocket, bytes.toByteArray());
        }

        private synchronized void receive(WebSocket webSocket, byte[] bytes) {
            if (ended) return;
            byte[] payload = timeseal.receive(bytes, () -> webSocket.send(
                ByteString.of(FicsTimeseal.acknowledgement(System.currentTimeMillis()))));
            if (payload.length == 0) return;
            if (recovering) {
                if (login != null) login.receive(payload);
                return;
            }
            deliver(payload);
        }

        private void deliver(byte[] payload) {
            if (payload.length == 0 || ended) return;
            alerts.receive(payload);
            enqueue(new JSObject().put("type", "message")
                .put("data", Base64.encodeToString(payload, Base64.NO_WRAP)));
        }

        @Override
        public synchronized void onClosing(WebSocket webSocket, int code, String reason) {
            keepAlive.stop();
            webSocket.close(code == 1005 ? 1000 : code, reason);
        }

        @Override
        public synchronized void onClosed(WebSocket webSocket, int code, String reason) {
            if (hasLogin && !intentional) transportLost(reason.isEmpty() ? "FICS connection closed" : reason);
            else finish(code, reason, true);
        }

        @Override
        public synchronized void onFailure(WebSocket webSocket, Throwable error, Response response) {
            if (ended) return;
            if (!hasLogin) enqueue(new JSObject().put("type", "error"));
            transportLost("Connection lost (" + error.getClass().getSimpleName() + ")");
        }

        private synchronized void finish(int code, String reason, boolean clean) {
            if (ended) return;
            recordDisconnect(code, clean ? "remote close" : "transport failure");
            stopTimers();
            clearCredentials();
            enqueue(new JSObject().put("type", "close").put("code", code)
                .put("reason", reason).put("wasClean", clean));
            ended = true;
            notifications.end(id);
            if (!intentional) notifications.connectionState("Disconnected from FICS", "Open the app to reconnect.");
        }

        private synchronized void enqueue(JSObject event) {
            if (ended) return;
            event.put("generation", generation);
            int size = event.toString().length();
            if (queuedBytes + size > MAX_BYTES || events.size() >= MAX_EVENTS) {
                // Never silently discard chess events and pretend the session is
                // synchronized. Report a recoverable failure if buffering fills.
                recordDisconnect(1009, "background buffer full");
                stopTimers();
                clearCredentials();
                events.clear();
                events.add(new JSObject().put("type", "error"));
                events.add(new JSObject().put("type", "close").put("code", 1009)
                    .put("reason", "Background message buffer full").put("wasClean", false));
                queuedBytes = 0;
                ended = true;
                notifications.end(id);
                if (socket != null) socket.cancel();
            } else {
                events.add(event);
                queuedBytes += size;
            }
            if (!notificationPending) signal();
        }

        synchronized void signal() {
            if (events.isEmpty()) return;
            notificationPending = true;
            notifyListeners("available", new JSObject().put("id", id));
        }

        synchronized JSObject drain() {
            JSArray batch = new JSArray();
            while (!events.isEmpty() && batch.length() < 64) {
                JSObject event = events.remove();
                queuedBytes = Math.max(0, queuedBytes - event.toString().length());
                batch.put(event);
            }
            notificationPending = !events.isEmpty();
            return new JSObject().put("events", batch).put("more", !events.isEmpty());
        }

        synchronized boolean isFinished() { return ended && events.isEmpty(); }
    }
}
