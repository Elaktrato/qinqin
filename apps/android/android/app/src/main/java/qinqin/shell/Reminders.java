package qinqin.shell;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Local notifications without Google services: AlarmManager (inexact, allowed while idle) wakes ReminderReceiver,
 * which posts a NotificationCompat notification. The pending ones are kept in SharedPreferences so BootReceiver
 * can arm them again after a reboot or an app update (both clear alarms).
 */
final class Reminders {
    private static final String PREFS = "qinqin.reminders";
    private static final String KEY = "pending";
    static final String EXTRA_ID = "qinqin.shell.REMINDER_ID";

    private Reminders() {}

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static synchronized List<ReminderSpec> all(Context c) {
        List<ReminderSpec> out = new ArrayList<>();
        for (String line : prefs(c).getStringSet(KEY, new HashSet<>())) {
            ReminderSpec s = ReminderSpec.decode(line);
            if (s != null) out.add(s);
        }
        return out;
    }

    private static void save(Context c, List<ReminderSpec> list) {
        Set<String> set = new HashSet<>();
        for (ReminderSpec s : list) set.add(s.encode());
        prefs(c).edit().putStringSet(KEY, set).apply();
    }

    static synchronized void put(Context c, ReminderSpec spec) {
        List<ReminderSpec> list = new ArrayList<>();
        for (ReminderSpec s : all(c)) if (s.id != spec.id) list.add(s);
        list.add(spec);
        save(c, list);
        arm(c, spec);
    }

    static synchronized ReminderSpec get(Context c, int id) {
        for (ReminderSpec s : all(c)) if (s.id == id) return s;
        return null;
    }

    static synchronized void remove(Context c, int id) {
        List<ReminderSpec> list = new ArrayList<>();
        for (ReminderSpec s : all(c)) if (s.id != id) list.add(s);
        save(c, list);
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        am.cancel(alarmIntent(c, id));
    }

    static synchronized void removeAll(Context c) {
        for (ReminderSpec s : all(c)) remove(c, s.id);
        save(c, new ArrayList<>());
    }

    /** After a reboot or an update: arm every stored reminder that is still in the future, forget the rest. */
    static synchronized void rearm(Context c, long now) {
        List<ReminderSpec> keep = ReminderSpec.upcoming(all(c), now);
        save(c, keep);
        for (ReminderSpec s : keep) arm(c, s);
    }

    private static PendingIntent alarmIntent(Context c, int id) {
        Intent i = new Intent(c, ReminderReceiver.class).putExtra(EXTRA_ID, id);
        return PendingIntent.getBroadcast(c, id, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** Inexact on purpose (no SCHEDULE_EXACT_ALARM special access): it may fire minutes late in Doze. */
    private static void arm(Context c, ReminderSpec spec) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, spec.at, alarmIntent(c, spec.id));
    }

    static void ensureChannel(Context c, String id, String name) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(id) == null) {
            nm.createNotificationChannel(new NotificationChannel(id, name, NotificationManager.IMPORTANCE_DEFAULT));
        }
    }

    /** Posts the notification of a stored reminder (ReminderReceiver) and forgets it. */
    static void post(Context c, ReminderSpec spec) {
        ensureChannel(c, spec.channelId, spec.channelName);
        Intent open = new Intent(c, MainActivity.class).setAction(Intent.ACTION_MAIN).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (spec.route != null) open.putExtra(IncomingStore.EXTRA_ROUTE, spec.route);
        PendingIntent tap = PendingIntent.getActivity(c, spec.id, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, spec.channelId)
            .setSmallIcon(R.drawable.ic_stat_qinqin)
            .setContentTitle(spec.title)
            .setContentText(spec.body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(spec.body))
            .setContentIntent(tap)
            .setAutoCancel(true);
        try {
            NotificationManagerCompat.from(c).notify(spec.id, b.build());
        } catch (SecurityException denied) {
            // POST_NOTIFICATIONS revoked since it was scheduled: nothing to show.
        }
        List<ReminderSpec> rest = new ArrayList<>();
        for (ReminderSpec s : all(c)) if (s.id != spec.id) rest.add(s);
        save(c, rest);
    }
}
