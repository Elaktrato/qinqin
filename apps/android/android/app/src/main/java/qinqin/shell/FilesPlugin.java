package qinqin.shell;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.io.OutputStream;
import java.util.UUID;

/**
 * Saving a file the web app made (a backup, the recovery codes). A WebView ignores blob downloads, so the page
 * hands the bytes over in chunks: begin() opens the system "save as" screen (Storage Access Framework: the
 * person picks the folder, Downloads is the usual one; no storage permission on any Android version), append()
 * writes a base64 chunk, finish() closes the file. One save at a time.
 */
@CapacitorPlugin(name = "QinqinFiles")
public class FilesPlugin extends Plugin {
    /** One chunk the page may send: 4 MiB of base64 (about 3 MiB of bytes). */
    private static final int MAX_CHUNK = 4 * 1024 * 1024;

    private String openId;
    private OutputStream open;

    /** `{name, mime}` -> `{id}` after the person chose where to save, or `{cancelled: true}`. */
    @PluginMethod
    public void begin(PluginCall call) {
        closeQuietly();
        String mime = call.getString("mime", "application/octet-stream");
        if (mime == null || !mime.matches("[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+")) mime = "application/octet-stream";
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mime);
        intent.putExtra(Intent.EXTRA_TITLE, FileNames.safe(call.getString("name", "")));
        startActivityForResult(call, intent, "picked");
    }

    @ActivityCallback
    private void picked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        Uri uri = data == null ? null : data.getData();
        JSObject r = new JSObject();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            r.put("cancelled", true);
            call.resolve(r);
            return;
        }
        try {
            open = getContext().getContentResolver().openOutputStream(uri);
        } catch (Exception e) {
            open = null;
        }
        if (open == null) {
            call.reject("cannot open the file");
            return;
        }
        openId = UUID.randomUUID().toString();
        r.put("id", openId);
        call.resolve(r);
    }

    /** `{id, data}`: one base64 chunk. */
    @PluginMethod
    public void append(PluginCall call) {
        String data = call.getString("data", "");
        if (open == null || !openId.equals(call.getString("id")) || data == null || data.length() > MAX_CHUNK) {
            call.reject("no save in progress");
            return;
        }
        try {
            open.write(Base64.decode(data, Base64.DEFAULT));
            call.resolve();
        } catch (IOException | IllegalArgumentException e) {
            closeQuietly();
            call.reject("write failed");
        }
    }

    @PluginMethod
    public void finish(PluginCall call) {
        if (open == null || !openId.equals(call.getString("id"))) {
            call.reject("no save in progress");
            return;
        }
        try {
            open.close();
            call.resolve();
        } catch (IOException e) {
            call.reject("close failed");
        } finally {
            open = null;
            openId = null;
        }
    }

    /** Gives up a save (the page failed halfway); the partly written file stays where the person put it. */
    @PluginMethod
    public void abort(PluginCall call) {
        closeQuietly();
        call.resolve();
    }

    private void closeQuietly() {
        try {
            if (open != null) open.close();
        } catch (IOException ignored) {
            // nothing to do
        }
        open = null;
        openId = null;
    }

    @Override
    protected void handleOnDestroy() {
        closeQuietly();
    }
}
