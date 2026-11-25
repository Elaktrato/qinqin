package qinqin.shell;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** The guard between the saved address and the WebView: only a bare http(s) origin may be opened. */
public class ServerStoreTest {
    @Test
    public void acceptsABareOrigin() {
        assertTrue(ServerStore.isOrigin("https://qinqin.example.org"));
        assertTrue(ServerStore.isOrigin("https://qinqin.example.org:8443"));
        assertTrue(ServerStore.isOrigin("http://10.0.2.2:8085"));
        assertTrue(ServerStore.isOrigin("http://[::1]:8085"));
        assertTrue(ServerStore.isOrigin("http://nas.local"));
    }

    @Test
    public void refusesAnythingElse() {
        assertFalse(ServerStore.isOrigin(null));
        assertFalse(ServerStore.isOrigin(""));
        assertFalse(ServerStore.isOrigin("qinqin.example.org"));
        assertFalse(ServerStore.isOrigin("ftp://example.org"));
        assertFalse(ServerStore.isOrigin("javascript:alert(1)"));
        assertFalse(ServerStore.isOrigin("file:///sdcard/x.html"));
        assertFalse(ServerStore.isOrigin("https://user:pw@example.org"));
        assertFalse(ServerStore.isOrigin("https://example.org/path"));
        assertFalse(ServerStore.isOrigin("https://example.org/?q=1"));
        assertFalse(ServerStore.isOrigin("https://example.org#x"));
        assertFalse(ServerStore.isOrigin("https://"));
        assertFalse(ServerStore.isOrigin("not a url"));
    }
}
