package qinqin.shell;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** The alarm of a scheduled local notification fired: post it. Not exported: only this app's own alarm reaches it. */
public class ReminderReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        int id = intent.getIntExtra(Reminders.EXTRA_ID, -1);
        ReminderSpec spec = id < 0 ? null : Reminders.get(context, id);
        if (spec != null) Reminders.post(context, spec);
    }
}
