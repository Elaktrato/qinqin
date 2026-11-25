package qinqin.shell;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

/**
 * The target of a reminder notification's tap. MainActivity is exported, so it cannot trust a route extra: any
 * app can start it with any extra. This activity is not exported, so only the PendingIntent that Reminders.post
 * built can reach it. It passes the route to the app in memory (IncomingStore.pushRoute, checked again), opens
 * MainActivity with a plain MAIN intent and finishes.
 */
public class NotificationTapActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        IncomingStore.pushRoute(getIntent().getStringExtra(IncomingStore.EXTRA_ROUTE));
        startActivity(new Intent(this, MainActivity.class)
            .setAction(Intent.ACTION_MAIN)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP));
        finish();
    }
}
