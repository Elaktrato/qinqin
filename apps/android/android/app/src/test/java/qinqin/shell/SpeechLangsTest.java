package qinqin.shell;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;

import org.junit.Test;

/** Which locales the device voice tries for a study language, and the limits on what is spoken. */
public class SpeechLangsTest {
    @Test
    public void chineseTriesMainlandThenTaiwanThenHongKong() {
        assertArrayEquals(new String[] {"zh-CN", "zh-TW", "zh-HK"}, SpeechLangs.candidates("zh"));
        assertArrayEquals(new String[] {"zh-CN", "zh-TW", "zh-HK"}, SpeechLangs.candidates("zh_CN"));
    }

    @Test
    public void aRegionIsTriedFirst() {
        assertArrayEquals(new String[] {"zh-TW", "zh-CN", "zh-HK"}, SpeechLangs.candidates("zh-TW"));
        assertArrayEquals(new String[] {"zh-TW", "zh-CN", "zh-HK"}, SpeechLangs.candidates("zh-Hant-TW"));
    }

    @Test
    public void japaneseAndOthers() {
        assertArrayEquals(new String[] {"ja-JP"}, SpeechLangs.candidates("ja"));
        assertArrayEquals(new String[] {"ja-JP"}, SpeechLangs.candidates("JA-jp"));
        assertArrayEquals(new String[] {"ko"}, SpeechLangs.candidates("ko"));
    }

    @Test
    public void garbageHasNoCandidates() {
        assertArrayEquals(new String[0], SpeechLangs.candidates(null));
        assertArrayEquals(new String[0], SpeechLangs.candidates(""));
        assertArrayEquals(new String[0], SpeechLangs.candidates("../../x"));
        assertArrayEquals(new String[0], SpeechLangs.candidates("zh;rm"));
    }

    @Test
    public void rateIsClamped() {
        assertEquals(1.0f, SpeechLangs.rate(null), 0f);
        assertEquals(0.9f, SpeechLangs.rate(0.9), 0f);
        assertEquals(0.5f, SpeechLangs.rate(0.1), 0f);
        assertEquals(2.0f, SpeechLangs.rate(9.0), 0f);
        assertEquals(1.0f, SpeechLangs.rate(Double.NaN), 0f);
    }

    @Test
    public void textIsCapped() {
        assertEquals("", SpeechLangs.text(null));
        assertEquals("你好", SpeechLangs.text("你好"));
        assertEquals(3000, SpeechLangs.text("x".repeat(5000)).length());
    }
}
