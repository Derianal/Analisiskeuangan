package com.petanikota.keuangan;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Message;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.Toast;

/**
 * Peluncur aplikasi keuangan (Apps Script /exec).
 * - Halaman aplikasi dibuka di WebView sendiri (tanpa campuran akun Google di Chrome).
 * - Login Google & semua link luar dibuka di Chrome (Custom Tab), karena Google melarang login di WebView.
 *   Aplikasi web menunggu hasil login di server, jadi setelah kembali ke APK login berlanjut otomatis.
 */
public class MainActivity extends Activity {
    static final String APP_URL = "https://script.google.com/macros/s/ID_DEPLOYMENT_ANDA/exec";
    WebView web;
    ProgressBar bar;

    static boolean isAppHost(Uri u) {
        String h = u.getHost() == null ? "" : u.getHost();
        if (h.equals("script.google.com")) {
            String p = u.getPath() == null ? "" : u.getPath();
            return p.startsWith("/macros/");                     // halaman aplikasi; selain itu (mis. /accounts) ke browser
        }
        return h.endsWith(".googleusercontent.com");             // isi aplikasi Apps Script (iframe)
    }

    void openExternal(Uri uri) {
        Intent i = new Intent(Intent.ACTION_VIEW, uri);
        Bundle extras = new Bundle();
        if (Build.VERSION.SDK_INT >= 18) extras.putBinder("android.support.customtabs.extra.SESSION", null); // Custom Tab Chrome
        i.putExtras(extras);
        i.putExtra("android.support.customtabs.extra.TOOLBAR_COLOR", 0xFF0F1B3D);
        String host = uri.getHost() == null ? "" : uri.getHost();
        if (host.equals("accounts.google.com")) {
            // Tab "bersih" (ephemeral): tanpa cookie akun Google Chrome, supaya halaman balik ke script.google.com
            // tidak tertahan di pemilihan akun ("tidak dapat membuka file"). Didukung Chrome versi baru; versi lama mengabaikannya.
            i.putExtra("androidx.browser.customtabs.extra.ENABLE_EPHEMERAL_BROWSING", true);
            i.setPackage(chromePackage());
        }
        try { startActivity(i); }
        catch (ActivityNotFoundException e) {
            try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
            catch (ActivityNotFoundException e2) { Toast.makeText(this, "Tidak ada browser untuk membuka link.", Toast.LENGTH_LONG).show(); }
        }
    }

    String chromePackage() {
        String[] pk = { "com.android.chrome", "com.chrome.beta", "com.chrome.dev" };
        for (String p : pk) { try { getPackageManager().getPackageInfo(p, 0); return p; } catch (Exception e) { } }
        return null;
    }

    boolean route(WebView v, Uri u) {
        String s = u.getScheme() == null ? "" : u.getScheme();
        if ((s.equals("https") || s.equals("http")) && isAppHost(u)) return false; // tetap di dalam aplikasi
        if (s.equals("about") || s.equals("data") || s.equals("blob") || s.equals("javascript")) return false;
        openExternal(u);
        return true;
    }

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        if (Build.VERSION.SDK_INT >= 21) getWindow().setStatusBarColor(0xFF0F1B3D);
        FrameLayout root = new FrameLayout(this);
        web = new WebView(this);
        bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(bar, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 8));
        setContentView(root);

        WebSettings ws = web.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setDatabaseEnabled(true);
        ws.setSupportMultipleWindows(true);
        ws.setJavaScriptCanOpenWindowsAutomatically(true);
        ws.setLoadWithOverviewMode(true);
        ws.setUseWideViewPort(true);
        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= 21) cm.setAcceptThirdPartyCookies(web, true);

        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) { return route(v, r.getUrl()); }
            @SuppressWarnings("deprecation")
            @Override public boolean shouldOverrideUrlLoading(WebView v, String url) { return route(v, Uri.parse(url)); }
            @Override public void onPageStarted(WebView v, String url, Bitmap f) { bar.setVisibility(View.VISIBLE); }
            @Override public void onPageFinished(WebView v, String url) { bar.setVisibility(View.GONE); }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView v, int p) { bar.setProgress(p); }
            // window.open(...) / link target=_blank: tangkap alamatnya lalu buka di Chrome.
            @Override public boolean onCreateWindow(WebView v, boolean dialog, boolean userGesture, Message msg) {
                WebView temp = new WebView(MainActivity.this);
                temp.getSettings().setJavaScriptEnabled(false);
                temp.setWebViewClient(new PopupClient(temp));
                WebView.WebViewTransport t = (WebView.WebViewTransport) msg.obj;
                t.setWebView(temp);
                msg.sendToTarget();
                return true;
            }
        });

        if (saved != null) web.restoreState(saved);
        else web.loadUrl(APP_URL);
    }

    /** Jendela sementara untuk window.open: alamat pertama yang bukan about: dibuka di Chrome. */
    class PopupClient extends WebViewClient {
        final WebView temp; boolean done = false;
        PopupClient(WebView t) { temp = t; }
        void handle(String url) {
            if (done || url == null || url.startsWith("about:")) return;
            done = true;
            openExternal(Uri.parse(url));
            temp.post(new Destroyer(temp));
        }
        @Override public boolean shouldOverrideUrlLoading(WebView w, WebResourceRequest r) { handle(r.getUrl().toString()); return true; }
        @SuppressWarnings("deprecation")
        @Override public boolean shouldOverrideUrlLoading(WebView w, String url) { handle(url); return true; }
        @Override public void onPageStarted(WebView w, String url, Bitmap f) { handle(url); }
    }
    static class Destroyer implements Runnable { final WebView w; Destroyer(WebView w) { this.w = w; } public void run() { w.destroy(); } }

    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }

    @Override public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }
}
