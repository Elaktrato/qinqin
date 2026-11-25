package qinqin.shell;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Pure rules of the device voice: which locales to try for a study language, and the limits on what is spoken. */
final class SpeechLangs {
    /** Android's TextToSpeech refuses more than getMaxSpeechInputLength() (4000); stay well below. */
    static final int MAX_TEXT = 3000;

    private SpeechLangs() {}

    /**
     * The BCP 47 tags to try, best first. "zh" tries mainland, Taiwan, Hong Kong; a region the caller named
     * comes first. "ja" is ja-JP. Anything that is not a language tag has no candidates.
     */
    static String[] candidates(String lang) {
        if (lang == null) return new String[0];
        String norm = lang.trim().replace('_', '-');
        if (!norm.matches("[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*")) return new String[0];
        String[] parts = norm.split("-");
        String code = parts[0].toLowerCase(Locale.ROOT);
        String region = null;
        for (int i = 1; i < parts.length; i++) {
            String p = parts[i];
            if (p.matches("[A-Za-z]{2}") || p.matches("[0-9]{3}")) {
                region = p.toUpperCase(Locale.ROOT);
                break;
            }
        }
        List<String> out = new ArrayList<>();
        if (code.equals("zh")) {
            if (region != null) out.add("zh-" + region);
            for (String r : new String[] {"CN", "TW", "HK"}) {
                if (!out.contains("zh-" + r)) out.add("zh-" + r);
            }
        } else if (code.equals("ja")) {
            out.add("ja-JP");
        } else {
            out.add(region != null ? code + "-" + region : code);
        }
        return out.toArray(new String[0]);
    }

    /** The speech rate: 1.0 when absent, otherwise kept within 0.5 to 2.0. */
    static float rate(Double wanted) {
        if (wanted == null || wanted.isNaN()) return 1.0f;
        return (float) Math.max(0.5, Math.min(2.0, wanted));
    }

    static String text(String text) {
        if (text == null) return "";
        return text.length() > MAX_TEXT ? text.substring(0, MAX_TEXT) : text;
    }
}
