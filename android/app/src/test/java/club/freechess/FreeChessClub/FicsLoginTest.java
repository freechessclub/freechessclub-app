package club.freechess.FreeChessClub;

import static org.junit.Assert.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.junit.Test;

public class FicsLoginTest {
    static final class Fixture implements FicsLogin.Listener {
        final List<String> sent = new ArrayList<>();
        final FicsLogin login;
        String user, error;
        byte[] remainder;
        Fixture(boolean registered) { login = new FicsLogin("Alice", "secret", registered, this); }
        public void send(String command) { sent.add(command); }
        public void ready(String user, byte[] remainder) { this.user = user; this.remainder = remainder; }
        public void rejected(String reason) { error = reason; }
        void feed(String text) { login.receive(text.getBytes(StandardCharsets.UTF_8)); }
    }
    @Test public void registeredLoginHandlesEveryFragmentBoundary() {
        String[] frames = {"Welcome\nlogin:", "password:", "**** Starting FICS session as Alice ****\nfics% "};
        for (int split = 0; split < 70; split++) {
            Fixture f = new Fixture(true);
            for (String frame : frames) {
                byte[] bytes = frame.getBytes(StandardCharsets.UTF_8);
                int n = Math.min(split, bytes.length);
                f.login.receive(Arrays.copyOfRange(bytes, 0, n));
                f.login.receive(Arrays.copyOfRange(bytes, n, bytes.length));
            }
            assertEquals(List.of("Alice", "secret"), f.sent);
            assertEquals("Alice", f.user);
            assertNull(f.error);
            // Once login succeeds, later frames go straight to the normal receive path.
            assertTrue("\nfics% ".startsWith(new String(f.remainder, StandardCharsets.UTF_8)));
        }
    }
    @Test public void guestsRequestFreshIdentityAndNeverSendSavedPassword() {
        Fixture f = new Fixture(false);
        f.feed("login:"); f.feed("Press return to enter the server as GuestABCD");
        f.feed("**** Starting FICS session as GuestABCD(U) ****\n");
        assertEquals(List.of("guest", ""), f.sent);
        assertEquals("GuestABCD", f.user);
    }
    @Test public void explicitAuthenticationFailuresStopInsteadOfRetryingOrBecomingGuest() {
        Fixture badPassword = new Fixture(true);
        badPassword.feed("login:"); badPassword.feed("password:");
        badPassword.feed("**** Invalid password! ****\nlogin:");
        badPassword.feed("password:");
        assertNotNull(badPassword.error);
        assertEquals(2, badPassword.sent.size());
        Fixture missingAccount = new Fixture(true);
        missingAccount.feed("login:"); missingAccount.feed("Press return to enter the server as Alice");
        assertNotNull(missingAccount.error);
        assertEquals(List.of("Alice"), missingAccount.sent);
        Fixture wrongIdentity = new Fixture(true);
        wrongIdentity.feed("login:"); wrongIdentity.feed("password:");
        wrongIdentity.feed("**** Starting FICS session as Bob ****");
        assertNotNull(wrongIdentity.error);
        assertNull(wrongIdentity.user);
    }
    @Test public void responseLimitStopsUnboundedLoginBuffering() {
        Fixture f = new Fixture(true);
        f.feed("x".repeat(65537));
        assertNotNull(f.error);
        assertTrue(f.sent.isEmpty());
    }
    @Test public void initialTrafficAfterLoginRetainsBinaryBytes() {
        Fixture f = new Fixture(false);
        f.feed("login:"); f.feed("Press return to enter the server as GuestABCD");
        byte[] prefix = "**** Starting FICS session as GuestABCD(U) ****".getBytes(StandardCharsets.US_ASCII);
        byte[] bytes = Arrays.copyOf(prefix, prefix.length + 1);
        bytes[prefix.length] = (byte) 0xc3;
        f.login.receive(bytes);
        assertArrayEquals(new byte[]{(byte) 0xc3}, f.remainder);
    }
    @Test public void postLoginChatCannotBeMistakenForAuthenticationFailure() {
        Fixture f = new Fixture(true);
        f.feed("login:"); f.feed("password:");
        f.feed("**** Starting FICS session as Alice ****\nBob tells you: Invalid password errors are annoying\n");
        assertEquals("Alice", f.user);
        assertNull(f.error);
    }
    @Test public void retryDelayIsBoundedAndResetsAfterSuccess() {
        FicsRetryPolicy retry = new FicsRetryPolicy();
        for (long delay : new long[]{1000, 2000, 4000, 8000, 16000, 30000, 30000}) assertEquals(delay, retry.nextDelay());
        retry.reset();
        assertEquals(1000, retry.nextDelay());
    }
}
