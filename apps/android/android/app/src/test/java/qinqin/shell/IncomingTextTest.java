package qinqin.shell;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

/** Text another app shares with qinqin is untrusted: trimmed, stripped of control characters, capped. */
public class IncomingTextTest {
    @Test
    public void keepsPlainText() {
        assertEquals("你好，世界", IncomingText.clean("  你好，世界\n"));
    }

    @Test
    public void dropsControlCharactersButKeepsSpaces() {
        assertEquals("a b c", IncomingText.clean("a\u0000 b\u0007 c"));
        assertEquals("one two", IncomingText.clean("one\ntwo"));
    }

    @Test
    public void emptyIsNothing() {
        assertNull(IncomingText.clean(null));
        assertNull(IncomingText.clean("   \n"));
        assertNull(IncomingText.clean("\u0000\u0001"));
    }

    @Test
    public void isCappedWithoutSplittingASurrogatePair() {
        String s = "x".repeat(1999) + "😀" + "tail";
        String cut = IncomingText.clean(s);
        assertEquals(1999, cut.length());
        assertEquals(2000, IncomingText.clean("y".repeat(3000)).length());
    }

    @Test
    public void routeMustBeAnInAppPath() {
        assertEquals("/study", IncomingText.route("/study"));
        assertEquals("/search?q=%E4%BD%A0", IncomingText.route("/search?q=%E4%BD%A0"));
        assertNull(IncomingText.route("https://evil.example/"));
        assertNull(IncomingText.route("//evil.example"));
        assertNull(IncomingText.route("javascript:alert(1)"));
        assertNull(IncomingText.route("study"));
        assertNull(IncomingText.route("/a\nb"));
        assertNull(IncomingText.route(null));
        assertNull(IncomingText.route("/" + "x".repeat(600)));
    }
}
