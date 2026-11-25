package qinqin.shell;

import android.content.Intent;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;

/**
 * What reached the app from outside while it ran or started: a text another app shared ("Share" > qinqin), a
 * text selected elsewhere ("Look up in qinqin"), or the route of a tapped notification (via NotificationTapActivity). The web app drains it
 * when its session is ready (QinqinShare.takeIncoming), so nothing is lost while it loads or while the person
 * signs in. In memory only: the queue dies with the process, which is fine for a tap or a share.
 */
final class IncomingStore {
    /**
     * The route a notification tap carries, as an extra of the PendingIntent that opens NotificationTapActivity
     * (not exported: only this app can start it). MainActivity is exported, so it never reads a route from an
     * intent: any app can send it any extra. The trampoline hands the route over in-process (pushRoute).
     */
    static final String EXTRA_ROUTE = "qinqin.shell.ROUTE";
    private static final int MAX_ITEMS = 5;

    static final class Item {
        final String kind;
        final String value;

        Item(String kind, String value) {
            this.kind = kind;
            this.value = value;
        }
    }

    private static final ArrayDeque<Item> queue = new ArrayDeque<>();
    private static Runnable listener;

    private IncomingStore() {}

    /** Adds what `intent` carries, then makes it inert so a recreated activity does not replay it. */
    static synchronized void take(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        String text = null;
        if (Intent.ACTION_SEND.equals(action) && "text/plain".equals(intent.getType())) {
            text = IncomingText.clean(intent.getStringExtra(Intent.EXTRA_TEXT));
        } else if (Intent.ACTION_PROCESS_TEXT.equals(action)) {
            text = IncomingText.clean(intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT));
        }
        boolean any = false;
        if (text != null) any |= push("text", text);
        if (Intent.ACTION_SEND.equals(action) || Intent.ACTION_PROCESS_TEXT.equals(action)) {
            intent.setAction(Intent.ACTION_MAIN);
        }
        if (any && listener != null) listener.run();
    }

    /** A tapped notification's route, from NotificationTapActivity (in-process, so not forgeable). Checked again here. */
    static synchronized void pushRoute(String route) {
        String clean = IncomingText.route(route);
        if (clean == null) return;
        push("route", clean);
        if (listener != null) listener.run();
    }

    private static boolean push(String kind, String value) {
        if (queue.size() >= MAX_ITEMS) queue.pollFirst();
        queue.addLast(new Item(kind, value));
        return true;
    }

    static synchronized List<Item> drain() {
        List<Item> out = new ArrayList<>(queue);
        queue.clear();
        return out;
    }

    /** The plugin's "something arrived" hook (one at a time: the plugin of the current activity). */
    static synchronized void onArrival(Runnable r) {
        listener = r;
    }
}
