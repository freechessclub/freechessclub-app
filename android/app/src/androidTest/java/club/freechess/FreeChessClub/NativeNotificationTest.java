package club.freechess.FreeChessClub;

import static org.junit.Assert.*;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;
import android.service.notification.StatusBarNotification;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.lang.reflect.*;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import okhttp3.*;
import okio.ByteString;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Synthetic traffic enters the real plugin receive path; no messages go to FICS users. */
@RunWith(AndroidJUnit4.class)
public class NativeNotificationTest {
    static Object field(Object object, String name) throws Exception {
        Field field = object.getClass().getDeclaredField(name); field.setAccessible(true); return field.get(object);
    }
    static final class Socket implements WebSocket {
        final CopyOnWriteArrayList<ByteString> sent = new CopyOnWriteArrayList<>();
        public Request request() { return null; }
        public long queueSize() { return 0; }
        public boolean send(String value) { throw new AssertionError("Expected timeseal binary command"); }
        public boolean send(ByteString value) { sent.add(value); return true; }
        public boolean close(int code, String reason) { return true; }
        public void cancel() { }
    }
    private String evaluate(MainActivity activity, String script) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> activity.getBridge().getWebView().evaluateJavascript(script, value -> { result.set(value); done.countDown(); }));
        assertTrue(done.await(10, TimeUnit.SECONDS));
        return result.get();
    }
    private Notification find(NotificationManager manager, String title) {
        for (StatusBarNotification item : manager.getActiveNotifications())
            if (title.equals(item.getNotification().extras.getString(Notification.EXTRA_TITLE))) return item.getNotification();
        return null;
    }
    private Notification awaitNotification(NotificationManager manager, String title) {
        long deadline = SystemClock.elapsedRealtime() + 5000;
        Notification notification;
        do { notification = find(manager, title); if (notification == null) SystemClock.sleep(100); }
        while (notification == null && SystemClock.elapsedRealtime() < deadline);
        assertNotNull(title, notification); return notification;
    }
    @Test public void frozenPageReceivesNativeAlertsAndActionsStayOnOriginalSession() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        Context context = instrumentation.getTargetContext();
        instrumentation.getUiAutomation().grantRuntimePermission(context.getPackageName(), "android.permission.POST_NOTIFICATIONS");
        MainActivity activity = (MainActivity) instrumentation.startActivitySync(context.getPackageManager().getLaunchIntentForPackage(context.getPackageName()));
        SystemClock.sleep(5000);
        FicsSocketPlugin plugin = (FicsSocketPlugin) activity.getBridge().getPlugin("FicsSocket").getInstance();
        FicsNotifications notifications = (FicsNotifications) field(plugin, "notifications");
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        Map connections = (Map) field(plugin, "connections");
        Class<?> type = Class.forName("club.freechess.FreeChessClub.FicsSocketPlugin$Connection");
        Constructor<?> constructor = type.getDeclaredConstructor(FicsSocketPlugin.class, String.class);
        constructor.setAccessible(true);
        WebSocketListener connection = (WebSocketListener) constructor.newInstance(plugin, "notification-test");
        Socket socket = new Socket();
        Field socketField = type.getDeclaredField("socket"); socketField.setAccessible(true); socketField.set(connection, socket);
        synchronized (plugin) { connections.put("notification-test", connection); }
        notifications.begin("notification-test"); notifications.configure(true);
        try {
            evaluate(activity, "window.notificationTestFrozen=false; document.addEventListener('freeze',()=>window.notificationTestFrozen=true); window.notificationTestSound=document.querySelector('#sound-toggle')?.textContent.includes('ON'); if(window.notificationTestSound)document.querySelector('#sound-toggle').click();");
            instrumentation.runOnMainSync(() -> activity.moveTaskToBack(true));
            // The emulator's WebView freezes hidden pages after about one minute.
            SystemClock.sleep(80000);
            // Make the interval due, then let the real native scheduler fire with
            // JavaScript frozen. No server connection or two-hour wait is needed.
            FicsKeepAlive keepAlive = (FicsKeepAlive) field(connection, "keepAlive");
            synchronized (connection) { keepAlive.start(SystemClock.elapsedRealtime() - FicsKeepAlive.INTERVAL_MS); }
            long pingDeadline = SystemClock.elapsedRealtime() + 65000;
            while (socket.sent.isEmpty() && SystemClock.elapsedRealtime() < pingDeadline) SystemClock.sleep(100);
            assertEquals("Native scheduler did not send FICS keepalive", 1, socket.sent.size());
            assertEquals("ping", decode(socket.sent.get(0).toByteArray()));
            synchronized (connection) { keepAlive.stop(); }
            socket.sent.clear();
            connection.onMessage(socket, "\nAlice tells you: Native background test\nfics% ");
            connection.onMessage(socket, "\n<pf> 71 w=Alice t=match p=Alice (1500) Guest (----) unrated blitz 5 0\n");
            Notification chat = awaitNotification(manager, "Message from Alice");
            Notification offer = awaitNotification(manager, "Match Request");
            assertEquals("Native background test", chat.extras.getString(Notification.EXTRA_TEXT));
            assertEquals(context.getResources().getIdentifier("ic_fcc_notification", "drawable", context.getPackageName()), chat.getSmallIcon().getResId());
            assertEquals(2, offer.actions.length);
            PendingIntent withdrawn = offer.actions[0].actionIntent;
            connection.onMessage(socket, "<pr> 71\n");
            SystemClock.sleep(300);
            assertNull(find(manager, "Match Request"));
            assertNotNull(find(manager, "Message from Alice"));
            // A forged activity intent cannot authorize a command.
            instrumentation.runOnMainSync(() -> plugin.handleOnNewIntent(new Intent().putExtra(FicsNotifications.EXTRA, "forged")));
            assertTrue(socket.sent.isEmpty());
            connection.onMessage(socket, "<pf> 72 w=Bob t=match p=Bob (1500) Guest (----) unrated blitz 3 0\n");
            offer = awaitNotification(manager, "Match Request");
            offer.actions[0].actionIntent.send();
            long deadline = SystemClock.elapsedRealtime() + 5000;
            while (socket.sent.isEmpty() && SystemClock.elapsedRealtime() < deadline) SystemClock.sleep(100);
            assertEquals("Accept should send exactly once", 1, socket.sent.size());
            assertEquals("accept 72", decode(socket.sent.get(0).toByteArray()));
            assertEquals("WebView did not actually freeze", "true", evaluate(activity, "window.notificationTestFrozen"));
            withdrawn.send(); SystemClock.sleep(300);
            assertEquals("Withdrawn action sent a command", 1, socket.sent.size());
            assertNull(find(manager, "Message from Alice"));
            // Foreground traffic must not alert. Backlog is handled only by the UI.
            connection.onMessage(socket, "Alice tells you: foreground\nfics% ");
            assertNull(find(manager, "Message from Alice"));
            notifications.background(true); notifications.configure(false);
            connection.onMessage(socket, "Alice tells you: disabled\nfics% ");
            assertNull(find(manager, "Message from Alice"));
            notifications.configure(true);
            connection.onMessage(socket, "<pf> 73 w=Bob t=match p=Bob (1500) Guest (----) unrated blitz 3 0\n");
            PendingIntent oldSession = awaitNotification(manager, "Match Request").actions[1].actionIntent;
            notifications.begin("replacement-session");
            oldSession.send(); SystemClock.sleep(300);
            assertEquals("Old session action sent a command", 1, socket.sent.size());
            android.util.Log.i("FCC_NATIVE_NOTIFICATION_TEST", "PASS: frozen WebView, scheduled native FICS ping, chat, knight icon, offer withdrawal, native accept, stale actions, foreground and disabled suppression");
        } finally {
            synchronized (plugin) { connections.remove("notification-test"); }
            notifications.clear(); notifications.configure(true);
            evaluate(activity, "if(window.notificationTestSound && !document.querySelector('#sound-toggle')?.textContent.includes('ON'))document.querySelector('#sound-toggle').click();");
        }
    }
    static String decode(byte[] bytes) {
        String key = "Timestamp (FICS) v1.0 - programmed by Henrik Gram.";
        int length = bytes.length - 2;
        for (int i = 0; i < length; i++) bytes[i] = (byte) ((((bytes[i] & 255) + 32) ^ key.charAt(i % 50)) & 127);
        for (int i = 0; i < length; i += 12) {
            swap(bytes, i, i + 11); swap(bytes, i + 2, i + 9); swap(bytes, i + 4, i + 7);
        }
        String text = new String(bytes, java.nio.charset.StandardCharsets.US_ASCII);
        return text.substring(0, text.indexOf('\u0018'));
    }
    static void swap(byte[] bytes, int a, int b) { byte value = bytes[a]; bytes[a] = bytes[b]; bytes[b] = value; }
}
