package club.freechess.FreeChessClub;

/** FICS idle prevention is separate from WebSocket ping/pong and timeseal probes. */
final class FicsKeepAlive {
    static final long INTERVAL_MS = 45 * 60 * 1000L;
    private boolean active;
    private long lastPing;

    void start(long now) {
        if (active) return;
        active = true;
        lastPing = now;
    }

    void stop() { active = false; }

    boolean due(long now) {
        if (!active || now - lastPing < INTERVAL_MS) return false;
        // A delayed timer sends one ping, never a burst of missed intervals.
        lastPing = now;
        return true;
    }
}
