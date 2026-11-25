package qinqin.shell;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;

/**
 * The shell's own, non-blocking re-check of the saved server on an online start: GET /api/version and ask
 * whether the answer is qinqin's. It exists so a saved origin that now answers with something else (a parked
 * domain, a captive portal, a proxy error page) does not strand the person in a WebView with no way out.
 * Only a real HTTP answer that is not qinqin's counts; any I/O failure (offline, timeout, TLS) is "unknown",
 * because an offline start must still open the app from its service worker.
 */
final class ServerCheck {
    private static final Pattern APP_QINQIN = Pattern.compile("\"app\"\\s*:\\s*\"qinqin\"");
    private static final int TIMEOUT_MS = 8000;
    private static final int MAX_BYTES = 64 * 1024;

    enum Result { QINQIN, NOT_QINQIN, UNKNOWN }

    private ServerCheck() {}

    /** What an answer means: 200 with `"app": "qinqin"` is qinqin; every other answer is not. */
    static Result classify(int status, String body) {
        if (status == 200 && body != null && APP_QINQIN.matcher(body).find()) return Result.QINQIN;
        return Result.NOT_QINQIN;
    }

    /** Blocking: call off the main thread. Redirects are not followed (a redirect is not qinqin's answer). */
    static Result check(String origin) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(origin + "/api/version").openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(TIMEOUT_MS);
            c.setReadTimeout(TIMEOUT_MS);
            c.setRequestProperty("Accept", "application/json");
            int status = c.getResponseCode();
            return classify(status, status == 200 ? read(c.getInputStream()) : null);
        } catch (Exception e) {
            return Result.UNKNOWN;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static String read(InputStream in) throws java.io.IOException {
        try (InputStream s = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = s.read(buf)) > 0 && out.size() < MAX_BYTES) out.write(buf, 0, n);
            return out.toString(StandardCharsets.UTF_8.name());
        }
    }
}
