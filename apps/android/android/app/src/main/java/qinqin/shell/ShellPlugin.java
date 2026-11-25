package qinqin.shell;

import android.app.Activity;
import android.content.Context;
import android.graphics.Color;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.WindowManager;
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

    /**
     * Saves the address and starts the web app from it. Only the bundled first-run screen may do this: a
     * server's own page (the one remote origin that has the bridge) must not be able to repoint the app.
     */
    @PluginMethod
    public void setServer(PluginCall call) {
        if (!onFirstRunScreen()) {
            call.reject("only from the first-run screen");
            return;
        }
        String url = call.getString("url", "");
        if (!ServerStore.isAllowedOrigin(url)) {
            call.reject("not an allowed origin");
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
        if (!onFirstRunScreen()) {
            call.reject("only from the first-run screen");
            return;
        }
        call.resolve();
        reload();
    }

    /** The system bars: the colour behind them and whether their icons are dark (on a light colour). */
    @PluginMethod
    public void setBars(PluginCall call) {
        String color = call.getString("background", "");
        boolean darkIcons = Boolean.TRUE.equals(call.getBoolean("darkIcons", false));
        if (!isBarColor(color)) {
            call.reject("background must be #rrggbb");
            return;
        }
        final int background = Color.parseColor(color);
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

    /** `{on}`: keeps the screen on while the page asks (a study session); the flag dies with the activity. */
    @PluginMethod
    public void keepAwake(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        final Activity activity = getActivity();
        activity.runOnUiThread(() -> {
            Window window = activity.getWindow();
            if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }

    /** `{ms}`: one short vibration (grading feedback). Bounded to 10-200 ms; resolves `{vibrated}` (false: no vibrator). */
    @PluginMethod
    @SuppressWarnings("deprecation")
    public void vibrate(PluginCall call) {
        Integer asked = call.getInt("ms", 20);
        long ms = Math.max(10, Math.min(200, asked == null ? 20 : asked));
        Vibrator v = (Vibrator) getContext().getSystemService(Context.VIBRATOR_SERVICE);
        JSObject r = new JSObject();
        boolean ok = v != null && v.hasVibrator();
        if (ok) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) v.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
            else v.vibrate(ms);
        }
        r.put("vibrated", ok);
        call.resolve(r);
    }

    /** The one colour form the web app sends (bars.ts): `#rrggbb`. Named colours and `#aarrggbb` are refused. */
    static boolean isBarColor(String color) {
        return color != null && color.matches("#[0-9a-fA-F]{6}");
    }

    /** True while the bundled first-run screen is the page (no server is open: only then the bridge is its). */
    private boolean onFirstRunScreen() {
        return getActivity() instanceof MainActivity && ((MainActivity) getActivity()).isFirstRunScreen();
    }

    private void reload() {
        getActivity().runOnUiThread(() -> getActivity().recreate());
    }
}
