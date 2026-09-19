package club.freechess.FreeChessClub;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Small, streaming alert recognizer. The shared JS parser still owns UI state. */
final class FicsNotificationParser {
    interface Sink { void show(Event event); void remove(String key); }
    static final class Event {
        final String key, title, body, kind, user;
        final Integer gameId, offerId;
        Event(String key, String title, String body, String kind, String user, Integer gameId, Integer offerId) {
            this.key = key; this.title = title; this.body = body; this.kind = kind;
            this.user = user; this.gameId = gameId; this.offerId = offerId;
        }
    }
    private static final Pattern TELL = Pattern.compile("^([a-zA-Z]+)(?:[\\(\\[][A-Z0-9*\\-]+[\\)\\]])* (?:tells you|says):\\s*(.*)$");
    private static final Pattern OFFER = Pattern.compile("^<pf> (\\d+) w=(\\S+) t=(\\S+) p=(.*)$");
    private static final Pattern END = Pattern.compile("^\\{Game (\\d+) \\((\\S+) vs\\. (\\S+)\\) (.+)\\} (1-0|0-1|1/2-1/2|\\*)$");
    private static final Pattern STORED = Pattern.compile("^(?:\\d+\\. )?(\\w+) at \\w+ \\w+\\s+\\d+, \\d{2}:\\d{2} [\\w?]+ \\d+: (.+)$");
    private final Sink sink;
    private final ByteArrayOutputStream line = new ByteArrayOutputStream();
    private final Map<Integer, Event> offers = new HashMap<>();
    private final Map<Integer, String> positions = new HashMap<>();
    private boolean discardLine, onlineMessage;
    private String pendingUser, pendingBody, adjournHeading;
    FicsNotificationParser(Sink sink) { this.sink = sink; }

    void receive(byte[] bytes) {
        for (byte value : bytes) {
            if (value == '\r') continue;
            if (value == '\n') {
                if (!discardLine) parse(new String(line.toByteArray(), StandardCharsets.UTF_8));
                line.reset(); discardLine = false;
            } else if (!discardLine && value != 0 && value != 1 && value != 7) {
                if (line.size() < 65536) line.write(value);
                else { line.reset(); discardLine = true; }
            }
        }
        // Prompts have no terminating newline. Never search inside message text.
        if (new String(line.toByteArray(), StandardCharsets.UTF_8).trim().equals("fics%")) {
            flushTell(); line.reset(); onlineMessage = false;
        }
    }

    boolean current(Event event) { return event.offerId != null && offers.get(event.offerId) == event; }
    void consume(Event event) {
        if (current(event)) { offers.remove(event.offerId); sink.remove(event.key); }
    }
    private static Integer number(String value) {
        try { int n = Integer.parseInt(value); return n >= 0 ? n : null; }
        catch (NumberFormatException e) { return null; }
    }
    private void flushTell() {
        if (pendingUser == null) return;
        // These messages exchange machine-readable links between app instances.
        if (!pendingBody.matches("(?i)^invite(?:-game)?\\s+[a-z0-9]+\\s+\\d+.*"))
            sink.show(new Event("chat:" + pendingUser.toLowerCase(java.util.Locale.ROOT),
                "Message from " + pendingUser, pendingBody, "chat", pendingUser, null, null));
        pendingUser = null; pendingBody = null;
    }
    private void parse(String raw) {
        String text = raw.replaceFirst("^(?:fics%\\s*)+", "");
        if (text.startsWith("\\   ") && pendingUser != null) {
            String combined = pendingBody + " " + text.substring(4);
            pendingBody = combined.substring(0, Math.min(4096, combined.length()));
            return;
        }
        flushTell();
        Matcher match = TELL.matcher(text);
        if (match.matches()) { pendingUser = match.group(1); pendingBody = match.group(2); return; }
        if (text.startsWith("The following message was received") || text.startsWith("The following message was emailed:")) {
            onlineMessage = true; return;
        }
        if (onlineMessage && !text.trim().isEmpty()) {
            onlineMessage = false;
            match = STORED.matcher(text);
            if (match.matches()) { pendingUser = match.group(1); pendingBody = match.group(2); return; }
        }
        if (adjournHeading != null && !text.trim().isEmpty()) {
            sink.show(new Event("offers", "Resume game", adjournHeading + " " + text, "offers", null, null, null));
            adjournHeading = null;
        }
        if (text.matches("\\d+ players?, who (?:has|have) an adjourned game with you, (?:is|are) online:")) adjournHeading = text;
        if (text.matches("Notification: \\S+, who has an adjourned game with you, has arrived\\."))
            sink.show(new Event("offers", "Resume game", text.substring(14), "offers", null, null, null));
        if (text.matches("\\w+ (?:declines the partnership request|agrees to be your partner)\\."))
            sink.show(new Event("offers", text.contains("declines") ? "Partnership Declined" : "Partnership Accepted", text, "offers", null, null, null));
        match = OFFER.matcher(text);
        if (match.matches()) {
            Integer id = number(match.group(1));
            String user = match.group(2), type = match.group(3), params = match.group(4);
            if (id == null || !type.matches("match|partner|draw|abort|adjourn|takeback")) return;
            String body = type.equals("match") ? params : user + " requests " + type + (params.trim().isEmpty() ? "" : " " + params);
            Event old = offers.get(id);
            if (old != null && old.body.equals(body)) return;
            // A revised challenge supersedes the earlier one from that player.
            for (Event previous : new java.util.ArrayList<>(offers.values())) {
                if (previous.offerId.equals(id) || (type.equals("match") && previous.title.contains("Match") && user.equals(previous.user))) {
                    offers.remove(previous.offerId); sink.remove(previous.key);
                }
            }
            if (offers.size() >= 256) return;
            Event event = new Event("offer:" + id, type.equals("match") ? "Match Request" : Character.toUpperCase(type.charAt(0)) + type.substring(1) + " Request", body, "offers", user, null, id);
            offers.put(id, event); sink.show(event); return;
        }
        if (text.startsWith("<pr> ")) {
            for (String value : text.substring(5).trim().split("\\s+")) {
                Integer id = number(value);
                if (id != null) { offers.remove(id); sink.remove("offer:" + id); }
            }
            return;
        }
        if (text.startsWith("<12> ")) {
            String[] f = text.trim().split("\\s+");
            if (f.length < 30) return;
            Integer id = number(f[16]);
            if (id == null) return;
            if (!f[19].equals("1") && !f[19].equals("-1")) { positions.remove(id); return; }
            StringBuilder board = new StringBuilder();
            for (int i = 1; i < 10; i++) board.append(f[i]);
            String position = board.append(":").append(f[26]).toString();
            if (positions.size() >= 256 && !positions.containsKey(id)) return;
            String previous = positions.put(id, position);
            if (f[19].equals("1") && !position.equals(previous)) {
                String opponent = f[9].equals("W") ? f[18] : f[17];
                sink.show(new Event("game:" + id, "Your turn", f[29].equals("none") ? "Your game against " + opponent + " is ready." : opponent + " moved. It's your turn.", "game", null, id, null));
            }
            return;
        }
        match = END.matcher(text);
        if (match.matches() && !match.group(4).startsWith("Creating ") && !match.group(4).startsWith("Continuing ")) {
            Integer id = number(match.group(1));
            if (positions.remove(id) != null)
                sink.show(new Event("game:" + id, "Game finished", match.group(4) + " " + match.group(5), "game", null, id, null));
        }
    }
}
