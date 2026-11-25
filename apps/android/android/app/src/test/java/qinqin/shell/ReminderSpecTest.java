package qinqin.shell;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.List;
import org.junit.Test;

/** A scheduled local notification: what is accepted and how it is stored for the re-arm after a reboot. */
public class ReminderSpecTest {
    private ReminderSpec ok() {
        return ReminderSpec.of(7, "Time to study", "12 cards due", 1_800_000_000_000L, "reminders", "Study reminders", "/study");
    }

    @Test
    public void roundTripsThroughItsStoredForm() {
        ReminderSpec a = ok();
        ReminderSpec b = ReminderSpec.decode(a.encode());
        assertEquals(a.id, b.id);
        assertEquals("Time to study", b.title);
        assertEquals("12 cards due", b.body);
        assertEquals(1_800_000_000_000L, b.at);
        assertEquals("reminders", b.channelId);
        assertEquals("Study reminders", b.channelName);
        assertEquals("/study", b.route);
    }

    @Test
    public void survivesSeparatorsAndUnicodeInText() {
        ReminderSpec a = ReminderSpec.of(1, "a|b\nc", "你好 | 世界", 5L, "c", "名前", null);
        ReminderSpec b = ReminderSpec.decode(a.encode());
        assertEquals("a|b\nc", b.title);
        assertEquals("你好 | 世界", b.body);
        assertEquals("名前", b.channelName);
        assertNull(b.route);
    }

    @Test
    public void refusesBadInput() {
        assertNull(ReminderSpec.of(-1, "t", "b", 5L, "c", "n", null));
        assertNull(ReminderSpec.of(1, "", "b", 5L, "c", "n", null));
        assertNull(ReminderSpec.of(1, "t", "b", 0L, "c", "n", null));
        assertNull(ReminderSpec.of(1, "t", "b", 5L, "", "n", null));
        assertNull(ReminderSpec.of(1, "t", "b", 5L, "c", "n", "https://x.example"));
        assertNull(ReminderSpec.decode("garbage"));
    }

    @Test
    public void textIsCapped() {
        ReminderSpec a = ReminderSpec.of(1, "t".repeat(500), "b".repeat(2000), 5L, "c", "n", null);
        assertEquals(100, a.title.length());
        assertEquals(500, a.body.length());
    }

    @Test
    public void rearmKeepsOnlyTheFutureOnes() {
        ReminderSpec past = ReminderSpec.of(1, "t", "b", 1000L, "c", "n", null);
        ReminderSpec future = ReminderSpec.of(2, "t", "b", 9000L, "c", "n", null);
        List<ReminderSpec> keep = ReminderSpec.upcoming(List.of(past, future), 5000L);
        assertEquals(1, keep.size());
        assertTrue(keep.get(0).id == 2);
    }

    @Test
    public void wholeNumbersFromJsonWhateverTheirBoxing() {
        assertEquals(Long.valueOf(4242), ReminderSpec.asLong(Integer.valueOf(4242)));
        assertEquals(Long.valueOf(1_800_000_000_000L), ReminderSpec.asLong(Long.valueOf(1_800_000_000_000L)));
        assertEquals(Long.valueOf(7), ReminderSpec.asLong(Double.valueOf(7.0)));
        assertNull(ReminderSpec.asLong(Double.valueOf(7.5)));
        assertNull(ReminderSpec.asLong("7"));
        assertNull(ReminderSpec.asLong(null));
    }
}
