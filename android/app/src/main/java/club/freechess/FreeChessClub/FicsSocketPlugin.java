package club.freechess.FreeChessClub;

import android.util.Base64;
import android.util.Log;
import android.content.Intent;
import android.os.SystemClock;
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

    @Override
    public void load() {
        notifications = new FicsNotifications(getContext());
        keepAliveTimer.scheduleWithFixedDelay(this::sendKeepAlives, 1, 1, TimeUnit.MINUTES);
    }

    private final ScheduledExecutorService keepAliveTimer = Executors.newSingleThreadScheduledExecutor();

    @PluginMethod
    public synchronized void authenticated(PluginCall call) {
        Connection connection = connections.get(call.getString("id"));
        if (connection != null) synchronized (connection) {
            if (!connection.ended) connection.keepAlive.start(SystemClock.elapsedRealtime());
        }
        call.resolve();
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
    protected void handleOnPause() { notifications.background(true); }

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
        for (Connection previous : connections.values()) previous.stopAndCancel();
        connections.clear();
        notifications.begin(id);
        Connection connection = new Connection(id);
        connections.put(id, connection);
        // Fixed destination: this bridge is not a general-purpose network proxy.
        connection.socket = client.newWebSocket(new Request.Builder()
            .url("wss://www.freechess.org:5001")
            .header("Origin", "https://localhost")
            .build(), connection);
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
        try {
            if (!connection.socket.send(ByteString.of(Base64.decode(data, Base64.NO_WRAP)))) {
                call.reject("Socket is closing");
                return;
            }
            call.resolve();
        } catch (IllegalArgumentException exception) {
            call.reject("Invalid socket data");
        }
    }

    @PluginMethod
    public synchronized void close(PluginCall call) {
        Connection connection = connections.get(call.getString("id"));
        if (connection != null) {
            connection.finish(1000, "", true);
            connection.socket.close(1000, "");
        }
        call.resolve();
    }

    @PluginMethod
    public synchronized void dispose(PluginCall call) {
        Connection connection = connections.remove(call.getString("id"));
        if (connection != null) { notifications.end(connection.id); connection.stopAndCancel(); }
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
        notifications.background(false);
        // Resignal even if WebView discarded the earlier notification while
        // suspended. Payloads live in our bounded native queue, not JS callbacks.
        for (Connection connection : connections.values()) connection.signal();
    }

    @Override
    protected synchronized void handleOnDestroy() {
        for (Connection connection : connections.values()) connection.stopAndCancel();
        connections.clear();
        keepAliveTimer.shutdownNow();
        notifications.begin(null);
        client.dispatcher().executorService().shutdown();
        client.connectionPool().evictAll();
    }

    private final class Connection extends WebSocketListener {
        private static final int MAX_BYTES = 2 * 1024 * 1024;
        private static final int MAX_EVENTS = 4096;
        private final String id;
        private final ArrayDeque<JSObject> events = new ArrayDeque<>();
        private final FicsNotificationParser alerts;
        private final FicsTimeseal timeseal = new FicsTimeseal();
        private final long startedAt = SystemClock.elapsedRealtime();
        private final FicsKeepAlive keepAlive = new FicsKeepAlive();
        private WebSocket socket;
        private int queuedBytes;
        private boolean notificationPending;
        private boolean ended;

        Connection(String id) {
            this.id = id;
            alerts = new FicsNotificationParser(new FicsNotificationParser.Sink() {
                public void show(FicsNotificationParser.Event event) { notifications.show(id, event); }
                public void remove(String key) { notifications.remove(id, key); }
            });
        }

        private void recordDisconnect(int code, String category) {
            Log.i("FicsSocket", "Disconnect: " + category + ", code=" + code
                + ", ageSeconds=" + (SystemClock.elapsedRealtime() - startedAt) / 1000
                + ", queuedEvents=" + events.size() + ", queuedSize=" + queuedBytes);
        }

        synchronized void stopAndCancel() {
            ended = true;
            keepAlive.stop();
            if (socket != null) socket.cancel();
        }

        synchronized void sendKeepAlive() {
            if (ended || !keepAlive.due(SystemClock.elapsedRealtime())) return;
            if (!socket.send(ByteString.of(FicsTimeseal.command("ping", System.currentTimeMillis())))) {
                finish(1006, "FICS keepalive could not be sent", false);
                socket.cancel();
            }
        }

        @Override
        public void onOpen(WebSocket webSocket, Response response) {
            enqueue(new JSObject().put("type", "open"));
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
        public void onClosed(WebSocket webSocket, int code, String reason) {
            finish(code, reason, true);
        }

        @Override
        public synchronized void onFailure(WebSocket webSocket, Throwable error, Response response) {
            if (ended) return;
            enqueue(new JSObject().put("type", "error"));
            finish(1006, "Connection lost", false);
        }

        private synchronized void finish(int code, String reason, boolean clean) {
            if (ended) return;
            recordDisconnect(code, clean ? "remote close" : "transport failure");
            keepAlive.stop();
            enqueue(new JSObject().put("type", "close").put("code", code)
                .put("reason", reason).put("wasClean", clean));
            ended = true;
            notifications.end(id);
        }

        private synchronized void enqueue(JSObject event) {
            if (ended) return;
            int size = event.toString().length();
            if (queuedBytes + size > MAX_BYTES || events.size() >= MAX_EVENTS) {
                // Never silently discard chess events and pretend the session is
                // synchronized. Report a recoverable failure if buffering fills.
                recordDisconnect(1009, "background buffer full");
                keepAlive.stop();
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
