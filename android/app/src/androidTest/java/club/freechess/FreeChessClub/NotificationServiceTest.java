package club.freechess.FreeChessClub;

import static org.junit.Assert.*;

import android.app.Activity;
import android.app.ActivityManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.Build;
import android.os.SystemClock;
import android.service.notification.StatusBarNotification;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.ArrayList;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Run against release: debug builds do not exercise resource shrinking. */
@RunWith(AndroidJUnit4.class)
public class NotificationServiceTest {
    private static final String SERVICE =
        "io.capawesome.capacitorjs.plugins.foregroundservice.AndroidForegroundService";

    @Test
    public void notificationIconSurvivesShrinking() {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        int icon = context.getResources().getIdentifier("ic_fcc_notification", "drawable", context.getPackageName());
        assertNotEquals("Release removed the dynamically resolved notification icon", 0, icon);
        assertNotNull(context.getDrawable(icon));
    }

    @Test
    public void servicePostsNotificationAndRunsInBackground() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        Context context = instrumentation.getTargetContext();
        if (Build.VERSION.SDK_INT >= 33) {
            instrumentation.getUiAutomation().grantRuntimePermission(context.getPackageName(), "android.permission.POST_NOTIFICATIONS");
        }
        int icon = context.getResources().getIdentifier("ic_fcc_notification", "drawable", context.getPackageName());
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        Activity activity = instrumentation.startActivitySync(launch);
        // Let the WebView finish its initial service-state synchronization.
        SystemClock.sleep(3000);
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel("fcc-service-test", "Service test", NotificationManager.IMPORTANCE_LOW));

        Bundle notification = new Bundle();
        notification.putInt("id", 99004);
        notification.putInt("icon", icon);
        notification.putString("title", "Free Chess Club service test");
        notification.putString("body", "Verifying the release notification icon");
        notification.putBoolean("silent", true);
        notification.putParcelableArrayList("buttons", new ArrayList<Bundle>());
        Intent service = new Intent().setClassName(context.getPackageName(), SERVICE);
        service.putExtra("channelId", "fcc-service-test");
        service.putExtra("notification", notification);
        try {
            instrumentation.runOnMainSync(() -> context.startForegroundService(service));
            long deadline = SystemClock.elapsedRealtime() + 10000;
            StatusBarNotification posted = null;
            while (SystemClock.elapsedRealtime() < deadline && posted == null) {
                for (StatusBarNotification candidate : manager.getActiveNotifications()) {
                    if (candidate.getId() == 99004) posted = candidate;
                }
                if (posted == null) SystemClock.sleep(100);
            }
            assertNotNull("Foreground service did not post its notification", posted);
            assertEquals(icon, posted.getNotification().getSmallIcon().getResId());
            assertTrue((posted.getNotification().flags & Notification.FLAG_FOREGROUND_SERVICE) != 0);
            instrumentation.runOnMainSync(() -> activity.moveTaskToBack(true));
            SystemClock.sleep(1000);
            boolean running = false;
            for (ActivityManager.RunningServiceInfo info : context.getSystemService(ActivityManager.class).getRunningServices(100)) {
                if (SERVICE.equals(info.service.getClassName())) running = info.foreground;
            }
            assertTrue("Service stopped when the activity went into the background", running);
        } finally {
            context.stopService(service);
            manager.cancel(99004);
            manager.deleteNotificationChannel("fcc-service-test");
        }
    }
}
