package qinqin.shell;

import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import com.getcapacitor.BridgeActivity;
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
    private String server;
    private boolean failing;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        EdgeToEdge.enable(this);
        registerPlugin(ShellPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void load() {
        server = ServerStore.get(this);
        String failure = server == null ? null : ServerStore.takeError();
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
        if (server != null) getBridge().setWebViewClient(new ShellWebViewClient(getBridge(), this, server));
    }

    /** The saved server's page failed to load: show the first-run screen with the failure. */
    void showFirstRunError(String kind) {
        if (failing) return;
        failing = true;
        ServerStore.failed(kind);
        runOnUiThread(this::recreate);
    }
}
