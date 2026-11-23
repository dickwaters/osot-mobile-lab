package com.osot.mobilelab;

import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

@CapacitorPlugin(name = "FileExport")
public class FileExportPlugin extends Plugin {

    @PluginMethod
    public void saveToDownloads(PluginCall call) {
        String fileName = call.getString("fileName");
        String mimeType = call.getString("mimeType", "application/octet-stream");
        String base64Data = call.getString("base64Data");
        if (fileName == null || base64Data == null) {
            call.reject("缺少文件名或数据");
            return;
        }
        try {
            byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
            String savedPath = writePublicDownload(getContext(), fileName, mimeType, bytes);
            JSObject ret = new JSObject();
            ret.put("savedPath", savedPath);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("保存到下载目录失败: " + e.getMessage());
        }
    }

    @PluginMethod
    public void saveAndShare(PluginCall call) {
        String fileName = call.getString("fileName");
        String mimeType = call.getString("mimeType", "application/octet-stream");
        String base64Data = call.getString("base64Data");
        String shareTitle = call.getString("shareTitle", "分享 OSOT 实验成果");
        if (fileName == null || base64Data == null) {
            call.reject("缺少文件名或数据");
            return;
        }
        try {
            Context ctx = getContext();
            byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
            String savedPath = writePublicDownload(ctx, fileName, mimeType, bytes);

            File cacheDir = new File(ctx.getCacheDir(), "exports");
            if (!cacheDir.exists()) cacheDir.mkdirs();
            File shareFile = new File(cacheDir, fileName);
            try (FileOutputStream fos = new FileOutputStream(shareFile)) {
                fos.write(bytes);
                fos.flush();
            }

            Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", shareFile);
            Intent sendIntent = new Intent(Intent.ACTION_SEND);
            sendIntent.setType(mimeType);
            sendIntent.putExtra(Intent.EXTRA_STREAM, uri);
            sendIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            Intent chooser = Intent.createChooser(sendIntent, shareTitle);
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(chooser);

            JSObject ret = new JSObject();
            ret.put("savedPath", savedPath);
            ret.put("shared", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("导出分享失败: " + e.getMessage());
        }
    }

    private String writePublicDownload(Context ctx, String fileName, String mimeType, byte[] bytes) throws Exception {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
            values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
            values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/OSOT_Exports");
            Uri uri = ctx.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri != null) {
                try (OutputStream out = ctx.getContentResolver().openOutputStream(uri)) {
                    if (out != null) {
                        out.write(bytes);
                        out.flush();
                    }
                }
                return "Downloads/OSOT_Exports/" + fileName;
            }
        }
        File dir = new File(ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "OSOT_Exports");
        if (!dir.exists()) dir.mkdirs();
        File f = new File(dir, fileName);
        try (FileOutputStream fos = new FileOutputStream(f)) {
            fos.write(bytes);
            fos.flush();
        }
        return f.getAbsolutePath();
    }
}
