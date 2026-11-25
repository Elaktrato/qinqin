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

    @Test
    public void allowsPlainHttpOnlyOnPrivateHosts() {
        assertTrue(ServerStore.isAllowedOrigin("https://qinqin.example.org"));
        assertTrue(ServerStore.isAllowedOrigin("http://10.0.2.2:8085"));
        assertTrue(ServerStore.isAllowedOrigin("http://192.168.1.20"));
        assertTrue(ServerStore.isAllowedOrigin("http://172.16.0.1"));
        assertTrue(ServerStore.isAllowedOrigin("http://169.254.1.1"));
        assertTrue(ServerStore.isAllowedOrigin("http://127.0.0.1:8080"));
        assertTrue(ServerStore.isAllowedOrigin("http://[::1]:8085"));
        assertTrue(ServerStore.isAllowedOrigin("http://[fd12:3456::1]"));
        assertTrue(ServerStore.isAllowedOrigin("http://[fe80::1]"));
        assertTrue(ServerStore.isAllowedOrigin("http://nas"));
        assertTrue(ServerStore.isAllowedOrigin("http://nas.local"));
        assertTrue(ServerStore.isAllowedOrigin("http://localhost:3000"));
        assertFalse(ServerStore.isAllowedOrigin("http://qinqin.example.org"));
        assertFalse(ServerStore.isAllowedOrigin("http://8.8.8.8"));
        assertFalse(ServerStore.isAllowedOrigin("http://172.32.0.1"));
        assertFalse(ServerStore.isAllowedOrigin("http://100.64.0.1"));
        assertFalse(ServerStore.isAllowedOrigin("http://[2001:db8::1]"));
        assertFalse(ServerStore.isAllowedOrigin("http://256.1.1.1"));
        assertFalse(ServerStore.isAllowedOrigin("http://my_nas"));
        assertFalse(ServerStore.isAllowedOrigin("ftp://nas"));
    }
}
