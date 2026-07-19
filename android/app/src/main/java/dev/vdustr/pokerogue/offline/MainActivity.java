package dev.vdustr.pokerogue.offline;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.view.DisplayCutout;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.IOException;
import java.io.OutputStream;

public final class MainActivity extends Activity {
    private static final int OPEN_SAVE_REQUEST = 1001;
    private static final int CREATE_SAVE_REQUEST = 1002;
    private static final int MAX_EXPORTED_SAVE_BYTES = 64 * 1024 * 1024;

    private FrameLayout rootView;
    private WebView webView;
    private ValueCallback<Uri[]> fileChooserCallback;
    private byte[] pendingDownload;
    private String pendingDownloadMimeType;

    @Override
    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        configureFullscreenWindow();

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

        rootView = new FrameLayout(this);
        rootView.setBackgroundColor(Color.BLACK);
        rootView.addView(webView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));
        applyDisplayCutoutSafeArea();
        setContentView(rootView);
        getWindow().getDecorView().post(this::hideSystemBars);
        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            webView.loadUrl(OfflineAssetWebViewClient.APP_ORIGIN + "/index.html");
        }
    }

    private void configureFullscreenWindow() {
        Window window = getWindow();
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams attributes = window.getAttributes();
            attributes.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            window.setAttributes(attributes);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false);
        }
    }

    @SuppressWarnings("deprecation")
    private void hideSystemBars() {
        Window window = getWindow();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                controller.setSystemBarsBehavior(
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                );
                controller.hide(WindowInsets.Type.systemBars());
            }
            return;
        }

        window.getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        );
    }

    private void applyDisplayCutoutSafeArea() {
        rootView.setOnApplyWindowInsetsListener((view, windowInsets) -> {
            int left = 0;
            int top = 0;
            int right = 0;
            int bottom = 0;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                DisplayCutout cutout = windowInsets.getDisplayCutout();
                if (cutout != null) {
                    left = cutout.getSafeInsetLeft();
                    top = cutout.getSafeInsetTop();
                    right = cutout.getSafeInsetRight();
                    bottom = cutout.getSafeInsetBottom();
                }
            }
            if (
                view.getPaddingLeft() != left
                    || view.getPaddingTop() != top
                    || view.getPaddingRight() != right
                    || view.getPaddingBottom() != bottom
            ) {
                view.setPadding(left, top, right, bottom);
            }
            return windowInsets;
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        hideSystemBars();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            hideSystemBars();
        }
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        rootView.requestApplyInsets();
        hideSystemBars();
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
