package qinqin.shell;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;

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
        return url != null && isOrigin(url) ? url : null;
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
     * Whether `url` is an origin the shell may open: http or https, a host, no credentials, no path. The policy
     * about WHICH http hosts are allowed (private addresses only) is the first-run screen's (address.ts); this
     * is the guard against a malformed value reaching the WebView.
     */
    static boolean isOrigin(String url) {
        try {
            Uri u = Uri.parse(url);
            String scheme = u.getScheme();
            return ("https".equals(scheme) || "http".equals(scheme))
                && u.getHost() != null
                && !u.getHost().isEmpty()
                && u.getUserInfo() == null
                && (u.getPath() == null || u.getPath().isEmpty())
                && u.getQuery() == null
                && u.getFragment() == null;
        } catch (Exception e) {
            return false;
        }
    }
}
