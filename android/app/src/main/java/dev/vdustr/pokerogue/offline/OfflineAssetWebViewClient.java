package dev.vdustr.pokerogue.offline;

import android.content.res.AssetFileDescriptor;
import android.content.res.AssetManager;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

final class OfflineAssetWebViewClient extends WebViewClient {
    static final String APP_ORIGIN = "https://appassets.androidplatform.net";
    private static final String APP_HOST = "appassets.androidplatform.net";
    private static final String ASSET_ROOT = "www/";
    private final AssetManager assetManager;

    OfflineAssetWebViewClient(AssetManager assetManager) {
        this.assetManager = assetManager;
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri uri = request.getUrl();
        if (!"https".equals(uri.getScheme()) || !APP_HOST.equals(uri.getHost())) {
            return errorResponse(403, "Blocked");
        }

        String assetPath = sanitizePath(uri);
        if (assetPath == null) {
            return errorResponse(404, "Not found");
        }

        String rangeHeader = request.getRequestHeaders().get("Range");
        try {
            if (rangeHeader != null) {
                WebResourceResponse rangeResponse = openRange(assetPath, rangeHeader);
                if (rangeResponse != null) {
                    return rangeResponse;
                }
            }

            InputStream stream = assetManager.open(ASSET_ROOT + assetPath, AssetManager.ACCESS_STREAMING);
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", assetPath.equals("index.html") ? "no-cache" : "public, max-age=31536000, immutable");
            headers.put("X-Content-Type-Options", "nosniff");
            return new WebResourceResponse(mimeType(assetPath), null, 200, "OK", headers, stream);
        } catch (IOException error) {
            return errorResponse(404, "Not found");
        }
    }

    private String sanitizePath(Uri uri) {
        List<String> segments = uri.getPathSegments();
        StringBuilder path = new StringBuilder();
        for (String segment : segments) {
            if (segment.isEmpty() || segment.equals(".") || segment.equals("..") || segment.contains("\\")) {
                return null;
            }
            if (path.length() > 0) {
                path.append('/');
            }
            path.append(segment);
        }
        return path.length() == 0 ? "index.html" : path.toString();
    }

    private WebResourceResponse openRange(String assetPath, String rangeHeader) throws IOException {
        if (!rangeHeader.matches("bytes=\\d+-\\d*")) {
            return null;
        }

        AssetFileDescriptor descriptor;
        try {
            descriptor = assetManager.openFd(ASSET_ROOT + assetPath);
        } catch (IOException compressedAsset) {
            return null;
        }

        long totalLength = descriptor.getLength();
        String[] bounds = rangeHeader.substring("bytes=".length()).split("-", 2);
        long start = Long.parseLong(bounds[0]);
        long end = bounds.length > 1 && !bounds[1].isEmpty() ? Long.parseLong(bounds[1]) : totalLength - 1;
        if (start < 0 || start >= totalLength || end < start) {
            descriptor.close();
            return errorResponse(416, "Range not satisfiable");
        }
        end = Math.min(end, totalLength - 1);

        FileInputStream stream = descriptor.createInputStream();
        skipFully(stream, start);
        long responseLength = end - start + 1;
        Map<String, String> headers = new HashMap<>();
        headers.put("Accept-Ranges", "bytes");
        headers.put("Content-Length", Long.toString(responseLength));
        headers.put("Content-Range", String.format(Locale.US, "bytes %d-%d/%d", start, end, totalLength));
        headers.put("Cache-Control", "public, max-age=31536000, immutable");
        return new WebResourceResponse(
            mimeType(assetPath),
            null,
            206,
            "Partial Content",
            headers,
            new LimitedInputStream(stream, descriptor, responseLength)
        );
    }

    private static void skipFully(InputStream stream, long byteCount) throws IOException {
        long remaining = byteCount;
        while (remaining > 0) {
            long skipped = stream.skip(remaining);
            if (skipped <= 0) {
                if (stream.read() == -1) {
                    throw new IOException("Unexpected end of ranged asset");
                }
                skipped = 1;
            }
            remaining -= skipped;
        }
    }

    private static String mimeType(String path) {
        String lowerPath = path.toLowerCase(Locale.US);
        if (lowerPath.endsWith(".css")) return "text/css";
        if (lowerPath.endsWith(".html")) return "text/html";
        if (lowerPath.endsWith(".js") || lowerPath.endsWith(".mjs")) return "text/javascript";
        if (lowerPath.endsWith(".json")) return "application/json";
        if (lowerPath.endsWith(".wasm")) return "application/wasm";
        if (lowerPath.endsWith(".webmanifest")) return "application/manifest+json";
        if (lowerPath.endsWith(".m4a")) return "audio/mp4";
        if (lowerPath.endsWith(".mp3")) return "audio/mpeg";
        if (lowerPath.endsWith(".ogg")) return "audio/ogg";
        if (lowerPath.endsWith(".wav")) return "audio/wav";
        if (lowerPath.endsWith(".mp4")) return "video/mp4";
        if (lowerPath.endsWith(".webm")) return "video/webm";
        if (lowerPath.endsWith(".svg")) return "image/svg+xml";
        if (lowerPath.endsWith(".png")) return "image/png";
        if (lowerPath.endsWith(".webp")) return "image/webp";
        if (lowerPath.endsWith(".ttf")) return "font/ttf";
        if (lowerPath.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }

    private static WebResourceResponse errorResponse(int status, String reason) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        return new WebResourceResponse(
            "text/plain",
            "UTF-8",
            status,
            reason,
            headers,
            new ByteArrayInputStream(reason.getBytes(StandardCharsets.UTF_8))
        );
    }

    private static final class LimitedInputStream extends InputStream {
        private final InputStream stream;
        private final AssetFileDescriptor descriptor;
        private long remaining;

        LimitedInputStream(InputStream stream, AssetFileDescriptor descriptor, long remaining) {
            this.stream = stream;
            this.descriptor = descriptor;
            this.remaining = remaining;
        }

        @Override
        public int read() throws IOException {
            if (remaining == 0) return -1;
            int value = stream.read();
            if (value >= 0) remaining -= 1;
            return value;
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException {
            if (remaining == 0) return -1;
            int count = stream.read(buffer, offset, (int) Math.min(length, remaining));
            if (count > 0) remaining -= count;
            return count;
        }

        @Override
        public void close() throws IOException {
            try {
                stream.close();
            } finally {
                descriptor.close();
            }
        }
    }
}
