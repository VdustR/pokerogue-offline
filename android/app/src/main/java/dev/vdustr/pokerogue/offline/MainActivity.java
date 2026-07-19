package dev.vdustr.pokerogue.offline;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.IOException;
import java.io.OutputStream;

public final class MainActivity extends Activity {
    private static final int OPEN_SAVE_REQUEST = 1001;
    private static final int CREATE_SAVE_REQUEST = 1002;
    private static final int MAX_EXPORTED_SAVE_BYTES = 64 * 1024 * 1024;

    private WebView webView;
    private ValueCallback<Uri[]> fileChooserCallback;
    private byte[] pendingDownload;
    private String pendingDownloadMimeType;

    @Override
    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.BLACK);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSafeBrowsingEnabled(true);
        settings.setSupportZoom(false);

        CookieManager.getInstance().setAcceptCookie(false);
        webView.addJavascriptInterface(new SaveDownloadBridge(), "PokerogueAndroid");
        webView.setWebViewClient(new OfflineAssetWebViewClient(getAssets()));
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                WebView view,
                ValueCallback<Uri[]> callback,
                FileChooserParams fileChooserParams
            ) {
                if (fileChooserCallback != null) {
                    fileChooserCallback.onReceiveValue(null);
                }
                fileChooserCallback = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT)
                    .addCategory(Intent.CATEGORY_OPENABLE)
                    .setType("*/*");
                startActivityForResult(intent, OPEN_SAVE_REQUEST);
                return true;
            }
        });
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            if (url == null || !url.startsWith("blob:")) {
                Toast.makeText(this, "Only local save exports are supported.", Toast.LENGTH_SHORT).show();
                return;
            }
            String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);
            String script = "(async()=>{const r=await fetch(" + JSONObject.quote(url)
                + ");const b=await r.blob();const x=new FileReader();x.onloadend=()=>PokerogueAndroid.saveBase64("
                + JSONObject.quote(fileName) + "," + JSONObject.quote(mimeType == null ? "application/octet-stream" : mimeType)
                + ",String(x.result).split(',')[1]);x.readAsDataURL(b);})()";
            webView.evaluateJavascript(script, null);
        });

        setContentView(webView);
        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            webView.loadUrl(OfflineAssetWebViewClient.APP_ORIGIN + "/index.html");
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == OPEN_SAVE_REQUEST) {
            Uri[] result = resultCode == RESULT_OK && data != null && data.getData() != null
                ? new Uri[] { data.getData() }
                : null;
            if (fileChooserCallback != null) {
                fileChooserCallback.onReceiveValue(result);
                fileChooserCallback = null;
            }
            return;
        }

        if (requestCode == CREATE_SAVE_REQUEST && pendingDownload != null) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                try (OutputStream output = getContentResolver().openOutputStream(data.getData())) {
                    if (output == null) throw new IOException("The selected destination could not be opened");
                    output.write(pendingDownload);
                    Toast.makeText(this, "Save exported.", Toast.LENGTH_SHORT).show();
                } catch (IOException error) {
                    Toast.makeText(this, "Save export failed.", Toast.LENGTH_LONG).show();
                }
            }
            pendingDownload = null;
            pendingDownloadMimeType = null;
        }
    }

    @Override
    protected void onDestroy() {
        webView.removeJavascriptInterface("PokerogueAndroid");
        webView.stopLoading();
        webView.destroy();
        super.onDestroy();
    }

    public final class SaveDownloadBridge {
        @JavascriptInterface
        public void saveBase64(String fileName, String mimeType, String base64Data) {
            byte[] decoded;
            try {
                decoded = Base64.decode(base64Data, Base64.DEFAULT);
            } catch (IllegalArgumentException error) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "Invalid save export.", Toast.LENGTH_LONG).show());
                return;
            }
            if (decoded.length > MAX_EXPORTED_SAVE_BYTES) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "Save export is unexpectedly large.", Toast.LENGTH_LONG).show());
                return;
            }

            String safeName = fileName == null ? "pokerogue_saves.zip" : fileName.replaceAll("[^A-Za-z0-9._-]", "_");
            pendingDownload = decoded;
            pendingDownloadMimeType = mimeType;
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
                    .addCategory(Intent.CATEGORY_OPENABLE)
                    .setType(pendingDownloadMimeType == null ? "application/octet-stream" : pendingDownloadMimeType)
                    .putExtra(Intent.EXTRA_TITLE, safeName);
                startActivityForResult(intent, CREATE_SAVE_REQUEST);
            });
        }
    }
}
