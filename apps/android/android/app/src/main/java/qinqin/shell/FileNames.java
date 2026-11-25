package qinqin.shell;

/** A file name the web app suggests for a save is a suggestion: no path, no control characters, bounded. */
final class FileNames {
    private FileNames() {}

    static String safe(String raw) {
        StringBuilder b = new StringBuilder();
        if (raw != null) {
            for (int i = 0; i < raw.length(); i++) {
                char c = raw.charAt(i);
                if (Character.isISOControl(c) || c == '/' || c == '\\' || c == ':' || c == '*' || c == '?' || c == '"'
                    || c == '<' || c == '>' || c == '|') {
                    b.append('_');
                } else {
                    b.append(c);
                }
            }
        }
        String s = b.toString().trim();
        while (s.startsWith(".")) s = s.substring(1);
        if (s.length() > 120) s = s.substring(0, 120);
        return s.isEmpty() ? "qinqin-export" : s;
    }
}
