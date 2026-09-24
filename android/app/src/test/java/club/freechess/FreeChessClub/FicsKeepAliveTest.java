package club.freechess.FreeChessClub;

import static org.junit.Assert.*;
import org.junit.Test;

public class FicsKeepAliveTest {
    @Test public void neverPingsBeforeLoginOrAfterStop() {
        FicsKeepAlive timer = new FicsKeepAlive();
        assertFalse(timer.due(10 * FicsKeepAlive.INTERVAL_MS));
        timer.start(0);
        timer.stop();
        assertFalse(timer.due(10 * FicsKeepAlive.INTERVAL_MS));
    }
    @Test public void repeatsAcrossHoursWithoutJavaScriptActivity() {
        FicsKeepAlive timer = new FicsKeepAlive();
        timer.start(1000);
        int pings = 0;
        for (int minute = 1; minute <= 180; minute++) {
            boolean due = timer.due(1000 + minute * 60000L);
            assertEquals(minute % 45 == 0, due);
            if (due) pings++;
        }
        assertEquals(4, pings);
    }
    @Test public void repeatedLoginDoesNotPostponePingAndDelayedTicksDoNotBurst() {
        FicsKeepAlive timer = new FicsKeepAlive();
        timer.start(0);
        timer.start(FicsKeepAlive.INTERVAL_MS - 1);
        assertTrue(timer.due(FicsKeepAlive.INTERVAL_MS));
        long later = 4 * FicsKeepAlive.INTERVAL_MS;
        assertTrue(timer.due(later));
        assertFalse(timer.due(later));
        assertFalse(timer.due(later + FicsKeepAlive.INTERVAL_MS - 1));
        assertTrue(timer.due(later + FicsKeepAlive.INTERVAL_MS));
    }
}
