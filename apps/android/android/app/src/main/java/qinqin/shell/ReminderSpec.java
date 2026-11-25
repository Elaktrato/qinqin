package qinqin.shell;

import java.io.UnsupportedEncodingException;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.List;

/** One scheduled local notification, as validated from the web app and as kept for the re-arm after a reboot. */
final class ReminderSpec {
    final int id;
    final String title;
    final String body;
    /** When to show it, epoch milliseconds. */
    final long at;
    final String channelId;
    final String channelName;
    /** The in-app path a tap opens, or null. */
    final String route;

    private ReminderSpec(int id, String title, String body, long at, String channelId, String channelName, String route) {
        this.id = id;
        this.title = title;
        this.body = body;
        this.at = at;
        this.channelId = channelId;
        this.channelName = channelName;
        this.route = route;
    }

    /**
     * A whole number from a JSON value: Capacitor's PluginCall.getLong only accepts a Long, and JSON gives an Integer
     * for small numbers (an id) and a Long for large ones (a time). Null for anything else.
     */
    static Long asLong(Object v) {
        if (v instanceof Integer || v instanceof Long || v instanceof Short || v instanceof Byte) return ((Number) v).longValue();
        if (v instanceof Double && ((Double) v) == Math.rint((Double) v) && !Double.isInfinite((Double) v)) return ((Double) v).longValue();
        return null;
    }

    /** Null when the input is not acceptable. Text is capped (title 100, body 500, channel name 60). */
    static ReminderSpec of(long id, String title, String body, long at, String channelId, String channelName, String route) {
        if (id < 0 || id > Integer.MAX_VALUE) return null;
        String t = title == null ? "" : title.trim();
        if (t.isEmpty() || at <= 0) return null;
        if (channelId == null || !channelId.matches("[A-Za-z0-9_.-]{1,40}")) return null;
        String r = null;
        if (route != null && !route.isEmpty()) {
            r = IncomingText.route(route);
            if (r == null) return null;
        }
        String b = body == null ? "" : body.trim();
        String n = channelName == null || channelName.trim().isEmpty() ? channelId : channelName.trim();
        return new ReminderSpec((int) id, cap(t, 100), cap(b, 500), at, channelId, cap(n, 60), r);
    }

    private static String cap(String s, int max) {
        return s.length() > max ? s.substring(0, max) : s;
    }

    /** One line: url-encoded fields joined by '|'. */
    String encode() {
        return id + "|" + at + "|" + enc(title) + "|" + enc(body) + "|" + enc(channelId) + "|" + enc(channelName) + "|"
            + enc(route == null ? "" : route);
    }

    /** The inverse of encode; null for a line that is not one. */
    static ReminderSpec decode(String line) {
        if (line == null) return null;
        String[] f = line.split("\\|", -1);
        if (f.length != 7) return null;
        try {
            return of(Long.parseLong(f[0]), dec(f[2]), dec(f[3]), Long.parseLong(f[1]), dec(f[4]), dec(f[5]), dec(f[6]));
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /** Those whose time is after `now`: what the re-arm after a reboot schedules again. */
    static List<ReminderSpec> upcoming(List<ReminderSpec> all, long now) {
        List<ReminderSpec> out = new ArrayList<>();
        for (ReminderSpec s : all) if (s.at > now) out.add(s);
        return out;
    }

    private static String enc(String s) {
        try {
            return URLEncoder.encode(s, "UTF-8");
        } catch (UnsupportedEncodingException e) {
            throw new IllegalStateException(e);
        }
    }

    private static String dec(String s) {
        try {
            return URLDecoder.decode(s, "UTF-8");
        } catch (UnsupportedEncodingException | IllegalArgumentException e) {
            return "";
        }
    }
}
