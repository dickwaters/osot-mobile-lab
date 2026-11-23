package com.osot.mobilelab;

import android.Manifest;
import android.annotation.SuppressLint;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Build;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

@CapacitorPlugin(
    name = "WavRecorder",
    permissions = {
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
    }
)
public class WavRecorderPlugin extends Plugin {
    private static final int SAMPLE_RATE = 16000;
    private static final int CHANNEL_CONFIG = AudioFormat.CHANNEL_IN_MONO;
    private static final int AUDIO_FORMAT = AudioFormat.ENCODING_PCM_16BIT;

    private volatile boolean isRecording = false;
    private AudioRecord audioRecord;
    private Thread recordThread;
    private ByteArrayOutputStream pcmStream;
    private volatile double maxPeak = 0.0;
    private volatile boolean clipped = false;

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        requestPermissionForAlias("microphone", call, "micPermsCallback");
    }

    @PermissionCallback
    private void micPermsCallback(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", getPermissionState("microphone") == PermissionState.GRANTED);
        call.resolve(ret);
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void startRecording(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            call.reject("未授予麦克风权限");
            return;
        }
        if (isRecording) {
            call.reject("正在录音中");
            return;
        }

        int minBuf = AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL_CONFIG, AUDIO_FORMAT);
        int bufSize = Math.max(minBuf * 2, 4096);

        AudioRecord rec = null;
        int[] sources = Build.VERSION.SDK_INT >= Build.VERSION_CODES.N
            ? new int[]{ MediaRecorder.AudioSource.UNPROCESSED, MediaRecorder.AudioSource.VOICE_RECOGNITION, MediaRecorder.AudioSource.MIC }
            : new int[]{ MediaRecorder.AudioSource.VOICE_RECOGNITION, MediaRecorder.AudioSource.MIC };

        for (int src : sources) {
            try {
                AudioRecord candidate = new AudioRecord(src, SAMPLE_RATE, CHANNEL_CONFIG, AUDIO_FORMAT, bufSize);
                if (candidate.getState() == AudioRecord.STATE_INITIALIZED) {
                    rec = candidate;
                    break;
                } else {
                    candidate.release();
                }
            } catch (Exception ignored) {}
        }

        if (rec == null) {
            call.reject("初始化原生干声录音器失败");
            return;
        }

        audioRecord = rec;
        pcmStream = new ByteArrayOutputStream();
        maxPeak = 0.0;
        clipped = false;
        isRecording = true;

        audioRecord.startRecording();
        recordThread = new Thread(() -> {
            byte[] buf = new byte[2048];
            long lastEmit = 0L;
            while (isRecording && audioRecord != null) {
                int read = audioRecord.read(buf, 0, buf.length);
                if (read > 0) {
                    pcmStream.write(buf, 0, read);
                    double localPeak = 0.0;
                    for (int i = 0; i + 1 < read; i += 2) {
                        short s = (short) ((buf[i] & 0xff) | (buf[i + 1] << 8));
                        double norm = Math.abs(s) / 32768.0;
                        if (norm > localPeak) localPeak = norm;
                    }
                    if (localPeak > maxPeak) maxPeak = localPeak;
                    if (localPeak >= 0.98) clipped = true;

                    long now = System.currentTimeMillis();
                    if (now - lastEmit >= 80) {
                        lastEmit = now;
                        double db = localPeak > 1e-6 ? 20.0 * Math.log10(localPeak) : -60.0;
                        JSObject ev = new JSObject();
                        ev.put("db", Math.round(db * 10.0) / 10.0);
                        ev.put("clipped", localPeak >= 0.98);
                        notifyListeners("audioLevel", ev);
                    }
                }
            }
        });
        recordThread.start();

        JSObject ret = new JSObject();
        ret.put("started", true);
        ret.put("sampleRate", SAMPLE_RATE);
        call.resolve(ret);
    }

    @PluginMethod
    public void stopRecording(PluginCall call) {
        if (!isRecording) {
            call.reject("当前未在录音");
            return;
        }
        isRecording = false;
        try {
            if (recordThread != null) {
                recordThread.join(1500);
            }
        } catch (InterruptedException ignored) {}

        if (audioRecord != null) {
            try {
                audioRecord.stop();
            } catch (Exception ignored) {}
            audioRecord.release();
            audioRecord = null;
        }

        byte[] pcm = pcmStream != null ? pcmStream.toByteArray() : new byte[0];
        byte[] wav = wrapWavHeader(pcm, SAMPLE_RATE, 1, 16);
        String b64 = Base64.encodeToString(wav, Base64.NO_WRAP);
        long durationMs = (long) ((pcm.length / 2.0) / SAMPLE_RATE * 1000.0);
        double peakDb = maxPeak > 1e-6 ? Math.round(20.0 * Math.log10(maxPeak) * 10.0) / 10.0 : -60.0;

        JSObject ret = new JSObject();
        ret.put("wavBase64", b64);
        ret.put("durationMs", durationMs);
        ret.put("peakDb", peakDb);
        ret.put("clipped", clipped);
        call.resolve(ret);
    }

    private byte[] wrapWavHeader(byte[] pcmData, int sampleRate, int channels, int bitsPerSample) {
        int byteRate = sampleRate * channels * bitsPerSample / 8;
        int dataLen = pcmData.length;
        int totalDataLen = dataLen + 36;
        ByteBuffer header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN);
        header.put(new byte[]{'R', 'I', 'F', 'F'});
        header.putInt(totalDataLen);
        header.put(new byte[]{'W', 'A', 'V', 'E'});
        header.put(new byte[]{'f', 'm', 't', ' '});
        header.putInt(16);
        header.putShort((short) 1);
        header.putShort((short) channels);
        header.putInt(sampleRate);
        header.putInt(byteRate);
        header.putShort((short) (channels * bitsPerSample / 8));
        header.putShort((short) bitsPerSample);
        header.put(new byte[]{'d', 'a', 't', 'a'});
        header.putInt(dataLen);

        byte[] out = new byte[44 + dataLen];
        System.arraycopy(header.array(), 0, out, 0, 44);
        System.arraycopy(pcmData, 0, out, 44, dataLen);
        return out;
    }
}
