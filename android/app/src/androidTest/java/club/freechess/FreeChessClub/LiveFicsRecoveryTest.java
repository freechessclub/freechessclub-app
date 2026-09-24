package club.freechess.FreeChessClub;

import static org.junit.Assert.*;
import static org.junit.Assume.*;
import android.content.Context;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import java.util.*;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Opt-in emulator test: a disposable guest, actual network loss, no chats/challenges. */
@RunWith(AndroidJUnit4.class)
public class LiveFicsRecoveryTest {
    static void shell(String command) throws Exception {
        try (var input = new ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(command))) {
            byte[] bytes = new byte[1024]; while (input.read(bytes) != -1) { }
        }
    }
    static Object activeConnection(FicsSocketPlugin plugin) throws Exception {
        synchronized (plugin) {
            for (Object connection : ((Map) NativeReconnectTest.get(plugin, "connections")).values()) {
                synchronized (connection) { if ((boolean) NativeReconnectTest.get(connection, "hasLogin")) return connection; }
            }
        }
        return null;
    }
    @Test public void guestRecoversFromAirplaneModeBeforeWebViewResumes() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        Context context = instrumentation.getTargetContext();
        instrumentation.getUiAutomation().grantRuntimePermission(context.getPackageName(), "android.permission.POST_NOTIFICATIONS");
        MainActivity activity = (MainActivity) instrumentation.startActivitySync(context.getPackageManager().getLaunchIntentForPackage(context.getPackageName()));
        FicsSocketPlugin plugin = (FicsSocketPlugin) activity.getBridge().getPlugin("FicsSocket").getInstance();
        Object connection = null;
        long deadline = SystemClock.elapsedRealtime() + 30000;
        while (connection == null && SystemClock.elapsedRealtime() < deadline) {
            connection = activeConnection(plugin); if (connection == null) SystemClock.sleep(100);
        }
        assertNotNull("No live FICS session; guest auto-login is required", connection);
        assumeFalse("Do not disrupt a registered account", (boolean) NativeReconnectTest.get(connection, "registered"));
        final Object active = connection;
        String before = NativeReconnectTest.evaluate(activity, "document.querySelector('#session-status').textContent");
        int originalGeneration = (int) NativeReconnectTest.get(active, "generation");
        try {
            NativeReconnectTest.evaluate(activity, "window.liveRecoveryBackgroundSetting=document.querySelector('#foreground-service-toggle').checked;if(!window.liveRecoveryBackgroundSetting)document.querySelector('#foreground-service-toggle').click();");
            NativeReconnectTest.evaluate(activity, "window.liveRecoveryFrozen=false;document.addEventListener('freeze',()=>window.liveRecoveryFrozen=true);window.liveRecoverySound=document.querySelector('#sound-toggle')?.textContent.includes('ON');if(window.liveRecoverySound)document.querySelector('#sound-toggle').click();");
            instrumentation.runOnMainSync(() -> activity.moveTaskToBack(true));
            SystemClock.sleep(80000);
            assertTrue("Background recovery preference changed", (boolean) NativeReconnectTest.get(plugin, "recoveryEnabled"));
            shell("cmd connectivity airplane-mode enable");
            long lostDeadline = SystemClock.elapsedRealtime() + 15000;
            boolean recovering = false;
            while (!recovering && SystemClock.elapsedRealtime() < lostDeadline) {
                synchronized (active) { recovering = (boolean) NativeReconnectTest.get(active, "recovering"); }
                if (!recovering) SystemClock.sleep(100);
            }
            assertTrue("Network loss was not detected natively", recovering);
            shell("cmd connectivity airplane-mode disable");
            String recoveredUser = null;
            long restoreDeadline = SystemClock.elapsedRealtime() + 60000;
            while (recoveredUser == null && SystemClock.elapsedRealtime() < restoreDeadline) {
                synchronized (active) {
                    for (JSObject event : (ArrayDeque<JSObject>) NativeReconnectTest.get(active, "events"))
                        if (event.optString("type").equals("reconnected")) recoveredUser = event.optString("user");
                    assertFalse("Native connection ended", (boolean) NativeReconnectTest.get(active, "ended"));
                }
                if (recoveredUser == null) SystemClock.sleep(100);
            }
            assertNotNull("Native guest login did not complete while backgrounded", recoveredUser);
            assertTrue(recoveredUser.matches("Guest[A-Z]{4}"));
            assertTrue((int) NativeReconnectTest.get(active, "generation") > originalGeneration);
            instrumentation.runOnMainSync(() -> activity.startActivity(context.getPackageManager().getLaunchIntentForPackage(context.getPackageName())));
            assertEquals("true", NativeReconnectTest.evaluate(activity, "window.liveRecoveryFrozen"));
            String after = "";
            long uiDeadline = SystemClock.elapsedRealtime() + 10000;
            while (!after.contains(recoveredUser) && SystemClock.elapsedRealtime() < uiDeadline) {
                after = NativeReconnectTest.evaluate(activity, "document.querySelector('#session-status').textContent");
                if (!after.contains(recoveredUser)) SystemClock.sleep(100);
            }
            assertTrue("UI did not synchronize with new native session", after.contains(recoveredUser));
            android.util.Log.i("FCC_LIVE_RECOVERY_TEST", "PASS: airplane-mode loss, native guest login while frozen, UI synchronization; before=" + before + ", after=" + after);
        } finally {
            shell("cmd connectivity airplane-mode disable");
            instrumentation.runOnMainSync(() -> activity.startActivity(context.getPackageManager().getLaunchIntentForPackage(context.getPackageName())));
            NativeReconnectTest.evaluate(activity, "if(window.liveRecoverySound&&!document.querySelector('#sound-toggle')?.textContent.includes('ON'))document.querySelector('#sound-toggle').click();");
            NativeReconnectTest.evaluate(activity, "if(document.querySelector('#foreground-service-toggle').checked!==window.liveRecoveryBackgroundSetting)document.querySelector('#foreground-service-toggle').click();");
        }
    }
}
