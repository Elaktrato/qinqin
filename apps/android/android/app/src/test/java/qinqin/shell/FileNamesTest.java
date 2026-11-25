package qinqin.shell;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class FileNamesTest {
    @Test
    public void keepsAGoodName() {
        assertEquals("qinqin-backup-2026-11-25.zip", FileNames.safe("qinqin-backup-2026-11-25.zip"));
        assertEquals("日記.txt", FileNames.safe("日記.txt"));
    }

    @Test
    public void removesPathsAndControlCharacters() {
        assertEquals("_.._etc_passwd", FileNames.safe("../../etc/passwd"));
        assertEquals("a_b", FileNames.safe("a\u0000b"));
        assertEquals("a_b_c", FileNames.safe("a\\b:c"));
    }

    @Test
    public void emptyGetsADefaultAndLongIsCut() {
        assertEquals("qinqin-export", FileNames.safe(null));
        assertEquals("qinqin-export", FileNames.safe("  ..."));
        assertEquals(120, FileNames.safe("x".repeat(500)).length());
    }
}
