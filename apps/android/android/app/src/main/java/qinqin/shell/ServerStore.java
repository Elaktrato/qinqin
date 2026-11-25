package qinqin.shell;

import android.content.Context;
import android.content.SharedPreferences;
import java.net.URI;

/**
 * The server address the person entered, kept in SharedPreferences (private to the app), and the one-shot
 * "show the first-run screen with this error" request that survives an Activity recreate in the same process.
 */
final class ServerStore {
    private static final String FILE = "qinqin_shell";
    private static final String KEY_SERVER = "server_url";
    private static final String KEY_LAST = "last_url";

    /** Set when the saved server could not be reached: the next load shows the first-run screen with this kind. */
    private static volatile String pendingError = null;

    private ServerStore() {}

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    /** The saved origin, or null (first run, or after "Change server"). */
    static String get(Context c) {
        String url = prefs(c).getString(KEY_SERVER, null);
        return url != null && isAllowedOrigin(url) ? url : null;
    }

    /** The server the person used last, to fill the form again. */
    static String last(Context c) {
        return prefs(c).getString(KEY_LAST, null);
    }

    static void set(Context c, String url) {
        prefs(c).edit().putString(KEY_SERVER, url).putString(KEY_LAST, url).apply();
        pendingError = null;
    }

    static void clear(Context c) {
        prefs(c).edit().remove(KEY_SERVER).apply();
        pendingError = null;
    }

    /**
     * "Change server": forgets the address AND everything the old account armed (scheduled reminders, shown
     * notifications). Otherwise they survive in SharedPreferences, are re-armed on boot, and a tap opens /study
     * on the NEW server. Every path that drops the server goes through here.
     */
    static void forget(Context c) {
        Reminders.clearEverything(c);
        clear(c);
    }

    static void failed(String kind) {
        pendingError = kind;
    }

    /** Returns the pending failure once (null when none). */
    static String takeError() {
        String kind = pendingError;
        pendingError = null;
        return kind;
    }

    /**
     * Whether the shell may open `url`: a bare origin (isOrigin) that is https, or http on a private host
     * (isPrivateHost). Enforced here as well as on the first-run screen (address.ts) because the plugin can be
     * called by any page that has the bridge.
     */
    static boolean isAllowedOrigin(String url) {
        if (!isOrigin(url)) return false;
        try {
            URI u = new URI(url);
            return "https".equals(u.getScheme()) || isPrivateHost(u.getHost());
        } catch (Exception e) {
            return false;
        }
    }

    /** The same rule as isPrivateHost in src/firstrun/address.ts (host as URI.getHost writes it: IPv6 in brackets). */
    static boolean isPrivateHost(String host) {
        if (host == null) return false;
        String h = host.toLowerCase(java.util.Locale.ROOT);
        if (h.endsWith(".")) h = h.substring(0, h.length() - 1);
        if (h.startsWith("[") && h.endsWith("]")) {
            String v6 = h.substring(1, h.length() - 1);
            if (v6.equals("::1")) return true;
            String first = v6.split(":", -1)[0];
            if (first.isEmpty()) return false;
            try {
                int n = Integer.parseInt(first, 16);
                return (n >= 0xfc00 && n <= 0xfdff) || (n >= 0xfe80 && n <= 0xfebf);
            } catch (NumberFormatException e) {
                return false;
            }
        }
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$").matcher(h);
        if (m.matches()) {
            int[] p = new int[4];
            for (int i = 0; i < 4; i++) {
                p[i] = Integer.parseInt(m.group(i + 1));
                if (p[i] > 255) return false;
            }
            int a = p[0], b = p[1];
            return a == 127 || a == 10 || (a == 172 && b >= 16 && b <= 31) || (a == 192 && b == 168) || (a == 169 && b == 254);
        }
        if (h.equals("localhost") || h.endsWith(".localhost") || h.endsWith(".local")) return true;
        return !h.contains(".");
    }

    /**
     * Whether `url` is an origin the shell may open: http or https, a host, no credentials, no path. Guards
     * against a malformed value reaching the WebView; isAllowedOrigin adds the cleartext policy.
     */
    static boolean isOrigin(String url) {
        if (url == null) return false;
        try {
            URI u = new URI(url);
            String scheme = u.getScheme();
            String path = u.getRawPath();
            return ("https".equals(scheme) || "http".equals(scheme))
                && u.getHost() != null
                && !u.getHost().isEmpty()
                && u.getRawUserInfo() == null
                && (path == null || path.isEmpty())
                && u.getRawQuery() == null
                && u.getRawFragment() == null;
        } catch (Exception e) {
            return false;
        }
    }
}
