package club.freechess.FreeChessClub;

import static org.junit.Assert.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.junit.Test;

public class FicsNotificationParserTest {
    static class Fixture implements FicsNotificationParser.Sink {
        final List<FicsNotificationParser.Event> events = new ArrayList<>();
        final List<String> removals = new ArrayList<>();
        final FicsNotificationParser parser = new FicsNotificationParser(this);
        public void show(FicsNotificationParser.Event event) { events.add(event); }
        public void remove(String key) { removals.add(key); }
        void feed(String text) { parser.receive(text.getBytes(StandardCharsets.UTF_8)); }
    }
    @Test public void fragmentedUtf8AndWrappedTellsKeepOrder() {
        byte[] bytes = ("\nAlice(U) tells you: café\r\n\\   continued\n\rfics% \nBob says: hello\nfics% ").getBytes(StandardCharsets.UTF_8);
        for (int split = 0; split <= bytes.length; split++) {
            Fixture f = new Fixture();
            f.parser.receive(Arrays.copyOfRange(bytes, 0, split));
            f.parser.receive(Arrays.copyOfRange(bytes, split, bytes.length));
            assertEquals("split " + split, 2, f.events.size());
            assertEquals("café continued", f.events.get(0).body);
            assertEquals("Bob", f.events.get(1).user);
        }
    }
    @Test public void channelHistoryAndMachineMessagesDoNotAlert() {
        Fixture f = new Fixture();
        f.feed("Alice(1): channel\nAlice[3] kibitzes: hello\nMessages:\n1. Alice at Fri Sep 18, 10:30 PDT 2026: old\nAlice tells you: invite-game abc 42\nfics% ");
        assertTrue(f.events.isEmpty());
        f.feed("\nThe following message was received:\nAlice at Fri Sep 18, 10:30 PDT 2026: new\nfics% ");
        assertEquals(1, f.events.size());
        assertEquals("new", f.events.get(0).body);
    }
    @Test public void offersAreDeduplicatedReplacedAndWithdrawn() {
        Fixture f = new Fixture();
        String offer = "<pf> 7 w=Alice t=match p=Alice (1500) Guest (----) unrated blitz 5 0\n";
        f.feed(offer + offer);
        assertEquals(1, f.events.size());
        var old = f.events.get(0);
        assertTrue(f.parser.current(old));
        f.feed(offer.replace("<pf> 7", "<pf> 8"));
        assertFalse(f.parser.current(old));
        var revised = f.events.get(1);
        assertTrue(f.parser.current(revised));
        assertEquals(List.of("offer:7"), f.removals);
        f.feed("<pr> 8 9\n");
        assertFalse(f.parser.current(revised));
        f.feed(offer);
        assertFalse("Reused IDs must not revive an old action", f.parser.current(old));
        var current = f.events.get(2);
        f.parser.consume(current);
        assertFalse(f.parser.current(current));
    }
    static String board(int relation, int move) {
        return "<12> rnbqkbnr pppppppp -------- -------- -------- -------- PPPPPPPP RNBQKBNR W -1 1 1 1 1 0 42 Alice Bob " + relation + " 5 0 39 39 300 300 " + move + " none (0:00.000) none 0 1 0\n";
    }
    @Test public void onlyOwnGamesAlertAndRefreshDoesNotRepeatTurns() {
        Fixture f = new Fixture();
        f.feed(board(0, 1) + "{Game 42 (Alice vs. Bob) Alice resigns} 0-1\n");
        assertTrue(f.events.isEmpty());
        f.feed(board(1, 1) + board(1, 1));
        assertEquals(1, f.events.size());
        assertEquals("Your turn", f.events.get(0).title);
        f.feed(board(-1, 1) + board(1, 2));
        assertEquals(2, f.events.size());
        f.feed("{Game 42 (Alice vs. Bob) Bob resigns} 1-0\n{Game 42 (Alice vs. Bob) Bob resigns} 1-0\n");
        assertEquals(3, f.events.size());
        assertEquals("Game finished", f.events.get(2).title);
    }
    @Test public void malformedAndOversizedLinesRecoverAtNextLine() {
        Fixture f = new Fixture();
        f.feed("<pf> 999999999999999 w=Alice t=match p=bad\n<12> malformed\n" + "x".repeat(70000) + "\nBob tells you: recovered\nfics% ");
        assertEquals(1, f.events.size());
        assertEquals("recovered", f.events.get(0).body);
    }
    @Test public void allSupportedRequestsHaveNativeActions() {
        Fixture f = new Fixture();
        for (String type : List.of("partner", "draw", "abort", "adjourn", "takeback")) {
            f.feed("<pf> 1 w=Alice t=" + type + " p=" + type + "\n<pr> 1\n");
        }
        assertEquals(5, f.events.size());
        assertEquals(5, f.removals.size());
    }
}
