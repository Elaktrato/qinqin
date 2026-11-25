package qinqin.shell;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Local notifications, groundwork for the reminders (#137-#139): permission (Android 13's POST_NOTIFICATIONS),
 * schedule and cancel by id, a channel the web app names, a route a tap opens. No Firebase, no Play Services:
 * AlarmManager and NotificationCompat only (Reminders).
 */
@CapacitorPlugin(
    name = "QinqinNotifications",
    permissions = {@Permission(strings = {Manifest.permission.POST_NOTIFICATIONS}, alias = "notifications")}
)
public class NotificationsPlugin extends Plugin {
    private static final String ASKED = "asked";

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences("qinqin.notifications", Context.MODE_PRIVATE);
    }

    /** "granted", "denied" or "prompt" (never asked, so the system dialog can still be shown). */
    private String state() {
        Context c = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            boolean granted = ContextCompat.checkSelfPermission(c, Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED;
            if (!granted) return prefs().getBoolean(ASKED, false) ? "denied" : "prompt";
        }
        return NotificationManagerCompat.from(c).areNotificationsEnabled() ? "granted" : "denied";
    }

    private JSObject answer() {
        JSObject r = new JSObject();
        r.put("state", state());
        return r;
    }

    @PluginMethod
    public void permission(PluginCall call) {
        call.resolve(answer());
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || !state().equals("prompt")) {
            call.resolve(answer());
            return;
        }
        requestPermissionForAlias("notifications", call, "afterRequest");
    }

    @PermissionCallback
    private void afterRequest(PluginCall call) {
        prefs().edit().putBoolean(ASKED, true).apply();
        call.resolve(answer());
    }

    /** `{id, title, body?, at, channel: {id, name}, route?}`; `at` is epoch milliseconds in the future. */
    @PluginMethod
    public void schedule(PluginCall call) {
        JSObject channel = call.getObject("channel", new JSObject());
        Long id = ReminderSpec.asLong(call.getData().opt("id"));
        Long at = ReminderSpec.asLong(call.getData().opt("at"));
        ReminderSpec spec = (id == null || at == null) ? null : ReminderSpec.of(
            id, call.getString("title"), call.getString("body"), at,
            channel.getString("id"), channel.getString("name"), call.getString("route"));
        if (spec == null) {
            call.reject("not a valid notification");
            return;
        }
        if (spec.at <= System.currentTimeMillis()) {
            call.reject("in the past");
            return;
        }
        Reminders.ensureChannel(getContext(), spec.channelId, spec.channelName);
        Reminders.put(getContext(), spec);
        call.resolve();
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        Long id = ReminderSpec.asLong(call.getData().opt("id"));
        if (id == null || id < 0 || id > Integer.MAX_VALUE) {
            call.reject("bad id");
            return;
        }
        Reminders.remove(getContext(), (int) (long) id);
        NotificationManagerCompat.from(getContext()).cancel((int) (long) id);
        call.resolve();
    }

    @PluginMethod
    public void cancelAll(PluginCall call) {
        Reminders.removeAll(getContext());
        NotificationManagerCompat.from(getContext()).cancelAll();
        call.resolve();
    }

    /** `{ids}`: the scheduled ones that have not fired yet. */
    @PluginMethod
    public void pending(PluginCall call) {
        JSArray ids = new JSArray();
        for (ReminderSpec s : Reminders.all(getContext())) ids.put(s.id);
        JSObject r = new JSObject();
        r.put("ids", ids);
        call.resolve(r);
    }
}
