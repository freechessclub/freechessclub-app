package club.freechess.FreeChessClub;

import static org.junit.Assert.*;
import android.content.Context;
import android.os.SystemClock;
import android.util.Base64;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.lang.reflect.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import okhttp3.*;
import okio.ByteString;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Controlled server, real plugin scheduler/login/queue, and a frozen real WebView. */
@RunWith(AndroidJUnit4.class)
public class NativeReconnectTest {
    static Object get(Object object, String name) throws Exception {
        Field field = object.getClass().getDeclaredField(name); field.setAccessible(true); return field.get(object);
    }
    static void set(Object object, String name, Object value) throws Exception {
        Field field = object.getClass().getDeclaredField(name); field.setAccessible(true); field.set(object, value);
    }
    static PluginCall call(JSObject data) {
        return new PluginCall(null, "FicsSocket", "fixture", "fixture", data) {
            @Override public void resolve() { }
            @Override public void resolve(JSObject value) { }
            @Override public void reject(String reason) { throw new AssertionError(reason); }
        };
    }
    static final class Server implements WebSocket.Factory, AutoCloseable {
        final ScheduledExecutorService executor = Executors.newSingleThreadScheduledExecutor();
        final List<Socket> sockets = new CopyOnWriteArrayList<>();
        volatile boolean rejectPassword;
        public WebSocket newWebSocket(Request request, WebSocketListener listener) {
            Socket socket = new Socket(this, listener); sockets.add(socket);
            executor.schedule(() -> listener.onOpen(socket, null), 20, TimeUnit.MILLISECONDS);
            return socket;
        }
        public void close() { executor.shutdownNow(); }
    }
    static final class Socket implements WebSocket {
        final Server server;
        final WebSocketListener listener;
        final List<String> commands = new CopyOnWriteArrayList<>();
        volatile boolean cancelled;
        Socket(Server server, WebSocketListener listener) { this.server = server; this.listener = listener; }
        public Request request() { return null; }
        public long queueSize() { return 0; }
        public boolean send(String text) { throw new AssertionError("Expected timeseal command"); }
        public boolean send(ByteString bytes) {
            if (cancelled) return false;
            String command = NativeNotificationTest.decode(bytes.toByteArray());
            commands.add(command);
            if (command.startsWith("TIMESEAL2|")) emit("Welcome\nlogin:");
            else if (command.equals("guest")) emit("Press return to enter the server as GuestBBBB");
            else if (command.equals("")) emit("**** Starting FICS session as GuestBBBB(U) ****\nfics% ");
            else if (command.equals("Alice")) emit("password:");
            else if (command.equals("fixture-password")) emit(server.rejectPassword ? "**** Invalid password! ****\nlogin:" : "**** Starting FICS session as Alice ****\nfics% ");
            return true;
        }
        void emit(String text) { server.executor.schedule(() -> { if (!cancelled && listener != null) listener.onMessage(this, text); }, 10, TimeUnit.MILLISECONDS); }
        public boolean close(int code, String reason) { cancelled = true; return true; }
        public void cancel() { cancelled = true; }
    }
    static void waitFor(java.util.function.BooleanSupplier condition) {
        long deadline = SystemClock.elapsedRealtime() + 10000;
        while (!condition.getAsBoolean() && SystemClock.elapsedRealtime() < deadline) SystemClock.sleep(50);
        assertTrue("Timed out waiting for native recovery", condition.getAsBoolean());
    }
    static String evaluate(MainActivity activity, String script) throws Exception {
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> activity.getBridge().getWebView().evaluateJavascript(script, value -> { result.set(value); latch.countDown(); }));
        assertTrue(latch.await(10, TimeUnit.SECONDS)); return result.get();
    }
    static final class Fixture implements AutoCloseable {
        final String id = "recovery-fixture-" + UUID.randomUUID();
        final FicsSocketPlugin plugin;
        final Object connection;
        final WebSocketListener listener;
        final Server server = new Server();
        final Socket original = new Socket(server, null);
        final Map connections;
        Fixture(FicsSocketPlugin plugin, boolean registered) throws Exception {
            this.plugin = plugin;
            Class<?> type = Class.forName("club.freechess.FreeChessClub.FicsSocketPlugin$Connection");
            Constructor<?> constructor = type.getDeclaredConstructor(FicsSocketPlugin.class, String.class);
            constructor.setAccessible(true); connection = constructor.newInstance(plugin, id);
            listener = (WebSocketListener) connection;
            set(connection, "socket", original); set(connection, "socketFactory", server);
            connections = (Map) get(plugin, "connections");
            synchronized (plugin) { connections.put(id, connection); }
            ((FicsNotifications) get(plugin, "notifications")).begin(id);
            JSArray commands = new JSArray(); commands.put("set style 12"); commands.put("iset pendinfo 1"); commands.put("accept 99");
            plugin.authenticated(call(new JSObject().put("id", id).put("generation", 1)
                .put("user", registered ? "Alice" : "guest").put("password", registered ? "fixture-password" : "")
                .put("registered", registered).put("backgroundRecovery", true).put("commands", commands)));
        }
        void lose() { listener.onFailure(original, new java.io.IOException("Synthetic network loss"), null); }
        boolean recovering() { try { synchronized (connection) { return (boolean) get(connection, "recovering"); } } catch (Exception e) { throw new AssertionError(e); } }
        boolean ended() { try { synchronized (connection) { return (boolean) get(connection, "ended"); } } catch (Exception e) { throw new AssertionError(e); } }
        int generation() throws Exception { synchronized (connection) { return (int) get(connection, "generation"); } }
        void command(int generation, String command) {
            plugin.send(call(new JSObject().put("id", id).put("generation", generation).put("command", command)
                .put("data", Base64.encodeToString(FicsTimeseal.command(command, 0), Base64.NO_WRAP))));
        }
        public void close() { plugin.dispose(call(new JSObject().put("id", id))); server.close(); }
    }
    @Test public void disabledBackgroundRecoveryWaitsAndNewSessionPostsAlerts() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        Context context = instrumentation.getTargetContext();
        instrumentation.getUiAutomation().grantRuntimePermission(context.getPackageName(), "android.permission.POST_NOTIFICATIONS");
        MainActivity activity = (MainActivity) instrumentation.startActivitySync(context.getPackageManager().getLaunchIntentForPackage(context.getPackageName()));
        SystemClock.sleep(5000);
        FicsSocketPlugin plugin = (FicsSocketPlugin) activity.getBridge().getPlugin("FicsSocket").getInstance();
        FicsNotifications notifications = (FicsNotifications) get(plugin, "notifications");
        boolean previousEnabled = (boolean) get(notifications, "enabled");
        boolean previousRecovery = (boolean) get(plugin, "recoveryEnabled");
        try (Fixture f = new Fixture(plugin, true)) {
            set(plugin, "background", true);
            notifications.configure(true); notifications.background(true);
            plugin.configureRecovery(call(new JSObject().put("enabled", false)));
            f.listener.onMessage(f.original, "\n<pf> 71 w=Alice t=match p=Alice (1500) Guest (----) unrated blitz 5 0\n");
            assertFalse(((Map) get(notifications, "actions")).isEmpty());
            f.lose();
            SystemClock.sleep(1200);
            assertTrue(f.server.sockets.isEmpty());
            assertNull(get(f.connection, "retryTask"));
            assertTrue(((Map) get(notifications, "actions")).isEmpty());
            plugin.configureRecovery(call(new JSObject().put("enabled", true)));
            waitFor(() -> !f.server.sockets.isEmpty() && !f.recovering());
            Socket replacement = f.server.sockets.get(0);
            replacement.emit("\nBob tells you: message after recovery\nfics% ");
            android.app.NotificationManager manager = context.getSystemService(android.app.NotificationManager.class);
            waitFor(() -> Arrays.stream(manager.getActiveNotifications()).anyMatch(item ->
                "Message from Bob".equals(item.getNotification().extras.getString(android.app.Notification.EXTRA_TITLE))));
        } finally {
            set(plugin, "background", false);
            notifications.background(false); notifications.configure(previousEnabled);
            plugin.configureRecovery(call(new JSObject().put("enabled", previousRecovery)));
        }
    }

    @Test public void recoversWhileFrozenAndRejectsStaleCommands() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        Context context = instrumentation.getTargetContext();
        instrumentation.getUiAutomation().grantRuntimePermission(context.getPackageName(), "android.permission.POST_NOTIFICATIONS");
        MainActivity activity = (MainActivity) instrumentation.startActivitySync(context.getPackageManager().getLaunchIntentForPackage(context.getPackageName()));
        SystemClock.sleep(5000);
        FicsSocketPlugin plugin = (FicsSocketPlugin) activity.getBridge().getPlugin("FicsSocket").getInstance();
        try (Fixture f = new Fixture(plugin, true)) {
            evaluate(activity, "window.recoveryBackgroundSetting=document.querySelector('#foreground-service-toggle').checked;if(!window.recoveryBackgroundSetting)document.querySelector('#foreground-service-toggle').click();");
            evaluate(activity, "window.recoveryFrozen=false;document.addEventListener('freeze',()=>window.recoveryFrozen=true);window.recoverySound=document.querySelector('#sound-toggle')?.textContent.includes('ON');if(window.recoverySound)document.querySelector('#sound-toggle').click();");
            instrumentation.runOnMainSync(() -> activity.moveTaskToBack(true));
            SystemClock.sleep(80000);
            assertTrue("Background recovery preference changed", (boolean) get(plugin, "recoveryEnabled"));
            f.listener.onMessage(f.original, "Alice tells you: chat before network loss\nfics% ");
            f.lose();
            try { waitFor(() -> !f.server.sockets.isEmpty() && !f.recovering()); }
            catch (AssertionError failure) {
                Object retry = get(f.connection, "retryTask");
                if (retry instanceof Future && ((Future<?>) retry).isDone()) ((Future<?>) retry).get();
                throw new AssertionError("Recovery failed: enabled=" + get(plugin, "recoveryEnabled")
                    + ", retry=" + retry + ", loginTimeout=" + get(f.connection, "loginTimeout")
                    + ", sockets=" + f.server.sockets.size()
                    + ", commands=" + (f.server.sockets.isEmpty() ? "none" : f.server.sockets.get(0).commands), failure);
            }
            Socket replacement = f.server.sockets.get(0);
            assertEquals(List.of("TIMESEAL2|freeseal|icsgo|", "Alice", "fixture-password", "set style 12", "iset pendinfo 1"), replacement.commands);
            f.command(1, "accept 7");
            assertFalse(replacement.commands.contains("accept 7"));
            f.command(f.generation(), "date");
            assertTrue(replacement.commands.contains("date"));
            synchronized (f.connection) {
                ArrayDeque<JSObject> events = (ArrayDeque<JSObject>) get(f.connection, "events");
                assertEquals("reconnecting", events.peek().optString("type"));
                assertTrue(events.stream().anyMatch(e -> e.optBoolean("historical") && e.optString("type").equals("message")));
                assertTrue(events.stream().anyMatch(e -> e.optString("type").equals("reconnected") && e.optString("user").equals("Alice")));
            }
            // Fail again, then deliver an old callback after a newer socket is ready.
            replacement.listener.onFailure(replacement, new java.io.IOException(), null);
            waitFor(() -> f.server.sockets.size() == 2 && !f.recovering());
            int generation = f.generation();
            replacement.listener.onFailure(replacement, new java.io.IOException(), null);
            assertEquals(generation, f.generation());
            assertFalse(f.recovering());
            instrumentation.runOnMainSync(() -> activity.startActivity(context.getPackageManager().getLaunchIntentForPackage(context.getPackageName())));
            assertEquals("true", evaluate(activity, "window.recoveryFrozen"));
        } finally {
            instrumentation.runOnMainSync(() -> activity.startActivity(context.getPackageManager().getLaunchIntentForPackage(context.getPackageName())));
            evaluate(activity, "if(document.querySelector('#foreground-service-toggle').checked!==window.recoveryBackgroundSetting)document.querySelector('#foreground-service-toggle').click();");
            evaluate(activity, "if(window.recoverySound&&!document.querySelector('#sound-toggle')?.textContent.includes('ON'))document.querySelector('#sound-toggle').click();");
        }
        try (Fixture guest = new Fixture(plugin, false)) {
            guest.lose(); waitFor(() -> !guest.server.sockets.isEmpty() && !guest.recovering());
            assertEquals(List.of("TIMESEAL2|freeseal|icsgo|", "guest", "", "set style 12", "iset pendinfo 1"), guest.server.sockets.get(0).commands);
        }
        try (Fixture rejected = new Fixture(plugin, true)) {
            rejected.server.rejectPassword = true;
            rejected.lose(); waitFor(rejected::ended);
            assertEquals("", get(rejected.connection, "loginPassword"));
            assertNull(get(rejected.connection, "retryTask"));
            assertEquals(1, rejected.server.sockets.size());
        }
        try (Fixture cancelled = new Fixture(plugin, true)) {
            cancelled.lose(); plugin.close(call(new JSObject().put("id", cancelled.id)));
            SystemClock.sleep(1200);
            assertTrue(cancelled.server.sockets.isEmpty());
            assertEquals("", get(cancelled.connection, "loginPassword"));
        }
        android.util.Log.i("FCC_NATIVE_RECONNECT_TEST", "PASS: frozen WebView recovery, registered/guest login, settings replay, history, stale-command/callback rejection, bad credentials, explicit close");
    }
}
