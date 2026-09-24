package club.freechess.FreeChessClub;

/** Retry spacing resets only after login succeeds, not merely after TCP connects. */
final class FicsRetryPolicy {
    private long delay = 1000;
    long nextDelay() { long result = delay; delay = Math.min(30000, delay * 2); return result; }
    void reset() { delay = 1000; }
}
