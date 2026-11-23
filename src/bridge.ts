import { Capacitor, registerPlugin } from '@capacitor/core';

export interface WavRecorderNative {
  requestPermissions(): Promise<{ granted: boolean }>;
  startRecording(): Promise<{ started: boolean; sampleRate: number }>;
  stopRecording(): Promise<{
    wavBase64: string;
    durationMs: number;
    peakDb: number;
    clipped: boolean;
  }>;
  addListener(
    eventName: 'audioLevel',
    listenerFunc: (info: { db: number; clipped: boolean }) => void
  ): Promise<{ remove: () => Promise<void> }>;
}

export interface AppUpdaterNative {
  getAppInfo(): Promise<{ versionName: string; versionCode: number; packageName: string }>;
  downloadAndInstallApk(options: { url: string; fileName: string }): Promise<{ started: boolean }>;
  addListener(
    eventName: 'downloadProgress',
    listenerFunc: (info: { progress: number; downloadedBytes: number; totalBytes: number; status: string }) => void
  ): Promise<{ remove: () => Promise<void> }>;
}

export interface FileExportNative {
  saveAndShare(options: {
    fileName: string;
    mimeType: string;
    base64Data: string;
    shareTitle?: string;
  }): Promise<{ savedPath: string; shared: boolean }>;
  saveToDownloads(options: {
    fileName: string;
    mimeType: string;
    base64Data: string;
  }): Promise<{ savedPath: string }>;
}

export const WavRecorderPlugin = registerPlugin<WavRecorderNative>('WavRecorder');
export const AppUpdaterPlugin = registerPlugin<AppUpdaterNative>('AppUpdater');
export const FileExportPlugin = registerPlugin<FileExportNative>('FileExport');

export const isNativeAndroid = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

// ---------- Web Fallback WAV Recorder (16kHz 16-bit mono PCM) ----------
let webAudioCtx: AudioContext | null = null;
let webStream: MediaStream | null = null;
let webProcessor: ScriptProcessorNode | null = null;
let webChunks: Float32Array[] = [];
let webSampleRate = 44100;
let webLevelCb: ((db: number, clipped: boolean) => void) | null = null;

function downsampleTo16k(buffer: Float32Array, inRate: number): Int16Array {
  const outRate = 16000;
  if (inRate === outRate) {
    const out = new Int16Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
      const s = Math.max(-1, Math.min(1, buffer[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }
  const ratio = inRate / outRate;
  const newLen = Math.round(buffer.length / ratio);
  const out = new Int16Array(newLen);
  for (let i = 0; i < newLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(buffer.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let cnt = 0;
    for (let j = start; j < end; j++) {
      sum += buffer[j];
      cnt++;
    }
    const v = cnt > 0 ? sum / cnt : 0;
    const s = Math.max(-1, Math.min(1, v));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function encodeWav16k(pcm16: Int16Array): Uint8Array {
  const byteLength = pcm16.length * 2;
  const buf = new ArrayBuffer(44 + byteLength);
  const view = new DataView(buf);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + byteLength, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, byteLength, true);
  let offset = 44;
  for (let i = 0; i < pcm16.length; i++, offset += 2) {
    view.setInt16(offset, pcm16[i], true);
  }
  return new Uint8Array(buf);
}

export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let nativeAudioLevelHandle: { remove: () => Promise<void> } | null = null;
let nativeDownloadHandle: { remove: () => Promise<void> } | null = null;

export async function attachDownloadProgressListener(
  cb: (info: { progress: number; downloadedBytes: number; totalBytes: number; status: string }) => void
): Promise<void> {
  if (nativeDownloadHandle) {
    try { await nativeDownloadHandle.remove(); } catch {}
    nativeDownloadHandle = null;
  }
  nativeDownloadHandle = await AppUpdaterPlugin.addListener('downloadProgress', cb);
}

export async function startDryRecording(onLevel?: (db: number, clipped: boolean) => void): Promise<void> {
  if (isNativeAndroid()) {
    const perm = await WavRecorderPlugin.requestPermissions();
    if (!perm.granted) throw new Error('未获得麦克风录音权限，请在系统设置中允许录音');
    if (nativeAudioLevelHandle) {
      try { await nativeAudioLevelHandle.remove(); } catch {}
      nativeAudioLevelHandle = null;
    }
    if (onLevel) {
      nativeAudioLevelHandle = await WavRecorderPlugin.addListener('audioLevel', (info) => onLevel(info.db, info.clipped));
    }
    await WavRecorderPlugin.startRecording();
    return;
  }
  webLevelCb = onLevel || null;
  webChunks = [];
  webStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  webAudioCtx = new AudioContext();
  webSampleRate = webAudioCtx.sampleRate;
  const src = webAudioCtx.createMediaStreamSource(webStream);
  webProcessor = webAudioCtx.createScriptProcessor(4096, 1, 1);
  webProcessor.onaudioprocess = (ev) => {
    const data = ev.inputBuffer.getChannelData(0);
    webChunks.push(new Float32Array(data));
    if (webLevelCb) {
      let peak = 0;
      for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
      const db = peak > 1e-6 ? 20 * Math.log10(peak) : -60;
      webLevelCb(Math.round(db * 10) / 10, peak >= 0.98);
    }
  };
  src.connect(webProcessor);
  webProcessor.connect(webAudioCtx.destination);
}

export async function stopDryRecording(): Promise<{
  wavBase64: string;
  durationMs: number;
  peakDb: number;
  clipped: boolean;
}> {
  if (isNativeAndroid()) {
    return await WavRecorderPlugin.stopRecording();
  }
  if (webProcessor) webProcessor.disconnect();
  if (webStream) webStream.getTracks().forEach((t) => t.stop());
  if (webAudioCtx) await webAudioCtx.close();
  const totalLen = webChunks.reduce((acc, c) => acc + c.length, 0);
  const merged = new Float32Array(totalLen);
  let off = 0;
  let peak = 0;
  for (const c of webChunks) {
    merged.set(c, off);
    off += c.length;
    for (let i = 0; i < c.length; i++) peak = Math.max(peak, Math.abs(c[i]));
  }
  const pcm16 = downsampleTo16k(merged, webSampleRate);
  const wavBytes = encodeWav16k(pcm16);
  const peakDb = peak > 1e-6 ? Math.round(20 * Math.log10(peak) * 10) / 10 : -60;
  return {
    wavBase64: uint8ToBase64(wavBytes),
    durationMs: Math.round((pcm16.length / 16000) * 1000),
    peakDb,
    clipped: peak >= 0.98,
  };
}

export async function exportFile(
  fileName: string,
  mimeType: string,
  data: Uint8Array | string,
  share = true
): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  if (isNativeAndroid()) {
    const b64 = uint8ToBase64(bytes);
    if (share) {
      const res = await FileExportPlugin.saveAndShare({
        fileName,
        mimeType,
        base64Data: b64,
        shareTitle: `导出 OSOT 实验成果: ${fileName}`,
      });
      return res.savedPath;
    } else {
      const res = await FileExportPlugin.saveToDownloads({
        fileName,
        mimeType,
        base64Data: b64,
      });
      return res.savedPath;
    }
  }
  // Web browser fallback download
  const blob = new Blob([bytes as unknown as BlobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return `Downloads/${fileName}`;
}
