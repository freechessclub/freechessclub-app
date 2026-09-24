package club.freechess.FreeChessClub;

import java.io.ByteArrayOutputStream;

/** Timeseal framing for native probes and notification action commands. */
final class FicsTimeseal {
    private static final byte[] PROBE = {'[', 'G', ']', 0};
    private static final String KEY = "Timestamp (FICS) v1.0 - programmed by Henrik Gram.";
    private int matched;

    // Retain partial probe markers across WebSocket messages. Strip probes before
    // delivery so the shared JS parser cannot send a second, late acknowledgement.
    byte[] receive(byte[] input, Runnable acknowledge) {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        for (byte value : input) {
            if (value != PROBE[matched] && matched > 0) {
                output.write(PROBE, 0, matched);
                matched = 0;
            }
            if (value == PROBE[matched]) {
                if (++matched == PROBE.length) {
                    matched = 0;
                    acknowledge.run();
                }
            } else {
                output.write(value);
            }
        }
        return output.toByteArray();
    }

    static byte[] acknowledgement(long now) {
        return command("\u00029", now);
    }

    static byte[] command(String text, long now) {
        String payload = text + "\u0018" + (now % 10000000L) + "\u0019";
        // Match Session.encode's low-byte UTF-16 encoding, including existing passwords.
        byte[] raw = new byte[payload.length()];
        for (int i = 0; i < payload.length(); i++) raw[i] = (byte) payload.charAt(i);
        int length = ((raw.length + 11) / 12) * 12;
        byte[] encoded = new byte[length + 2];
        java.util.Arrays.fill(encoded, 0, length, (byte) '1');
        System.arraycopy(raw, 0, encoded, 0, raw.length);
        for (int i = 0; i < length; i += 12) {
            swap(encoded, i, i + 11);
            swap(encoded, i + 2, i + 9);
            swap(encoded, i + 4, i + 7);
        }
        for (int i = 0; i < length; i++) {
            encoded[i] = (byte) (((encoded[i] | 0x80) ^ KEY.charAt(i % 50)) - 32);
        }
        encoded[length] = (byte) 0x80;
        encoded[length + 1] = '\n';
        return encoded;
    }

    private static void swap(byte[] data, int left, int right) {
        byte value = data[left];
        data[left] = data[right];
        data[right] = value;
    }
}
