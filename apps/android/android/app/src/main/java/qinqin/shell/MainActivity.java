package qinqin.shell;

import android.content.Intent;
import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import com.getcapacitor.BridgeActivity;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.CapConfig;

/**
 * Capacitor's `server.url` is a build-time setting, but the server is whatever the person typed. So the
 * activity builds the config itself, on every start:
 * - a saved server: serverUrl is that origin, and only that origin gets the bridge (the document-start script
 *   and the message listener are limited to the server URL's origin; links to other hosts open in the system
 *   browser, Bridge.launchIntent);
 * - none (first run, after Change server, or the saved server failed): the bundled first-run screen at
 *   https://localhost, with the failure kind in its query.
 * Plugin options live in capacitor.config.ts; the ones that matter here are set below.
 */
public class MainActivity extends BridgeActivity {
    /** The launcher shortcut "Change server" (res/xml/shortcuts.xml): forget the saved server, show the form. */
    static final String ACTION_CHANGE_SERVER = "qinqin.shell.CHANGE_SERVER";

    private String server;
    private boolean failing;

    /** True while the bundled first-run screen is the page: no server is open (set in load()). */
    boolean isFirstRunScreen() {
        return server == null;
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        EdgeToEdge.enable(this);
        registerPlugin(ShellPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void load() {
        if (consumeChangeServer(getIntent())) ServerStore.clear(this);
        server = ServerStore.get(this);
        String failure = server == null ? null : ServerStore.takeError();
        // Old WebViews lack the message listener and the document-start script: Capacitor then exposes its
        // bridge to every page and frame it loads. Never open a remote server like that.
        if (server != null && failure == null && !webViewIsCurrent()) failure = "webview";
        CapConfig.Builder b = new CapConfig.Builder(this);
        if (server != null && failure == null) {
            b.setServerUrl(server);
        } else {
            String shown = server != null ? server : ServerStore.last(this);
            StringBuilder start = new StringBuilder("/index.html");
            String sep = "?";
            if (failure != null) {
                start.append(sep).append("error=").append(failure);
                sep = "&";
            }
            if (shown != null) start.append(sep).append("server=").append(android.net.Uri.encode(shown));
            b.setStartPath(start.toString());
            // The saved server stays saved: Retry loads it again, Change server forgets it.
            server = null;
        }
        config = b.create();
        super.load();
        if (server != null) {
            getBridge().setWebViewClient(new ShellWebViewClient(getBridge(), this, server));
            recheckServer(server);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (consumeChangeServer(intent)) {
            ServerStore.clear(this);
            recreate();
        }
    }

    private static boolean consumeChangeServer(Intent intent) {
        if (intent == null || !ACTION_CHANGE_SERVER.equals(intent.getAction())) return false;
        intent.setAction(Intent.ACTION_MAIN);
        return true;
    }

    private static boolean webViewIsCurrent() {
        return WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
            && WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT);
    }

    /**
     * On an online start, ask the saved server who it is, off the main thread. A real answer that is not
     * qinqin's (error page, parked domain, captive portal) offers the first-run screen; no answer at all is
     * left alone, so the service worker still opens the app offline.
     */
    private void recheckServer(String origin) {
        new Thread(() -> {
            if (ServerCheck.check(origin) == ServerCheck.Result.NOT_QINQIN) showFirstRunError("notQinqin");
        }, "qinqin-server-check").start();
    }

    /** The saved server's page failed to load: show the first-run screen with the failure. */
    void showFirstRunError(String kind) {
        if (failing) return;
        failing = true;
        ServerStore.failed(kind);
        runOnUiThread(this::recreate);
    }
}
