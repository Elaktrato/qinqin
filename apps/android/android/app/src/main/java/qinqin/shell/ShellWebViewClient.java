package qinqin.shell;

import android.net.Uri;
import android.net.http.SslError;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceError;
import android.webkit.WebResourceResponse;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

/**
 * The stock Capacitor client, plus: when the saved server's own page fails to load (nothing answered, no service
 * worker could serve it, or its certificate is bad), the activity restarts into the first-run screen, which shows
 * the error with Retry and Change server. Chrome's error page is never shown for the app's own origin.
 */
class ShellWebViewClient extends BridgeWebViewClient {
    private final MainActivity activity;
    private final String server;
    private boolean started = false;

    ShellWebViewClient(Bridge bridge, MainActivity activity, String server) {
        super(bridge);
        this.activity = activity;
        this.server = server;
    }

    private boolean isServerPage(Uri url) {
        return server != null && url != null && server.equals(url.getScheme() + "://" + url.getAuthority());
    }

    @Override
    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        super.onReceivedError(view, request, error);
        if (!request.isForMainFrame() || !isServerPage(request.getUrl())) return;
        switch (error.getErrorCode()) {
            case ERROR_HOST_LOOKUP:
            case ERROR_CONNECT:
            case ERROR_IO:
            case ERROR_TIMEOUT:
            case ERROR_PROXY_AUTHENTICATION:
                activity.showFirstRunError(error.getErrorCode() == ERROR_TIMEOUT ? "timeout" : "unreachable");
                break;
            case ERROR_FAILED_SSL_HANDSHAKE:
                activity.showFirstRunError("tls");
                break;
            default:
                // ERROR_UNKNOWN (also an aborted navigation) and the rest: leave the page alone.
                break;
        }
    }

    /**
     * The server answered the first page with an HTTP error (a proxy's 502, a 404 from something that is not
     * qinqin): there is nothing to use, so offer the first-run screen. Only the initial load counts; later
     * navigations are the web app's own. A service-worker answer (offline start) is a 200 and never lands here.
     */
    @Override
    public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
        super.onReceivedHttpError(view, request, response);
        if (!started && request.isForMainFrame() && isServerPage(request.getUrl()) && response.getStatusCode() >= 400) {
            activity.showFirstRunError("notQinqin");
        }
    }

    @Override
    public void onPageFinished(WebView view, String url) {
        super.onPageFinished(view, url);
        started = true;
    }

    @Override
    public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
        handler.cancel();
        if (isServerPage(Uri.parse(error.getUrl()))) activity.showFirstRunError("tls");
    }
}
