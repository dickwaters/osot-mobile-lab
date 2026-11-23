// Lightweight precision audio player for bundled MP3 clips & recorded WAV base64

let currentAudio: HTMLAudioElement | null = null;
let sliceStopTimer: number | null = null;
let rafId: number | null = null;

export function stopAudio() {
  if (sliceStopTimer !== null) {
    window.clearTimeout(sliceStopTimer);
    sliceStopTimer = null;
  }
  if (rafId !== null) {
    window.cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.currentTime = 0;
    } catch {}
    currentAudio = null;
  }
}

export function playClip(
  url: string,
  options?: {
    startMs?: number;
    endMs?: number;
    rate?: number;
    onProgress?: (currentMs: number, durationMs: number) => void;
    onEnd?: () => void;
  }
) {
  stopAudio();
  const audio = new Audio(url);
  audio.playbackRate = options?.rate ?? 1.0;
  currentAudio = audio;

  const startSec = (options?.startMs ?? 0) / 1000;
  const endSec = options?.endMs !== undefined ? options.endMs / 1000 : undefined;

  const tick = () => {
    if (!currentAudio || currentAudio !== audio) return;
    const curMs = audio.currentTime * 1000;
    const durMs = (audio.duration || 1) * 1000;
    options?.onProgress?.(curMs, durMs);
    if (endSec !== undefined && audio.currentTime >= endSec) {
      stopAudio();
      options?.onEnd?.();
      return;
    }
    if (!audio.paused && !audio.ended) {
      rafId = window.requestAnimationFrame(tick);
    }
  };

  audio.onended = () => {
    stopAudio();
    options?.onEnd?.();
  };

  let started = false;
  const startPlayback = () => {
    if (started || currentAudio !== audio) return;
    started = true;
    if (startSec > 0 && isFinite(audio.duration) && startSec < audio.duration) {
      try { audio.currentTime = startSec; } catch {}
    }
    audio.play().then(() => {
      rafId = window.requestAnimationFrame(tick);
      if (endSec !== undefined && endSec > startSec) {
        const ms = ((endSec - startSec) / (audio.playbackRate || 1)) * 1000 + 180;
        sliceStopTimer = window.setTimeout(() => {
          if (currentAudio === audio) {
            stopAudio();
            options?.onEnd?.();
          }
        }, ms);
      }
    }).catch(() => {});
  };

  audio.onloadedmetadata = startPlayback;
  audio.oncanplay = startPlayback;
  audio.load();
}

export function playBase64Wav(wavBase64: string, onEnd?: () => void) {
  const url = `data:audio/wav;base64,${wavBase64}`;
  playClip(url, { onEnd });
}

export function drawWaveform(
  canvas: HTMLCanvasElement,
  peaks: number[],
  progressRatio = 0,
  highlightRatio?: number
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(100, rect.width);
  const h = Math.max(40, rect.height);
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, w, h);
  // Subtle center line
  ctx.strokeStyle = 'rgba(148,163,184,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();

  const n = peaks.length || 1;
  const barW = Math.max(2, w / n - 1.2);
  const mid = h / 2;

  for (let i = 0; i < n; i++) {
    const x = (i / n) * w;
    const amp = Math.max(0.06, peaks[i] || 0.06);
    const barH = amp * (h * 0.86);
    const ratio = i / n;
    ctx.fillStyle = ratio <= progressRatio ? '#38bdf8' : 'rgba(148,163,184,0.45)';
    ctx.fillRect(x, mid - barH / 2, barW, barH);
  }

  // Highlight marker (e.g. target F0 frame center)
  if (highlightRatio !== undefined && highlightRatio >= 0 && highlightRatio <= 1) {
    const hx = highlightRatio * w;
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(hx, 2);
    ctx.lineTo(hx, h - 2);
    ctx.stroke();
  }

  // Playhead
  if (progressRatio > 0 && progressRatio <= 1) {
    const px = progressRatio * w;
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, h);
    ctx.stroke();
  }
}
