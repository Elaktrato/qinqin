package qinqin.shell;

import android.content.Intent;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;

/**
 * What reached the app from outside while it ran or started: a text another app shared ("Share" > qinqin), a
 * text selected elsewhere ("Look up in qinqin"), or the route of a tapped notification. The web app drains it
 * when its session is ready (QinqinShare.takeIncoming), so nothing is lost while it loads or while the person
 * signs in. In memory only: the queue dies with the process, which is fine for a tap or a share.
 */
final class IncomingStore {
    /** The route a notification tap carries (an Intent extra set by this app's own PendingIntent). */
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
        String route = IncomingText.route(intent.getStringExtra(EXTRA_ROUTE));
        boolean any = false;
        if (text != null) any |= push("text", text);
        if (route != null) any |= push("route", route);
        if (Intent.ACTION_SEND.equals(action) || Intent.ACTION_PROCESS_TEXT.equals(action)) {
            intent.setAction(Intent.ACTION_MAIN);
        }
        intent.removeExtra(EXTRA_ROUTE);
        if (any && listener != null) listener.run();
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
