package club.freechess.FreeChessClub;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSObject;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/** Notifications and action capabilities live independently of the WebView. */
final class FicsNotifications {
    static final String GROUP = "fcc-events", CHANNEL = "fcc-events", EXTRA = "fcc.notification.token";
    private final Context context;
    private final NotificationManager manager;
    private final Map<String, Thread> threads = new LinkedHashMap<>();
    private final Map<String, Action> actions = new LinkedHashMap<>();
    private String session;
    private boolean enabled, background;
    private boolean summaryPosted;
    private int nextId = 10000;
    static final class Action {
        final String session, command;
        final FicsNotificationParser.Event event;
        Action(String session, String command, FicsNotificationParser.Event event) {
            this.session = session; this.command = command; this.event = event;
        }
        JSObject target() {
            JSObject result = new JSObject().put("kind", event.kind);
            if (event.user != null) result.put("user", event.user);
            if (event.gameId != null) result.put("gameId", event.gameId);
            if (event.offerId != null) result.put("offerId", event.offerId);
            return result;
        }
    }
    private static final class Thread {
        final int id;
        final ArrayList<String> lines = new ArrayList<>();
        FicsNotificationParser.Event event;
        int count;
        Thread(int id) { this.id = id; }
    }
    FicsNotifications(Context context) {
        this.context = context;
        manager = context.getSystemService(NotificationManager.class);
        if (android.os.Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(new NotificationChannel(CHANNEL, "Messages and game requests", NotificationManager.IMPORTANCE_DEFAULT));
        enabled = context.getSharedPreferences(GROUP, Context.MODE_PRIVATE).getBoolean("enabled", false);
        clear();
    }
    synchronized void connectionState(String title, String body) {
        if (android.os.Build.VERSION.SDK_INT < 24) return;
        for (android.service.notification.StatusBarNotification item : manager.getActiveNotifications()) {
            if (item.getId() == 1 && (item.getNotification().flags & android.app.Notification.FLAG_FOREGROUND_SERVICE) != 0) {
                try {
                    manager.notify(1, android.app.Notification.Builder.recoverBuilder(context, item.getNotification())
                        .setContentTitle(title).setContentText(body).setOnlyAlertOnce(true).build());
                } catch (SecurityException ignored) { }
            }
        }
    }

    synchronized void configure(boolean value) {
        enabled = value;
        context.getSharedPreferences(GROUP, Context.MODE_PRIVATE).edit().putBoolean("enabled", value).apply();
        if (!value) clear();
    }
    synchronized void background(boolean value) { background = value; if (!value) clear(); }
    synchronized void begin(String id) { clear(); session = id; }
    synchronized void end(String id) { if (id.equals(session)) { clear(); session = null; } }
    synchronized void clear() {
        for (android.service.notification.StatusBarNotification item : manager.getActiveNotifications())
            if (GROUP.equals(item.getNotification().getGroup())) manager.cancel(item.getId());
        threads.clear(); actions.clear(); summaryPosted = false;
    }
    synchronized void remove(String id, String key) {
        if (!id.equals(session)) return;
        Thread thread = threads.remove(key);
        if (thread != null) manager.cancel(thread.id);
        forgetActions(key);
        summary();
    }
    synchronized void show(String id, FicsNotificationParser.Event event) {
        if (!id.equals(session) || !enabled || !background || !NotificationManagerCompat.from(context).areNotificationsEnabled()) return;
        Thread thread = threads.remove(event.key);
        if (thread == null) thread = new Thread(nextId++);
        thread.event = event; thread.count++;
        thread.lines.add(clean(event.body));
        if (thread.lines.size() > 5) thread.lines.remove(0);
        threads.put(event.key, thread);
        if (threads.size() > 50) remove(id, threads.keySet().iterator().next());
        post(thread, false); summary();
    }
    private static String clean(String text) {
        String clean = text.replaceAll("<[^>]*>", "").replaceAll("\\s+", " ").trim();
        return clean.substring(0, Math.min(240, clean.length()));
    }
    private void forgetActions(String key) {
        java.util.Iterator<Action> iterator = actions.values().iterator();
        while (iterator.hasNext()) if (iterator.next().event.key.equals(key)) iterator.remove();
    }
    private PendingIntent intent(FicsNotificationParser.Event event, String command) {
        String token = UUID.randomUUID().toString();
        actions.put(token, new Action(session, command, event));
        Intent intent = new Intent(context, MainActivity.class)
            .setAction("club.freechess.notification." + token)
            .putExtra(EXTRA, token)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }
    // The exported activity's extras alone never authorize a server command.
    synchronized Action take(Intent intent) {
        if (intent == null) return null;
        String token = intent.getStringExtra(EXTRA);
        intent.removeExtra(EXTRA);
        return actions.remove(token);
    }
    private NotificationCompat.Builder builder() {
        return new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_fcc_notification).setGroup(GROUP)
            .setAutoCancel(true).setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN);
    }
    private void post(Thread thread, boolean silent) {
        FicsNotificationParser.Event event = thread.event;
        forgetActions(event.key);
        NotificationCompat.InboxStyle style = new NotificationCompat.InboxStyle();
        for (String line : thread.lines) style.addLine(line);
        NotificationCompat.Builder notification = builder().setContentTitle(clean(event.title))
            .setContentText(thread.lines.get(thread.lines.size() - 1)).setStyle(style)
            .setNumber(thread.count).setSilent(silent).setContentIntent(intent(event, "tap"));
        if (event.offerId != null) {
            notification.addAction(0, "Accept", intent(event, "accept"));
            notification.addAction(0, "Decline", intent(event, "decline"));
        }
        try { manager.notify(thread.id, notification.build()); }
        catch (SecurityException ignored) { /* Permission can change between checking and posting. */ }
    }
    private void summary() {
        if (threads.size() < 2) {
            if (summaryPosted) {
                manager.cancel(2);
                summaryPosted = false;
                // Android can remove children when their summary is cancelled.
                for (Thread thread : threads.values()) post(thread, true);
            }
            return;
        }
        NotificationCompat.InboxStyle style = new NotificationCompat.InboxStyle();
        int count = 0;
        for (Thread thread : threads.values()) {
            count += thread.count;
            style.addLine(clean(thread.event.title) + ": " + thread.lines.get(thread.lines.size() - 1));
        }
        try {
            summaryPosted = true;
            manager.notify(2, builder().setContentTitle("Free Chess Club").setContentText(count + " new updates")
                .setStyle(style).setGroupSummary(true).setSilent(true).build());
        } catch (SecurityException ignored) { }
    }
}
