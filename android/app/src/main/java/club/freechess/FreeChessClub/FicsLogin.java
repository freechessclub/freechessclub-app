package club.freechess.FreeChessClub;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Login only. Authentication prompts are never replayed to the JavaScript parser. */
final class FicsLogin {
    interface Listener {
        void send(String command);
        void ready(String user, byte[] remainder);
        void rejected(String reason);
    }
    private static final Pattern START = Pattern.compile("\\*\\*\\*\\* Starting FICS session as ([a-zA-Z]+)(?:\\([^\\r\\n]*\\))? \\*\\*\\*\\*");
    private final ByteArrayOutputStream buffer = new ByteArrayOutputStream();
    private final String user, password;
    private final boolean registered;
    private final Listener listener;
    private int phase;
    private boolean ended;

    FicsLogin(String user, String password, boolean registered, Listener listener) {
        this.user = user; this.password = password; this.registered = registered; this.listener = listener;
    }
    void receive(byte[] bytes) {
        if (ended) return;
        if (buffer.size() + bytes.length > 65536) { reject("Login response exceeded limit"); return; }
        buffer.write(bytes, 0, bytes.length);
        String text = new String(buffer.toByteArray(), StandardCharsets.ISO_8859_1);
        Matcher start = START.matcher(text);
        if (start.find()) {
            if (phase != 2 || (registered && !start.group(1).equalsIgnoreCase(user))) {
                reject("Unexpected FICS login identity"); return;
            }
            ended = true;
            listener.ready(start.group(1), java.util.Arrays.copyOfRange(buffer.toByteArray(), start.end(), buffer.size()));
            return;
        }
        if (text.contains("Invalid password") || text.contains("Sorry, names") || text.contains("is banned")) {
            reject("FICS rejected the saved login; sign in again"); return;
        }
        if (text.contains("login:")) {
            if (phase != 0) { reject("FICS requested another login; sign in again"); return; }
            phase = 1; buffer.reset(); listener.send(registered ? user : "guest"); return;
        }
        if (text.contains("Press return to enter the server as")) {
            if (registered || phase != 1) { reject("FICS did not recognize the saved account"); return; }
            phase = 2; buffer.reset(); listener.send(""); return;
        }
        if (text.contains("password:")) {
            if (!registered || phase != 1 || password.isEmpty()) { reject("FICS requires a password; sign in again"); return; }
            phase = 2; buffer.reset(); listener.send(password);
        }
    }
    private void reject(String reason) { ended = true; listener.rejected(reason); }
}
