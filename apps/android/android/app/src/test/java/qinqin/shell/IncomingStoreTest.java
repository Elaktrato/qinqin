package qinqin.shell;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.List;
import org.junit.Before;
import org.junit.Test;

/** A notification tap's route reaches the web app only through the in-process hand-over, and only as an in-app path. */
public class IncomingStoreTest {
    @Before
    public void empty() {
        IncomingStore.drain();
    }

    @Test
    public void aRouteFromTheTapActivityIsQueued() {
        IncomingStore.pushRoute("/study");
        List<IncomingStore.Item> items = IncomingStore.drain();
        assertEquals(1, items.size());
        assertEquals("route", items.get(0).kind);
        assertEquals("/study", items.get(0).value);
        assertTrue(IncomingStore.drain().isEmpty());
    }

    @Test
    public void aBadRouteIsDropped() {
        IncomingStore.pushRoute("/x/../api/me");
        IncomingStore.pushRoute("//evil.example");
        IncomingStore.pushRoute("https://evil.example");
        IncomingStore.pushRoute(null);
        assertTrue(IncomingStore.drain().isEmpty());
    }

    @Test
    public void theListenerIsToldWhenARouteArrives() {
        final int[] calls = {0};
        IncomingStore.onArrival(() -> calls[0]++);
        IncomingStore.pushRoute("/study");
        IncomingStore.pushRoute("//bad");
        IncomingStore.onArrival(null);
        assertEquals(1, calls[0]);
    }
}
