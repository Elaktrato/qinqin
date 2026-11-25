package qinqin.shell;

import android.content.Intent;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Share out (the system share sheet with a text) and what comes in (IncomingStore). */
@CapacitorPlugin(name = "QinqinShare")
public class SharePlugin extends Plugin {
    private static final int MAX_OUT = 20000;

    @Override
    public void load() {
        IncomingStore.onArrival(() -> notifyListeners("incoming", new JSObject()));
    }

    /** `{text, title?}`: opens the share sheet. Resolves when it is shown; what the person does there is not reported. */
    @PluginMethod
    public void shareText(PluginCall call) {
        String text = call.getString("text", "");
        if (text == null || text.trim().isEmpty()) {
            call.reject("nothing to share");
            return;
        }
        if (text.length() > MAX_OUT) text = text.substring(0, MAX_OUT);
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        send.putExtra(Intent.EXTRA_TEXT, text);
        String title = call.getString("title");
        if (title != null && !title.isEmpty()) send.putExtra(Intent.EXTRA_SUBJECT, title.length() > 200 ? title.substring(0, 200) : title);
        Intent chooser = Intent.createChooser(send, null);
        getActivity().startActivity(chooser);
        call.resolve();
    }

    /** `{items: [{kind: "text" | "route", value}]}`: what arrived since the last call; the queue is emptied. */
    @PluginMethod
    public void takeIncoming(PluginCall call) {
        JSArray items = new JSArray();
        for (IncomingStore.Item i : IncomingStore.drain()) {
            JSObject o = new JSObject();
            o.put("kind", i.kind);
            o.put("value", i.value);
            items.put(o);
        }
        JSObject r = new JSObject();
        r.put("items", items);
        call.resolve(r);
    }

    @Override
    protected void handleOnDestroy() {
        IncomingStore.onArrival(null);
    }
}
