package qinqin.shell;

import android.app.Activity;
import android.graphics.Color;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * qinqin's own tiny Capacitor plugin ("QinqinShell"): the saved server address, "Change server", and the colour
 * behind the system bars. Everything else the web app needs from the shell is a stock Capacitor plugin.
 */
@CapacitorPlugin(name = "QinqinShell")
public class ShellPlugin extends Plugin {

    @PluginMethod
    public void getServer(PluginCall call) {
        JSObject r = new JSObject();
        r.put("url", ServerStore.get(getContext()));
        r.put("lastUrl", ServerStore.last(getContext()));
        call.resolve(r);
    }

    /** Saves the address and starts the web app from it. */
    @PluginMethod
    public void setServer(PluginCall call) {
        String url = call.getString("url", "");
        if (!ServerStore.isOrigin(url)) {
            call.reject("not an origin");
            return;
        }
        ServerStore.set(getContext(), url);
        call.resolve();
        reload();
    }

    /** Forgets the address and shows the first-run screen. */
    @PluginMethod
    public void clearServer(PluginCall call) {
        ServerStore.clear(getContext());
        call.resolve();
        reload();
    }

    /** Tries the saved server again (the first-run screen's Retry). */
    @PluginMethod
    public void retry(PluginCall call) {
        call.resolve();
        reload();
    }

    /** The system bars: the colour behind them and whether their icons are dark (on a light colour). */
    @PluginMethod
    public void setBars(PluginCall call) {
        String color = call.getString("background", "");
        boolean darkIcons = Boolean.TRUE.equals(call.getBoolean("darkIcons", false));
        int parsed;
        try {
            parsed = Color.parseColor(color);
        } catch (IllegalArgumentException e) {
            call.reject("background must be #rrggbb");
            return;
        }
        final int background = parsed;
        final Activity activity = getActivity();
        activity.runOnUiThread(() -> {
            Window window = activity.getWindow();
            window.getDecorView().setBackgroundColor(background);
            WindowInsetsControllerCompat c = WindowCompat.getInsetsController(window, window.getDecorView());
            c.setAppearanceLightStatusBars(darkIcons);
            c.setAppearanceLightNavigationBars(darkIcons);
            call.resolve();
        });
    }

    private void reload() {
        getActivity().runOnUiThread(() -> getActivity().recreate());
    }
}
