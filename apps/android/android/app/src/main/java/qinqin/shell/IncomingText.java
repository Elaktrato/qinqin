package qinqin.shell;

/**
 * What another app hands qinqin (a shared or selected text, a tapped notification's route) is untrusted. The
 * web app validates again; this keeps junk from crossing the bridge at all.
 */
final class IncomingText {
    static final int MAX_TEXT = 2000;
    static final int MAX_ROUTE = 500;

    private IncomingText() {}

    /** Trimmed, control characters dropped (line breaks become spaces), capped; null when nothing is left. */
    static String clean(CharSequence raw) {
        if (raw == null) return null;
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < raw.length(); i++) {
            char c = raw.charAt(i);
            if (c == '\n' || c == '\r' || c == '\t') b.append(' ');
            else if (!Character.isISOControl(c)) b.append(c);
        }
        String s = b.toString().trim();
        if (s.length() > MAX_TEXT) {
            int end = MAX_TEXT;
            if (Character.isHighSurrogate(s.charAt(end - 1))) end--;
            s = s.substring(0, end).trim();
        }
        return s.isEmpty() ? null : s;
    }

    /** An in-app path ("/study", "/search?q=%E4%BD%A0"): one leading slash, printable ASCII, no backslash. */
    static String route(String raw) {
        if (raw == null || raw.length() > MAX_ROUTE) return null;
        if (!raw.matches("/[\\x21-\\x7e]*") || raw.startsWith("//") || raw.indexOf('\\') >= 0) return null;
        return raw;
    }
}
