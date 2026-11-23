package com.osot.mobilelab;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {

    @PluginMethod
    public void getAppInfo(PluginCall call) {
        try {
            Context ctx = getContext();
            PackageInfo pInfo = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            long vCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? pInfo.getLongVersionCode()
                : pInfo.versionCode;
            JSObject ret = new JSObject();
            ret.put("versionName", pInfo.versionName != null ? pInfo.versionName : "1.0.0");
            ret.put("versionCode", vCode);
            ret.put("packageName", ctx.getPackageName());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("读取应用版本失败: " + e.getMessage());
        }
    }

    @PluginMethod
    public void downloadAndInstallApk(PluginCall call) {
        String urlStr = call.getString("url");
        String fileName = call.getString("fileName", "osot-mobile-lab-update.apk");
        if (urlStr == null || urlStr.isEmpty()) {
            call.reject("缺少 APK 下载链接");
            return;
        }

        JSObject startRet = new JSObject();
        startRet.put("started", true);
        call.resolve(startRet);

        new Thread(() -> {
            try {
                emitProgress(2, 0, 0, "正在连接下载服务器…");
                Context ctx = getContext();
                File dir = ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (dir == null) dir = ctx.getCacheDir();
                File outFile = new File(dir, fileName);
                if (outFile.exists()) outFile.delete();

                HttpURLConnection conn = openWithRedirects(urlStr, 5);
                int status = conn.getResponseCode();
                if (status != HttpURLConnection.HTTP_OK) {
                    emitProgress(-1, 0, 0, "下载失败 HTTP " + status);
                    return;
                }

                long total = conn.getContentLengthLong();
                try (InputStream in = new BufferedInputStream(conn.getInputStream());
                     FileOutputStream out = new FileOutputStream(outFile)) {
                    byte[] buf = new byte[16384];
                    long downloaded = 0;
                    int read;
                    int lastPct = 2;
                    while ((read = in.read(buf)) != -1) {
                        out.write(buf, 0, read);
                        downloaded += read;
                        if (total > 0) {
                            int pct = (int) Math.min(99, (downloaded * 100L) / total);
                            if (pct > lastPct) {
                                lastPct = pct;
                                emitProgress(pct, downloaded, total, "正在下载安装包…");
                            }
                        }
                    }
                    out.flush();
                }

                emitProgress(100, outFile.length(), outFile.length(), "下载完成，正在拉起系统安装器…");
                launchInstaller(ctx, outFile);
            } catch (Exception e) {
                emitProgress(-1, 0, 0, "下载出错: " + e.getMessage());
            }
        }).start();
    }

    private HttpURLConnection openWithRedirects(String urlStr, int maxRedirects) throws Exception {
        String current = urlStr;
        for (int i = 0; i <= maxRedirects; i++) {
            HttpURLConnection conn = (HttpURLConnection) new URL(current).openConnection();
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);
            conn.setRequestProperty("User-Agent", "OSOT-Mobile-Lab-Updater");
            int code = conn.getResponseCode();
            if (code == HttpURLConnection.HTTP_MOVED_PERM || code == HttpURLConnection.HTTP_MOVED_TEMP || code == 307 || code == 308) {
                String loc = conn.getHeaderField("Location");
                conn.disconnect();
                if (loc == null) throw new Exception("重定向地址为空");
                current = loc;
                continue;
            }
            return conn;
        }
        throw new Exception("重定向次数过多");
    }

    private void launchInstaller(Context ctx, File apkFile) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !ctx.getPackageManager().canRequestPackageInstalls()) {
            Intent permIntent = new Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + ctx.getPackageName())
            );
            permIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(permIntent);
        }

        Uri apkUri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", apkFile);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        ctx.startActivity(intent);
    }

    private void emitProgress(int progress, long downloaded, long total, String status) {
        JSObject ev = new JSObject();
        ev.put("progress", progress);
        ev.put("downloadedBytes", downloaded);
        ev.put("totalBytes", total);
        ev.put("status", status);
        notifyListeners("downloadProgress", ev);
    }
}
