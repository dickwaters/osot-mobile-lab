import './styles.css';
import {
  APP_VERSION,
  APP_VERSION_CODE,
  GITHUB_REPO,
  type E2F0Item,
  type E2F0Verdict,
  type E4StressVote,
  type E5BoundaryVote,
  type E7TrialItem,
  type E7TrialRecord,
  type EcoPhrase,
  type ExpAControlledPack,
  type ExpBControlledPack,
  type JunctionL2,
  type L2GroupLevel,
  type L2Prominence,
  type L2SenseType,
  type L3BreakMethod,
  type L3StressType,
  type RaterProfile,
  type RecordedTake,
  type ReleaseInfo,
  type TabId,
} from './types';
import {
  loadAllRecordedTakes,
  loadE2F0Votes,
  loadE4StressVotes,
  loadE5BoundaryVotes,
  loadE7TrialRecords,
  loadProfile,
  saveE2F0Votes,
  saveE4StressVotes,
  saveE5BoundaryVotes,
  saveE7TrialRecords,
  saveProfile,
  saveRecordedTake,
  deleteRecordedTake,
} from './storage';
import { drawWaveform, playBase64Wav, playClip, stopAudio } from './audio';
import {
  AppUpdaterPlugin,
  attachDownloadProgressListener,
  exportFile,
  isNativeAndroid,
  startDryRecording,
  stopDryRecording,
} from './bridge';
import {
  buildE2F0Export,
  buildE4StressExport,
  buildE5BoundaryExport,
  buildE7TrialExport,
  checkLatestRelease,
  exportControlledZip,
  exportMasterBundle,
} from './exporters';

// ---------- Global State ----------
const state = {
  tab: 'home' as TabId,
  profile: loadProfile(),
  showProfileModal: false,
  loading: true,
  toast: '' as string,
  toastTimer: 0 as number,

  // Loaded Packs
  e2Items: [] as E2F0Item[],
  ecoPhrases: [] as EcoPhrase[],
  expAPack: null as ExpAControlledPack | null,
  expBPack: null as ExpBControlledPack | null,
  e7Items: [] as E7TrialItem[],

  // User Annotations
  e2Votes: loadE2F0Votes(),
  e4Votes: loadE4StressVotes(),
  e5Votes: loadE5BoundaryVotes(),
  e7Records: loadE7TrialRecords(),
  takes: [] as RecordedTake[],

  // Per-module UI cursors
  e2Idx: 0,
  e2PlayRate: 1.0,

  e4RecSentIdx: 0,
  e4RecCondIdx: 0,
  e5RecSentIdx: 0,
  e5RecCondIdx: 0,
  isRecording: false,
  recDb: -60,
  recClipped: false,

  e4PhraseIdx: 0,
  e4Layer: 'L2' as 'L2' | 'L3',
  e4Tool: 'P2' as 'listen' | 'P2' | 'P1' | 'abstained' | 'clear',
  e4SelectedSyl: '' as string,
  e4StartTs: Date.now(),

  e5PhraseIdx: 0,
  e5Layer: 'L2' as 'L2' | 'L3',
  e5SelectedJunc: 0,
  e5StartTs: Date.now(),

  e7Idx: 0,
  e7Mode: 'proofread' as 'proofread' | 'audit',
  e7Tool: 'listen' as 'listen' | 'P2' | 'P1' | 'clear_p' | 'minor_b' | 'major_b' | 'clear_b',
  e7ActiveMs: 0,
  e7IdleMs: 0,
  e7LastActTs: Date.now(),
  e7TimerPaused: false,

  exportPreviewKey: 'e2' as 'e2' | 'e4_rec' | 'e4_stress' | 'e5_rec' | 'e5_boundary' | 'e7',

  // Updater state
  nativeVersionName: APP_VERSION,
  nativeVersionCode: APP_VERSION_CODE,
  checkingUpdate: false,
  latestRelease: null as ReleaseInfo | null,
  updateError: '',
  downloadProgress: -1,
  downloadStatus: '',
};

const EXPERIMENT_ORDER: {
  seq: string;
  tab: TabId;
  shortTitle: string;
  title: string;
  goal: string;
  nextTab?: TabId;
  nextLabel?: string;
}[] = [
  {
    seq: '01',
    tab: 'e2_f0',
    shortTitle: 'E2 · F0 抽检',
    title: 'E2 尾项 · F0 分层抽检',
    goal: '听 38 个 1s 真实干声切片，核对机器基频有无八度跳变',
    nextTab: 'e4_rec',
    nextLabel: '02 · E4 受控干声录音',
  },
  {
    seq: '02',
    tab: 'e4_rec',
    shortTitle: 'E4 · 干声录音',
    title: 'E4 实验 A · 受控干声录音棚',
    goal: '12 句 × 4 条件录无损干声 WAV（中性/强读/轻读重音/普通弱读）',
    nextTab: 'e4_stress',
    nextLabel: '03 · E4 重音双盲标定',
  },
  {
    seq: '03',
    tab: 'e4_stress',
    shortTitle: 'E4 · 重音双盲',
    title: 'E4 实验 A · 轻读重音双盲标定',
    goal: '听 20 条真实名家短语：先锁 L2 蒙眼凸显，再标 L3 技巧+独立虚声',
    nextTab: 'e5_rec',
    nextLabel: '04 · E5 停连干声录音',
  },
  {
    seq: '04',
    tab: 'e5_rec',
    shortTitle: 'E5 · 停连录音',
    title: 'E5 实验 B · 停连四法录音棚',
    goal: '10 句 × 4 手法录干声 WAV（直连/曲连/扬停/落停，含四声/三声陷阱）',
    nextTab: 'e5_boundary',
    nextLabel: '05 · E5 全接点停连标注',
  },
  {
    seq: '05',
    tab: 'e5_boundary',
    shortTitle: 'E5 · 全接点停连',
    title: 'E5 实验 B · 全接点停连与四法',
    goal: '在 20 条名家短语的任意字间接点标分组、延续/收束与停连四法',
    nextTab: 'e7_trial',
    nextLabel: '06 · E7 省工对照与盲审',
  },
  {
    seq: '06',
    tab: 'e7_trial',
    shortTitle: 'E7 · 省工对照',
    title: 'E7 · 真人省工交叉对照与盲审',
    goal: '10 组盲化 Arm 校对（60s 发呆自动停表）+ 盲审残留错误复核',
    nextTab: 'export',
    nextLabel: '前往导出中心传回电脑',
  },
];

function showToast(msg: string) {
  state.toast = msg;
  if (state.toastTimer) window.clearTimeout(state.toastTimer);
  render(true);
  state.toastTimer = window.setTimeout(() => {
    state.toast = '';
    render(true);
  }, 2400);
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------- Data Loading ----------
async function initApp() {
  try {
    const [e2Res, ecoRes, expARes, expBRes, e7Res, takes] = await Promise.all([
      fetch('./packs/e2_f0/manifest.json').then((r) => r.json()),
      fetch('./packs/eco_phrases/manifest.json').then((r) => r.json()),
      fetch('./packs/expA_controlled.json').then((r) => r.json()),
      fetch('./packs/expB_controlled.json').then((r) => r.json()),
      fetch('./packs/e7_trial.json').then((r) => r.json()),
      loadAllRecordedTakes(),
    ]);
    state.e2Items = e2Res.items || [];
    state.ecoPhrases = ecoRes.items || [];
    state.expAPack = expARes;
    state.expBPack = expBRes;
    state.e7Items = e7Res.items || [];
    state.takes = takes;

    if (isNativeAndroid()) {
      try {
        const info = await AppUpdaterPlugin.getAppInfo();
        state.nativeVersionName = info.versionName || APP_VERSION;
        state.nativeVersionCode = info.versionCode || APP_VERSION_CODE;
      } catch {}
    }
  } catch (err) {
    console.error(err);
    showToast('加载内置实验包失败，请重试');
  } finally {
    state.loading = false;
    render();
  }
}

// E7 60s idle-pause timer loop
window.setInterval(() => {
  if (state.tab !== 'e7_trial' || state.e7Mode !== 'proofread') return;
  const item = state.e7Items[state.e7Idx];
  if (!item) return;
  const rec = getOrInitE7Record(item);
  if (rec.completed) return;
  const now = Date.now();
  const idleSec = (now - state.e7LastActTs) / 1000;
  if (idleSec >= 60) {
    state.e7TimerPaused = true;
    state.e7IdleMs += 1000;
  } else {
    state.e7TimerPaused = false;
    state.e7ActiveMs += 1000;
  }
  const timerEl = document.getElementById('e7-timer-val');
  if (timerEl) {
    timerEl.textContent = `${(state.e7ActiveMs / 1000).toFixed(0)}s ${state.e7TimerPaused ? '(已暂停)' : ''}`;
  }
}, 1000);

function touchE7Activity() {
  state.e7LastActTs = Date.now();
  state.e7TimerPaused = false;
}

function flushE7Timer() {
  const item = state.e7Items[state.e7Idx];
  if (!item) return;
  const rec = getOrInitE7Record(item);
  if (!rec.completed && (state.e7ActiveMs > rec.active_elapsed_ms || state.e7IdleMs > rec.paused_idle_ms)) {
    rec.active_elapsed_ms = state.e7ActiveMs;
    rec.paused_idle_ms = state.e7IdleMs;
    saveE7TrialRecords(state.e7Records);
  }
}

// ---------- Vote Helpers ----------
function e4VoteKey(phraseId: string): string {
  return `${phraseId}::${state.profile.rater_id}`;
}

function getOrInitE4Vote(ph: EcoPhrase): E4StressVote {
  const key = e4VoteKey(ph.phrase_id);
  if (!state.e4Votes[key]) {
    state.e4Votes[key] = {
      phrase_id: ph.phrase_id,
      audio_id: ph.audio_id,
      rater_id: state.profile.rater_id,
      l2_locked: false,
      l2_duration_sec: 0,
      no_prominent_word: false,
      l2_labels: {},
      l3_saved: false,
      l3_labels: {},
    };
  }
  return state.e4Votes[key];
}

function e5VoteKey(phraseId: string): string {
  return `${phraseId}::${state.profile.rater_id}`;
}

function getOrInitE5Vote(ph: EcoPhrase): E5BoundaryVote {
  const key = e5VoteKey(ph.phrase_id);
  if (!state.e5Votes[key]) {
    state.e5Votes[key] = {
      phrase_id: ph.phrase_id,
      audio_id: ph.audio_id,
      rater_id: state.profile.rater_id,
      l2_locked: false,
      l2_duration_sec: 0,
      l2_junctions: {},
      l3_saved: false,
      l3_junctions: {},
    };
  }
  return state.e5Votes[key];
}

function e7RecKey(trialId: string): string {
  return `${trialId}::${state.profile.rater_id}`;
}

function getOrInitE7Record(item: E7TrialItem): E7TrialRecord {
  const key = e7RecKey(item.trial_id);
  if (!state.e7Records[key]) {
    state.e7Records[key] = {
      trial_id: item.trial_id,
      phrase_id: item.phrase_id,
      audio_id: item.audio_id,
      arm_masked: item.arm_masked,
      rater_id: state.profile.rater_id,
      active_elapsed_ms: 0,
      paused_idle_ms: 0,
      edits_count: 0,
      false_positive_deletes: 0,
      missed_additions: 0,
      abstain_fills: 0,
      final_prominence: { ...item.machine_draft.prominence },
      final_breaks: { ...item.machine_draft.breaks },
      completed: false,
    };
  }
  return state.e7Records[key];
}

function getStepStats(tab: TabId): { done: number; total: number } {
  switch (tab) {
    case 'e2_f0':
      return { done: Object.keys(state.e2Votes).length, total: state.e2Items.length || 38 };
    case 'e4_rec':
      return {
        done: state.takes.filter((t) => t.experiment === 'expA' && t.speaker_id === state.profile.speaker_id).length,
        total: (state.expAPack?.sentences.length || 12) * 4,
      };
    case 'e4_stress':
      return {
        done: Object.values(state.e4Votes).filter((v) => v.rater_id === state.profile.rater_id && v.l2_locked).length,
        total: state.ecoPhrases.length || 20,
      };
    case 'e5_rec':
      return {
        done: state.takes.filter((t) => t.experiment === 'expB' && t.speaker_id === state.profile.speaker_id).length,
        total: (state.expBPack?.sentences.length || 10) * 4,
      };
    case 'e5_boundary':
      return {
        done: Object.values(state.e5Votes).filter((v) => v.rater_id === state.profile.rater_id && v.l2_locked).length,
        total: state.ecoPhrases.length || 20,
      };
    case 'e7_trial':
      return {
        done: Object.values(state.e7Records).filter((r) => r.rater_id === state.profile.rater_id && r.completed).length,
        total: state.e7Items.length || 10,
      };
    default:
      return { done: 0, total: 0 };
  }
}

function renderCompletionBanner(tab: TabId): string {
  const meta = EXPERIMENT_ORDER.find((x) => x.tab === tab);
  const st = getStepStats(tab);
  if (!meta || st.total === 0 || st.done < st.total) return '';
  return `
    <div class="done-banner">
      <div style="font-weight:800;font-size:15px;color:var(--green);margin-bottom:4px;">🎉 本实验已全部通关 (${st.done}/${st.total})</div>
      <div class="muted" style="margin-bottom:10px;">你可以立即导出本实验文件，或直接推进到下一实验。</div>
      <div class="btn-row">
        <button class="btn sm" data-nav="export">📦 去导出</button>
        ${meta.nextTab ? `<button class="btn primary sm" style="flex:1;" data-nav="${meta.nextTab}">进入下一关：${meta.nextLabel} →</button>` : ''}
      </div>
    </div>
  `;
}

// ---------- Navigation Helper (auto-jumps to first unfinished item!) ----------
async function navigateTo(target: TabId) {
  stopAudio();
  if (state.isRecording) {
    try { await stopDryRecording(); } catch {}
    state.isRecording = false;
  }
  if (state.tab === 'e7_trial') flushE7Timer();

  state.tab = target;

  // Smartly position cursor on the first unfinished item so the user does one after another!
  if (target === 'e2_f0') {
    const u = state.e2Items.findIndex((x) => !state.e2Votes[x.item_id]);
    if (u >= 0) state.e2Idx = u;
  } else if (target === 'e4_stress') {
    const u = state.ecoPhrases.findIndex((p) => !state.e4Votes[e4VoteKey(p.phrase_id)]?.l2_locked);
    if (u >= 0) state.e4PhraseIdx = u;
    state.e4StartTs = Date.now();
  } else if (target === 'e5_boundary') {
    const u = state.ecoPhrases.findIndex((p) => !state.e5Votes[e5VoteKey(p.phrase_id)]?.l2_locked);
    if (u >= 0) state.e5PhraseIdx = u;
    state.e5SelectedJunc = 0;
    state.e5StartTs = Date.now();
  } else if (target === 'e7_trial') {
    const u = state.e7Items.findIndex((it) => !state.e7Records[e7RecKey(it.trial_id)]?.completed);
    if (u >= 0) state.e7Idx = u;
    const it = state.e7Items[state.e7Idx];
    if (it) {
      const r = getOrInitE7Record(it);
      state.e7ActiveMs = r.active_elapsed_ms;
      state.e7IdleMs = r.paused_idle_ms;
      state.e7LastActTs = Date.now();
    }
  }

  render(false);
  window.scrollTo(0, 0);
}

// ---------- Views ----------
function renderHome(): string {
  // Find first incomplete experiment in strict sequence
  let nextExp = EXPERIMENT_ORDER.find((e) => {
    const st = getStepStats(e.tab);
    return st.done < st.total;
  });
  const allDone = !nextExp;
  if (!nextExp) nextExp = EXPERIMENT_ORDER[EXPERIMENT_ORDER.length - 1];
  const nextStats = getStepStats(nextExp.tab);

  return `
    <div class="hero-card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <span class="badge accent">${allDone ? '🎉 全部实验已通关' : `下一步推荐 · 第 ${nextExp.seq} 关`}</span>
        <span class="muted">E0–E3 电脑已验收 ✅</span>
      </div>
      <div style="font-size:17px;font-weight:800;margin-bottom:4px;">${esc(nextExp.title)}</div>
      <div class="muted" style="margin-bottom:12px;">${esc(nextExp.goal)}</div>
      <div class="progress-bar"><div class="progress-fill" style="width:${Math.round((nextStats.done / Math.max(1, nextStats.total)) * 100)}%"></div></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;">
        <span class="muted">当前进度：<b>${nextStats.done} / ${nextStats.total}</b></span>
        <button class="btn primary" data-nav="${allDone ? 'export' : nextExp.tab}">
          ${allDone ? '📦 打包导出给电脑 →' : nextStats.done > 0 ? '继续本实验 →' : '开始本实验 →'}
        </button>
      </div>
    </div>

    <div style="font-size:12.5px;font-weight:700;color:var(--muted);margin:14px 2px 8px;letter-spacing:0.4px;">
      按实行顺序逐关推进（点击任意实验直接进入）
    </div>

    ${EXPERIMENT_ORDER.map((e) => {
      const st = getStepStats(e.tab);
      const isDone = st.total > 0 && st.done >= st.total;
      const isCur = !allDone && nextExp?.tab === e.tab;
      const pct = st.total > 0 ? Math.min(100, Math.round((st.done / st.total) * 100)) : 0;
      const statusBadge = isDone
        ? `<span class="badge green">✅ 已通关</span>`
        : st.done > 0
          ? `<span class="badge accent">${st.done}/${st.total}</span>`
          : `<span class="badge">待开始</span>`;
      return `
      <div class="step-card" data-nav="${e.tab}" style="${isCur ? 'border-color:rgba(56,189,248,0.45);' : ''}">
        <div class="step-num ${isDone ? 'done' : isCur ? 'current' : ''}">${isDone ? '✓' : e.seq}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:14.5px;display:flex;justify-content:space-between;align-items:center;gap:6px;">
            <span>${esc(e.title)}</span>
            ${statusBadge}
          </div>
          <div class="muted" style="margin-top:2px;">${esc(e.goal)}</div>
          ${st.done > 0 && !isDone ? `<div class="progress-bar" style="margin-top:6px;"><div class="progress-fill" style="width:${pct}%"></div></div>` : ''}
        </div>
      </div>`;
    }).join('')}
  `;
}

// ---------- Profile Modal (keeps Home clean!) ----------
function renderProfileModal(): string {
  if (!state.showProfileModal) return '';
  return `
    <div class="modal-backdrop" id="modal-backdrop">
      <div class="modal-sheet" onclick="event.stopPropagation()">
        <div class="card-title" style="margin-bottom:12px;">
          <span>👤 切换实验身份（严格隔离不同人盲票）</span>
          <button class="btn sm" id="btn-close-profile">完成</button>
        </div>
        <div class="grid-2" style="margin-bottom:10px;">
          <div>
            <div class="muted" style="margin-bottom:4px;">评员 ID（换人听评请改名）</div>
            <input class="input" id="inp-rater" value="${esc(state.profile.rater_id)}" placeholder="rater_A / rater_B" />
          </div>
          <div>
            <div class="muted" style="margin-bottom:4px;">当前角色</div>
            <select class="select" id="sel-role">
              <option value="rater_A" ${state.profile.role === 'rater_A' ? 'selected' : ''}>听众 A (L2 盲评)</option>
              <option value="rater_B" ${state.profile.role === 'rater_B' ? 'selected' : ''}>听众 B (L2 盲评)</option>
              <option value="teacher_L3" ${state.profile.role === 'teacher_L3' ? 'selected' : ''}>播音教师 (L3 技法)</option>
              <option value="auditor" ${state.profile.role === 'auditor' ? 'selected' : ''}>E7 盲审复核员</option>
            </select>
          </div>
        </div>
        <div class="grid-2">
          <div>
            <div class="muted" style="margin-bottom:4px;">干声录音人 speaker_id</div>
            <input class="input" id="inp-speaker" value="${esc(state.profile.speaker_id)}" />
          </div>
          <div>
            <div class="muted" style="margin-bottom:4px;">录制场次 session_id</div>
            <input class="input" id="inp-session" value="${esc(state.profile.session_id)}" />
          </div>
        </div>
      </div>
    </div>
  `;
}

// ---------- Module 1: E2 F0 Stratified Check (One-by-One) ----------
function renderE2F0(): string {
  const items = state.e2Items;
  if (!items.length) return `<div class="card">未找到 E2 F0 抽检包。</div>`;
  const idx = Math.max(0, Math.min(items.length - 1, state.e2Idx));
  const it = items[idx];
  const vote = state.e2Votes[it.item_id];
  const doneCount = Object.keys(state.e2Votes).length;
  const pct = Math.round((doneCount / items.length) * 100);

  const verdicts: { id: E2F0Verdict; label: string; cls: string }[] = [
    { id: 'correct', label: '✅ 基频正确', cls: 'success' },
    { id: 'octave_half', label: '⬇️ 偏低半倍频', cls: 'amber' },
    { id: 'octave_double', label: '⬆️ 偏高两倍频', cls: 'amber' },
    { id: 'unvoiced_false_pos', label: '🔇 清音/静音误报', cls: 'danger' },
    { id: 'abstained', label: '❓ 难判断/弃权', cls: '' },
  ];

  return `
    ${renderCompletionBanner('e2_f0')}
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <span style="font-weight:700;">第 ${idx + 1} / ${items.length} 帧</span>
        <div class="btn-row">
          <span class="badge green">已完成 ${doneCount}/${items.length}</span>
          <button class="btn sm" id="btn-e2-next-unrated">跳至未评</button>
        </div>
      </div>
      <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>

      <div style="display:flex;align-items:center;justify-content:space-between;margin:12px 0 8px;padding:14px;background:var(--bg);border-radius:12px;border:1px solid var(--border);">
        <div>
          <div class="muted">${esc(it.work_id)} · ${it.pitch_register === 'high' ? '高音区' : it.pitch_register === 'low' ? '低音区' : '中音区'}</div>
          <div style="font-size:34px;font-weight:800;line-height:1.2;margin-top:2px;">${esc(it.char)}</div>
        </div>
        <div style="text-align:right;">
          <div class="muted">机器测得 F0</div>
          <div style="font-size:28px;font-weight:800;color:var(--accent);">${it.f0_hz} <span style="font-size:13px;">Hz</span></div>
          ${it.voice_difficulty !== 'normal' ? `<span class="badge amber">${esc(it.voice_difficulty)}</span>` : ''}
        </div>
      </div>

      <div class="wave-wrap"><canvas id="e2-wave" class="wave-canvas"></canvas></div>

      <div class="btn-row" style="margin:8px 0 14px;">
        <button class="btn primary" style="flex:1;" id="btn-e2-play">▶️ 试听 1s 切片 (${state.e2PlayRate}x)</button>
        <button class="btn" id="btn-e2-rate">${state.e2PlayRate === 1 ? '🐢 0.75x' : '⚡ 1.0x'}</button>
        <button class="btn" id="btn-e2-stop">⏹</button>
      </div>

      <div class="muted" style="margin-bottom:6px;">点选判定（选完自动跳下一帧）：</div>
      <div class="grid-2" style="margin-bottom:10px;">
        ${verdicts
          .map(
            (v) =>
              `<button class="btn ${vote?.verdict === v.id ? v.cls || 'primary' : ''}" data-e2-verdict="${v.id}">${v.label}</button>`
          )
          .join('')}
      </div>
      <input class="input" id="inp-e2-note" placeholder="可选备注（如气声/喉化）" value="${esc(vote?.note || '')}" />

      <div class="btn-row" style="margin-top:12px;justify-content:space-between;">
        <button class="btn sm" id="btn-e2-prev" ${idx === 0 ? 'disabled' : ''}>⬅️ 上一帧</button>
        <button class="btn sm" id="btn-e2-next" ${idx === items.length - 1 ? 'disabled' : ''}>下一帧 ➡️</button>
      </div>
    </div>
  `;
}

// ---------- Module 2 & 4: Controlled Dry Recorder (One-by-One) ----------
function renderControlledRecorder(exp: 'expA' | 'expB'): string {
  const isA = exp === 'expA';
  const packA = state.expAPack;
  const packB = state.expBPack;
  if (isA && !packA) return `<div class="card">加载剧本中…</div>`;
  if (!isA && !packB) return `<div class="card">加载剧本中…</div>`;

  const sentences = isA ? packA!.sentences : packB!.sentences;
  const conds = isA
    ? packA!.conditions.map((c) => ({ id: c.condition_id, label: c.label_cn, inst: c.instruction }))
    : packB!.treatments.map((t) => ({ id: t.treatment_id, label: t.label_cn, inst: t.instruction }));

  const sIdx = isA ? state.e4RecSentIdx : state.e5RecSentIdx;
  const cIdx = isA ? state.e4RecCondIdx : state.e5RecCondIdx;
  const sent = sentences[sIdx];
  const cond = conds[cIdx];

  const takeKey = `${exp}::${state.profile.speaker_id}::${sent.text_id}::${cond.id}`;
  const existing = state.takes.find((t) => t.take_key === takeKey);
  const st = getStepStats(isA ? 'e4_rec' : 'e5_rec');
  const pct = Math.round((st.done / Math.max(1, st.total)) * 100);
  const flatIdx = sIdx * conds.length + cIdx + 1;

  let promptHtml = esc(sent.text);
  if (isA) {
    const sA = sent as ExpAControlledPack['sentences'][number];
    promptHtml = promptHtml
      .replace(esc(sA.focus_span), `<span class="hl-focus">${esc(sA.focus_span)}</span>`)
      .replace(esc(sA.weak_span), `<span class="hl-weak">${esc(sA.weak_span)}</span>`);
  } else {
    const sB = sent as ExpBControlledPack['sentences'][number];
    promptHtml = promptHtml.replace(
      esc(sB.target_junction_after),
      `<span class="hl-focus">${esc(sB.target_junction_after)}</span><span class="hl-junc">|</span>`
    );
  }
  const meterPct = Math.max(0, Math.min(100, ((state.recDb + 60) / 60) * 100));

  return `
    ${renderCompletionBanner(isA ? 'e4_rec' : 'e5_rec')}
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <span style="font-weight:700;">第 ${flatIdx} / ${st.total} 条（句 ${sIdx + 1}/${sentences.length}）</span>
        <span class="badge green">已录 ${st.done}/${st.total}</span>
      </div>
      <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>

      <div class="tool-strip" style="margin-top:10px;">
        ${conds
          .map((c, i) => {
            const k = `${exp}::${state.profile.speaker_id}::${sent.text_id}::${c.id}`;
            const has = state.takes.some((t) => t.take_key === k);
            return `<button class="tool-chip ${i === cIdx ? 'active' : ''}" data-rec-cond="${i}">
              ${has ? '✅ ' : ''}${esc(c.label)}
            </button>`;
          })
          .join('')}
      </div>

      <div class="prompt-box">${promptHtml}</div>
      <div class="muted" style="margin-top:8px;padding:9px 11px;background:var(--surface-2);border-radius:10px;">
        <b style="color:var(--amber);">当前条件【${esc(cond.label)}】：</b>${esc(cond.inst)}
        ${!isA && (sent as any).trap_note ? `<br/><b style="color:var(--accent);">声调陷阱：</b>${esc((sent as any).trap_note)}` : ''}
      </div>

      <div style="margin-top:12px;">
        <div style="display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:4px;">
          <span class="muted">干声 WAV · ${esc(state.profile.speaker_id)}</span>
          <span style="color:${state.recClipped ? 'var(--red)' : 'var(--green)'};font-weight:700;">
            ${state.recClipped ? '⚠️ 爆音削波！' : state.isRecording ? `● 录音中 ${state.recDb.toFixed(0)} dB` : 'demucs=false 就绪'}
          </span>
        </div>
        <div class="meter-bar"><div class="meter-fill" style="width:${state.isRecording ? meterPct : 0}%"></div></div>

        <button class="rec-circle ${state.isRecording ? 'recording' : ''}" id="btn-rec-toggle">
          ${state.isRecording ? '⏹ 停止' : existing ? '🔄 重录' : '● 录音'}
        </button>
      </div>

      ${
        existing
          ? `
        <div style="margin-top:10px;padding:10px;background:var(--bg);border-radius:10px;border:1px solid rgba(16,185,129,0.35);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <span class="badge green">✅ 已录 ${(existing.duration_ms / 1000).toFixed(2)}s · ${existing.peak_db} dB</span>
            <button class="btn danger sm" id="btn-rec-del">删除重录</button>
          </div>
          <div class="btn-row">
            <button class="btn sm" id="btn-rec-play">▶️ 试听</button>
            <button class="btn primary" style="flex:1;" id="btn-rec-next-auto">满意，下一条 →</button>
          </div>
        </div>`
          : `
        <div class="btn-row" style="margin-top:8px;justify-content:space-between;">
          <button class="btn sm" id="btn-rec-prev-s" ${sIdx === 0 ? 'disabled' : ''}>⬅️ 上一句</button>
          <button class="btn sm" id="btn-rec-next-s" ${sIdx === sentences.length - 1 ? 'disabled' : ''}>下一句 ➡️</button>
        </div>`
      }
    </div>
  `;
}

// ---------- Module 3: E4 Exp A Ecological Stress (One-by-One) ----------
function renderE4Stress(): string {
  const phrases = state.ecoPhrases;
  if (!phrases.length) return `<div class="card">加载自然短语中…</div>`;
  const idx = Math.max(0, Math.min(phrases.length - 1, state.e4PhraseIdx));
  const ph = phrases[idx];
  const vote = getOrInitE4Vote(ph);
  const st = getStepStats('e4_stress');
  const pct = Math.round((st.done / Math.max(1, st.total)) * 100);

  const isL2 = state.e4Layer === 'L2';
  const selSyl = state.e4SelectedSyl || ph.tokens[0]?.syl_id || '';
  const selTok = ph.tokens.find((t) => t.syl_id === selSyl) || ph.tokens[0];
  const selL3 = vote.l3_labels[selSyl] || { stress_type: 'neutral' as L3StressType, breathy_flag: false };

  const l3Types: { id: L3StressType; label: string }[] = [
    { id: 'strong_stress', label: '🔴 强读重音' },
    { id: 'soft_stress', label: '🟣 轻读重音' },
    { id: 'ordinary_weak', label: '⚪ 普通弱读' },
    { id: 'neutral', label: '中性平读' },
    { id: 'no_explicit_technique', label: '无显式技巧' },
    { id: 'undecidable', label: '难分' },
    { id: 'insufficient_evidence', label: '证据不足' },
    { id: 'N/A', label: 'N/A' },
  ];

  return `
    ${renderCompletionBanner('e4_stress')}
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <span style="font-weight:700;">第 ${idx + 1} / ${phrases.length} 条 · ${esc(ph.title)}</span>
        <span class="badge green">L2已锁 ${st.done}/${st.total}</span>
      </div>
      <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>

      <div class="seg-tabs" style="margin-top:10px;">
        <button class="seg-tab ${isL2 ? 'active' : ''}" data-e4-layer="L2">👁️‍🗨️ L2 蒙眼凸显</button>
        <button class="seg-tab ${!isL2 ? 'active' : ''}" data-e4-layer="L3">🎓 L3 教师技法</button>
      </div>

      <div class="wave-wrap"><canvas id="e4-wave" class="wave-canvas"></canvas></div>
      <div class="btn-row" style="margin-bottom:10px;">
        <button class="btn primary" style="flex:1;" id="btn-e4-play-full">▶️ 播放完整短语 (${(ph.duration_ms / 1000).toFixed(1)}s)</button>
        <button class="btn" id="btn-e4-stop">⏹</button>
      </div>

      ${
        isL2
          ? `
        <div class="tool-strip">
          <button class="tool-chip ${state.e4Tool === 'P2' ? 'active' : ''}" data-e4-tool="P2">🔴 标P2主凸显</button>
          <button class="tool-chip ${state.e4Tool === 'P1' ? 'active' : ''}" data-e4-tool="P1">🟡 标P1次凸显</button>
          <button class="tool-chip ${state.e4Tool === 'listen' ? 'active' : ''}" data-e4-tool="listen">🎧 仅听单字</button>
          <button class="tool-chip ${state.e4Tool === 'abstained' ? 'active' : ''}" data-e4-tool="abstained">❓ 弃权</button>
          <button class="tool-chip ${state.e4Tool === 'clear' ? 'active' : ''}" data-e4-tool="clear">🧹 清除</button>
        </div>

        <div class="token-flow">
          ${ph.tokens
            .map((t) => {
              const lbl = vote.l2_labels[t.syl_id] || 'none';
              const cls = lbl === 'P2' ? 'p2' : lbl === 'P1' ? 'p1' : lbl === 'abstained' ? 'abstained' : '';
              return `<button class="tok-pill ${cls}" data-e4-syl="${esc(t.syl_id)}">
                <span>${esc(t.char)}</span>
                <span class="sub">${lbl !== 'none' ? lbl : t.punct || '·'}</span>
              </button>`;
            })
            .join('')}
        </div>

        <label style="display:flex;align-items:center;gap:8px;margin:10px 0;font-size:13px;cursor:pointer;">
          <input type="checkbox" id="chk-e4-noprom" ${vote.no_prominent_word ? 'checked' : ''} ${vote.l2_locked ? 'disabled' : ''} />
          <span>整句无显著重点（允许空选）</span>
        </label>

        <div class="btn-row" style="justify-content:space-between;">
          <button class="btn sm" id="btn-e4-prev" ${idx === 0 ? 'disabled' : ''}>⬅️ 上条</button>
          ${
            vote.l2_locked
              ? `<button class="btn amber sm" id="btn-e4-unlock">🔓 解锁重评</button>`
              : `<button class="btn success" style="flex:1;" id="btn-e4-lock">🔒 锁定本题，下一条 →</button>`
          }
          <button class="btn sm" id="btn-e4-next" ${idx === phrases.length - 1 ? 'disabled' : ''}>下条 ➡️</button>
        </div>`
          : `
        <div class="token-flow" style="margin-bottom:10px;">
          ${ph.tokens
            .map((t) => {
              const l3 = vote.l3_labels[t.syl_id];
              const stL = l3?.stress_type || 'neutral';
              const cls = stL === 'strong_stress' ? 'l3-strong' : stL === 'soft_stress' ? 'l3-soft' : stL === 'ordinary_weak' ? 'l3-weak' : '';
              const shortLbl = stL === 'strong_stress' ? '强' : stL === 'soft_stress' ? '轻重' : stL === 'ordinary_weak' ? '弱' : stL === 'undecidable' ? '难' : '·';
              return `<button class="tok-pill ${cls} ${selSyl === t.syl_id ? 'selected' : ''}" data-e4-l3-syl="${esc(t.syl_id)}">
                <span>${esc(t.char)}</span>
                <span class="sub">${shortLbl}${l3?.breathy_flag ? '💨' : ''}</span>
              </button>`;
            })
            .join('')}
        </div>

        ${
          selTok
            ? `
          <div style="padding:10px;background:var(--bg);border-radius:10px;border:1px solid var(--border);margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <b>选中字：「${esc(selTok.char)}」</b>
              <button class="btn sm primary" id="btn-e4-play-syl">🎧 听单字</button>
            </div>
            <div class="grid-2" style="margin-bottom:8px;">
              ${l3Types.map((lt) => `<button class="btn sm ${selL3.stress_type === lt.id ? 'primary' : ''}" data-e4-l3-type="${lt.id}">${lt.label}</button>`).join('')}
            </div>
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;">
              <input type="checkbox" id="chk-e4-breathy" ${selL3.breathy_flag ? 'checked' : ''} />
              <span>💨 独立勾选：带明显虚声/气声</span>
            </label>
          </div>`
            : ''
        }

        <div class="btn-row" style="justify-content:space-between;">
          <button class="btn sm" id="btn-e4-prev" ${idx === 0 ? 'disabled' : ''}>⬅️ 上条</button>
          <button class="btn success" style="flex:1;" id="btn-e4-save-l3">💾 保存 L3，下一条 →</button>
          <button class="btn sm" id="btn-e4-next" ${idx === phrases.length - 1 ? 'disabled' : ''}>下条 ➡️</button>
        </div>`
      }
    </div>
  `;
}

// ---------- Module 5: E5 Exp B All-Junction Boundary (One-by-One) ----------
function renderE5Boundary(): string {
  const phrases = state.ecoPhrases;
  if (!phrases.length) return `<div class="card">加载自然短语中…</div>`;
  const idx = Math.max(0, Math.min(phrases.length - 1, state.e5PhraseIdx));
  const ph = phrases[idx];
  const vote = getOrInitE5Vote(ph);
  const st = getStepStats('e5_boundary');
  const pct = Math.round((st.done / Math.max(1, st.total)) * 100);

  const isL2 = state.e5Layer === 'L2';
  const maxJunc = Math.max(0, ph.tokens.length - 2);
  const selJ = Math.max(0, Math.min(maxJunc, state.e5SelectedJunc));
  const jKey = String(selJ);
  const curL2: JunctionL2 = vote.l2_junctions[jKey] || { level: 'none', sense: 'uncertain', audible_gap: false };
  const curL3: L3BreakMethod = vote.l3_junctions[jKey] || 'no_technique';
  const leftTok = ph.tokens[selJ];
  const rightTok = ph.tokens[selJ + 1];

  const l3Methods: { id: L3BreakMethod; label: string }[] = [
    { id: 'direct_link', label: '➡️ 直连' },
    { id: 'curved_link', label: '〰️ 曲连（藕断丝连）' },
    { id: 'rising_pause', label: '↗️ 扬停' },
    { id: 'falling_pause', label: '↘️ 落停' },
    { id: 'no_technique', label: '无显式技巧' },
    { id: 'hard_to_decide', label: '难分' },
  ];

  return `
    ${renderCompletionBanner('e5_boundary')}
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <span style="font-weight:700;">第 ${idx + 1} / ${phrases.length} 条 · ${esc(ph.title)}</span>
        <span class="badge green">L2已锁 ${st.done}/${st.total}</span>
      </div>
      <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>

      <div class="seg-tabs" style="margin-top:10px;">
        <button class="seg-tab ${isL2 ? 'active' : ''}" data-e5-layer="L2">👁️‍🗨️ L2 全接点分组</button>
        <button class="seg-tab ${!isL2 ? 'active' : ''}" data-e5-layer="L3">🎓 L3 停连四法</button>
      </div>

      <div class="wave-wrap"><canvas id="e5-wave" class="wave-canvas"></canvas></div>
      <div class="btn-row" style="margin-bottom:10px;">
        <button class="btn primary" style="flex:1;" id="btn-e5-play-full">▶️ 播放全句</button>
        <button class="btn" id="btn-e5-play-junc">🎧 听当前接点</button>
        <button class="btn" id="btn-e5-stop">⏹</button>
      </div>

      <div class="token-flow" style="gap:5px 3px;">
        ${ph.tokens
          .map((t, i) => {
            const charSpan = `<span style="font-size:18px;font-weight:700;padding:4px 2px;">${esc(t.char)}</span>`;
            if (i >= ph.tokens.length - 1) return charSpan;
            const k = String(i);
            let cls = '';
            let sym = '·';
            if (isL2) {
              const jl = vote.l2_junctions[k]?.level || 'none';
              if (jl === 'minor_group') { cls = 'minor'; sym = '/'; }
              else if (jl === 'major_group') { cls = 'major'; sym = '//'; }
              else if (jl === 'abstained') { cls = 'abstained'; sym = '?'; }
            } else {
              const jm = vote.l3_junctions[k];
              if (jm === 'direct_link') { cls = 'l3-direct'; sym = '^'; }
              else if (jm === 'curved_link') { cls = 'l3-curved'; sym = '~'; }
              else if (jm === 'rising_pause') { cls = 'l3-rising'; sym = '↗'; }
              else if (jm === 'falling_pause') { cls = 'l3-falling'; sym = '↘'; }
            }
            return `${charSpan}<button class="junction-btn ${cls} ${selJ === i ? 'active' : ''}" data-e5-junc="${i}">${sym}</button>`;
          })
          .join('')}
      </div>

      ${
        leftTok && rightTok
          ? `
        <div style="margin-top:10px;padding:10px;background:var(--bg);border-radius:10px;border:1px solid var(--border);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <b>接点 #${selJ + 1}：「${esc(leftTok.char)}」⇄「${esc(rightTok.char)}」</b>
            <span class="badge ${leftTok.punct ? 'amber' : 'accent'}">${leftTok.punct ? `标点 ${esc(leftTok.punct)}` : '无标点'}</span>
          </div>
          ${
            isL2
              ? `
            <div class="grid-2" style="margin-bottom:8px;">
              ${(
                [['none', '无分组'], ['minor_group', '/ 小分组'], ['major_group', '// 大分组'], ['abstained', '? 难判断']] as [L2GroupLevel, string][]
              ).map(([lv, lb]) => `<button class="btn sm ${curL2.level === lv ? 'primary' : ''}" data-e5-l2-lv="${lv}" ${vote.l2_locked ? 'disabled' : ''}>${lb}</button>`).join('')}
            </div>
            <div class="grid-3" style="margin-bottom:8px;">
              ${(
                [['continuation', '期待下文'], ['closure', '感觉收住'], ['uncertain', '不确定']] as [L2SenseType, string][]
              ).map(([sn, lb]) => `<button class="btn sm ${curL2.sense === sn ? 'amber' : ''}" data-e5-l2-sense="${sn}" ${vote.l2_locked ? 'disabled' : ''}>${lb}</button>`).join('')}
            </div>
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;">
              <input type="checkbox" id="chk-e5-gap" ${curL2.audible_gap ? 'checked' : ''} ${vote.l2_locked ? 'disabled' : ''} />
              <span>有明显静音空隙（不勾 = 无空隙/潜在曲连）</span>
            </label>`
              : `
            <div class="grid-2">
              ${l3Methods.map((m) => `<button class="btn sm ${curL3 === m.id ? 'primary' : ''}" data-e5-l3-method="${m.id}">${m.label}</button>`).join('')}
            </div>`
          }
        </div>`
          : ''
      }

      <div class="btn-row" style="margin-top:12px;justify-content:space-between;">
        <button class="btn sm" id="btn-e5-prev" ${idx === 0 ? 'disabled' : ''}>⬅️ 上条</button>
        ${
          isL2
            ? vote.l2_locked
              ? `<button class="btn amber sm" id="btn-e5-unlock">🔓 解锁</button>`
              : `<button class="btn success" style="flex:1;" id="btn-e5-lock">🔒 锁定本题，下一条 →</button>`
            : `<button class="btn success" style="flex:1;" id="btn-e5-save-l3">💾 保存 L3，下一条 →</button>`
        }
        <button class="btn sm" id="btn-e5-next" ${idx === phrases.length - 1 ? 'disabled' : ''}>下条 ➡️</button>
      </div>
    </div>
  `;
}

// ---------- Module 6: E7 Human Trial & Audit (One-by-One) ----------
function renderE7Trial(): string {
  const items = state.e7Items;
  if (!items.length) return `<div class="card">加载 E7 对照试次中…</div>`;
  const idx = Math.max(0, Math.min(items.length - 1, state.e7Idx));
  const item = items[idx];
  const rec = getOrInitE7Record(item);
  const isProof = state.e7Mode === 'proofread';
  const st = getStepStats('e7_trial');
  const pct = Math.round((st.done / Math.max(1, st.total)) * 100);

  return `
    ${renderCompletionBanner('e7_trial')}
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <span style="font-weight:700;">第 ${idx + 1} / ${items.length} 题 · ${esc(item.title)}</span>
        ${isProof ? `<span class="badge amber">⏱️ <span id="e7-timer-val">${(state.e7ActiveMs / 1000).toFixed(0)}s</span></span>` : `<span class="badge purple">盲审模式</span>`}
      </div>
      <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>

      <div class="seg-tabs" style="margin-top:10px;">
        <button class="seg-tab ${isProof ? 'active' : ''}" data-e7-mode="proofread">✍️ 校对员计时 (${esc(item.arm_masked)})</button>
        <button class="seg-tab ${!isProof ? 'active' : ''}" data-e7-mode="audit">🔍 盲审残留错</button>
      </div>

      <div class="wave-wrap"><canvas id="e7-wave" class="wave-canvas"></canvas></div>
      <div class="btn-row" style="margin-bottom:10px;">
        <button class="btn primary" style="flex:1;" id="btn-e7-play">▶️ 播放音频</button>
        <button class="btn" id="btn-e7-stop">⏹</button>
      </div>

      ${
        isProof
          ? `
        <div class="tool-strip">
          <button class="tool-chip ${state.e7Tool === 'listen' ? 'active' : ''}" data-e7-tool="listen">🎧 听单字</button>
          <button class="tool-chip ${state.e7Tool === 'P2' ? 'active' : ''}" data-e7-tool="P2">🔴 P2</button>
          <button class="tool-chip ${state.e7Tool === 'P1' ? 'active' : ''}" data-e7-tool="P1">🟡 P1</button>
          <button class="tool-chip ${state.e7Tool === 'clear_p' ? 'active' : ''}" data-e7-tool="clear_p">🧹 删凸显</button>
          <button class="tool-chip ${state.e7Tool === 'minor_b' ? 'active' : ''}" data-e7-tool="minor_b">/ 小停</button>
          <button class="tool-chip ${state.e7Tool === 'major_b' ? 'active' : ''}" data-e7-tool="major_b">// 大停</button>
          <button class="tool-chip ${state.e7Tool === 'clear_b' ? 'active' : ''}" data-e7-tool="clear_b">清停顿</button>
        </div>

        <div class="token-flow">
          ${item.tokens
            .map((t, i) => {
              const k = String(i);
              const p = rec.final_prominence[k];
              const b = rec.final_breaks[k];
              const isAbst = item.machine_draft.abstain_indices.includes(i);
              const cls = `${p === 'P2' ? 'p2' : p === 'P1' ? 'p1' : ''} ${isAbst ? 'abstain-draft' : ''}`;
              const brkSym = b === 'major' ? '//' : b === 'minor' ? '/' : '';
              return `<button class="tok-pill ${cls}" data-e7-idx="${i}">
                <span>${esc(t.char)}</span>
                <span class="sub">${p || ''}${brkSym ? ` ${brkSym}` : isAbst ? '弃权' : '·'}</span>
              </button>`;
            })
            .join('')}
        </div>

        <div class="btn-row" style="margin-top:12px;justify-content:space-between;">
          <button class="btn sm" id="btn-e7-prev" ${idx === 0 ? 'disabled' : ''}>⬅️ 上题</button>
          <button class="btn success" style="flex:1;" id="btn-e7-complete">${rec.completed ? '✅ 已完结 (更新)' : '✅ 完结本题，下一题 →'}</button>
          <button class="btn sm" id="btn-e7-next" ${idx === items.length - 1 ? 'disabled' : ''}>下题 ➡️</button>
        </div>`
          : `
        <div class="token-flow" style="margin-bottom:10px;">
          ${item.tokens
            .map((t, i) => {
              const k = String(i);
              const p = rec.final_prominence[k];
              const b = rec.final_breaks[k];
              const cls = p === 'P2' ? 'p2' : p === 'P1' ? 'p1' : '';
              return `<div class="tok-pill ${cls}"><span>${esc(t.char)}</span><span class="sub">${p || ''}${b === 'major' ? ' //' : b === 'minor' ? ' /' : ''}</span></div>`;
            })
            .join('')}
        </div>
        <div class="grid-2" style="margin-bottom:8px;">
          <div>
            <div class="muted">残留关键错（门禁 Δ≤0）</div>
            <input class="input" type="number" min="0" id="inp-e7-crit" value="${rec.audit_critical_errors ?? 0}" />
          </div>
          <div>
            <div class="muted">残留轻微错</div>
            <input class="input" type="number" min="0" id="inp-e7-minor" value="${rec.audit_minor_errors ?? 0}" />
          </div>
        </div>
        <input class="input" id="inp-e7-note" placeholder="盲审备注" value="${esc(rec.audit_note || '')}" />
        <div class="btn-row" style="margin-top:12px;justify-content:space-between;">
          <button class="btn sm" id="btn-e7-prev" ${idx === 0 ? 'disabled' : ''}>⬅️ 上题</button>
          <button class="btn success" style="flex:1;" id="btn-e7-save-audit">💾 提交盲审，下一题 →</button>
          <button class="btn sm" id="btn-e7-next" ${idx === items.length - 1 ? 'disabled' : ''}>下题 ➡️</button>
        </div>`
      }
    </div>
  `;
}

// ---------- Export & Output File Spec Inspector ----------
function renderExport(): string {
  const sE2 = getStepStats('e2_f0').done;
  const sE4R = getStepStats('e4_rec').done;
  const sE4S = getStepStats('e4_stress').done;
  const sE5R = getStepStats('e5_rec').done;
  const sE5B = getStepStats('e5_boundary').done;
  const sE7 = getStepStats('e7_trial').done;

  const specs: Record<string, { title: string; file: string; pcPath: string; cmd: string; sample: unknown }> = {
    e2: {
      title: 'E2 F0 抽检',
      file: 'e2_f0_reviewed.json',
      pcPath: 'experiments\\e2_blind_eval\\e2_f0_reviewed.json',
      cmd: 'python scripts/run_e2_f0_stratified_check.py',
      sample: buildE2F0Export(state.e2Items, state.e2Votes).slice(0, 2),
    },
    e4_rec: {
      title: 'E4 干声包',
      file: 'osot_expA_dry_audio_*.zip',
      pcPath: 'experiments\\expA\\mobile_dry_audio\\',
      cmd: 'python scripts/import_mobile_pack.py <zip文件>',
      sample: {
        experiment: 'expA',
        demucs_applied: false,
        count: state.takes.filter((t) => t.experiment === 'expA').length,
        entries: state.takes.filter((t) => t.experiment === 'expA').slice(0, 2).map(({ wav_base64: _, ...rest }) => rest),
      },
    },
    e4_stress: {
      title: 'E4 重音票',
      file: 'e4_expA_votes.json',
      pcPath: 'experiments\\expA\\mobile_votes\\',
      cmd: 'python scripts/import_mobile_pack.py e4_expA_votes.json',
      sample: buildE4StressExport(state.ecoPhrases, state.e4Votes),
    },
    e5_rec: {
      title: 'E5 干声包',
      file: 'osot_expB_dry_audio_*.zip',
      pcPath: 'experiments\\expB\\mobile_dry_audio\\',
      cmd: 'python scripts/import_mobile_pack.py <zip文件>',
      sample: {
        experiment: 'expB',
        demucs_applied: false,
        count: state.takes.filter((t) => t.experiment === 'expB').length,
        entries: state.takes.filter((t) => t.experiment === 'expB').slice(0, 2).map(({ wav_base64: _, ...rest }) => rest),
      },
    },
    e5_boundary: {
      title: 'E5 停连票',
      file: 'e5_expB_boundary_votes.json',
      pcPath: 'experiments\\expB\\mobile_votes\\',
      cmd: 'python scripts/import_mobile_pack.py e5_expB_boundary_votes.json',
      sample: buildE5BoundaryExport(state.ecoPhrases, state.e5Votes),
    },
    e7: {
      title: 'E7 对照',
      file: 'e7_human_trial_export.json',
      pcPath: 'experiments\\e7_trial\\mobile_sessions\\',
      cmd: 'python scripts/import_mobile_pack.py e7_human_trial_export.json',
      sample: buildE7TrialExport(state.e7Records),
    },
  };

  const curSpec = specs[state.exportPreviewKey] || specs.e2;
  const previewText = JSON.stringify(curSpec.sample, null, 2).slice(0, 2400);

  return `
    <div class="card">
      <div class="card-title">
        <span>📦 一键打包导出给电脑分析</span>
        <span class="badge green">全部 JSON + WAV</span>
      </div>
      <div class="muted" style="margin-bottom:10px;">
        保存到 <code>Downloads/OSOT_Exports/</code> 并调起分享。传回电脑后运行：<code>python scripts/import_mobile_pack.py xxx.zip</code>
      </div>
      <button class="btn primary block" id="btn-exp-master">🚀 导出全部实验成果总包 (.zip)</button>
    </div>

    <div class="card">
      <div class="card-title"><span>🗂️ 分实验单独导出</span></div>
      <div class="grid-2">
        <button class="btn sm" id="btn-exp-e2">E2 F0 JSON (${sE2})</button>
        <button class="btn sm" id="btn-exp-e4rec">E4 干声 ZIP (${sE4R})</button>
        <button class="btn sm" id="btn-exp-e4s">E4 重音 JSON (${sE4S})</button>
        <button class="btn sm" id="btn-exp-e5rec">E5 干声 ZIP (${sE5R})</button>
        <button class="btn sm" id="btn-exp-e5b">E5 停连 JSON (${sE5B})</button>
        <button class="btn sm" id="btn-exp-e7">E7 对照 JSON (${sE7})</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title"><span>🔬 输出文件结构实时预览</span></div>
      <div class="tool-strip">
        ${Object.entries(specs).map(([k, v]) => `<button class="tool-chip ${state.exportPreviewKey === k ? 'active' : ''}" data-exp-prev="${k}">${v.title}</button>`).join('')}
      </div>
      <div style="font-size:12px;margin-bottom:8px;">
        <div><b>文件名：</b><code>${esc(curSpec.file)}</code></div>
        <div><b>电脑目录：</b><code>${esc(curSpec.pcPath)}</code></div>
        <div><b>分析命令：</b><code>${esc(curSpec.cmd)}</code></div>
      </div>
      <div class="code-preview">${esc(previewText)}</div>
    </div>
  `;
}

// ---------- Real-Time GitHub Updater ----------
function renderUpdate(): string {
  const rel = state.latestRelease;
  const hasNew = rel && rel.version_code > state.nativeVersionCode;
  return `
    <div class="card">
      <div class="card-title">
        <span>🔄 实时在线更新系统</span>
        <span class="badge accent">当前 v${esc(state.nativeVersionName)}</span>
      </div>
      <div class="muted" style="margin-bottom:10px;">
        自动检测 GitHub <code>${GITHUB_REPO}</code> 最新 Release，同密钥签名直接覆盖安装，保留全部本地标注与干声数据。
      </div>
      <div style="margin-bottom:10px;">
        <div class="muted" style="margin-bottom:4px;">国内加速镜像前缀（留空为直连 GitHub）</div>
        <input class="input" id="inp-mirror" value="${esc(state.profile.update_mirror)}" placeholder="例如 https://ghfast.top/" />
      </div>
      <button class="btn primary block" id="btn-check-update" ${state.checkingUpdate ? 'disabled' : ''}>
        ${state.checkingUpdate ? '⏳ 正在检查最新版本…' : '🔍 立即检查更新'}
      </button>
      ${state.updateError ? `<div class="badge red" style="margin-top:10px;display:block;padding:8px;">${esc(state.updateError)}</div>` : ''}
      ${
        rel
          ? `
        <div style="margin-top:12px;padding:12px;background:var(--bg);border-radius:10px;border:1px solid var(--border);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <b>云端最新：${esc(rel.tag_name)}</b>
            <span class="badge ${hasNew ? 'amber' : 'green'}">${hasNew ? '发现新版本！' : '已是最新'}</span>
          </div>
          <div class="muted" style="white-space:pre-wrap;margin-bottom:10px;">${esc(rel.body)}</div>
          <div class="muted" style="font-size:11px;margin-bottom:8px;">${esc(rel.apk_name)} (${(rel.apk_size / 1024 / 1024).toFixed(2)} MB)</div>
          ${
            state.downloadProgress >= 0
              ? `<div class="progress-bar"><div class="progress-fill" style="width:${state.downloadProgress}%"></div></div>
                 <div class="muted" style="margin-bottom:8px;">${esc(state.downloadStatus)} (${state.downloadProgress}%)</div>`
              : ''
          }
          <button class="btn ${hasNew ? 'success' : ''} block" id="btn-install-apk" ${!rel.apk_url ? 'disabled' : ''}>
            ⬇️ ${hasNew ? '一键下载并安装新版本 APK' : '重新下载安装此版本 APK'}
          </button>
        </div>`
          : ''
      }
    </div>
  `;
}

// ---------- Main Render & Event Binding ----------
function render(preserveScroll = false) {
  const app = document.getElementById('app');
  if (!app) return;
  const savedScrollY = preserveScroll ? window.scrollY : 0;

  const meta = EXPERIMENT_ORDER.find((x) => x.tab === state.tab);
  const topTitle =
    state.tab === 'home'
      ? 'OSOT 声笺实验台'
      : state.tab === 'export'
        ? '导出与电脑对接'
        : state.tab === 'update'
          ? '实时在线更新'
          : meta?.shortTitle || '实验';

  let bodyHtml = '';
  if (state.loading) {
    bodyHtml = `<div class="card" style="text-align:center;padding:30px;">正在加载 OSOT 实音实验包…</div>`;
  } else {
    switch (state.tab) {
      case 'home': bodyHtml = renderHome(); break;
      case 'e2_f0': bodyHtml = renderE2F0(); break;
      case 'e4_rec': bodyHtml = renderControlledRecorder('expA'); break;
      case 'e4_stress': bodyHtml = renderE4Stress(); break;
      case 'e5_rec': bodyHtml = renderControlledRecorder('expB'); break;
      case 'e5_boundary': bodyHtml = renderE5Boundary(); break;
      case 'e7_trial': bodyHtml = renderE7Trial(); break;
      case 'export': bodyHtml = renderExport(); break;
      case 'update': bodyHtml = renderUpdate(); break;
    }
  }

  const isExpScreen = Boolean(meta);

  app.innerHTML = `
    <div class="topbar">
      <div class="topbar-title">
        ${isExpScreen ? `<button class="btn sm" data-nav="home">← 实验列表</button>` : ''}
        <span>${topTitle}</span>
      </div>
      <button class="btn sm" id="btn-open-profile">👤 ${esc(state.profile.rater_id)} ▾</button>
    </div>

    <div class="main-scroll">${bodyHtml}</div>

    ${renderProfileModal()}
    ${state.toast ? `<div class="toast">${esc(state.toast)}</div>` : ''}

    <div class="bottom-nav">
      <button class="nav-item ${state.tab === 'home' || isExpScreen ? 'active' : ''}" data-nav="home"><span class="ico">🧪</span><span>实验</span></button>
      <button class="nav-item ${state.tab === 'export' ? 'active' : ''}" data-nav="export"><span class="ico">📦</span><span>导出</span></button>
      <button class="nav-item ${state.tab === 'update' ? 'active' : ''}" data-nav="update"><span class="ico">🔄</span><span>更新</span></button>
    </div>
  `;

  if (preserveScroll) window.scrollTo(0, savedScrollY);
  bindEvents();
  paintActiveWaveform();
}

function paintActiveWaveform(progressRatio = 0) {
  if (state.tab === 'e2_f0') {
    const cv = document.getElementById('e2-wave') as HTMLCanvasElement | null;
    const it = state.e2Items[state.e2Idx];
    if (cv && it) drawWaveform(cv, it.waveform, progressRatio, it.clip_duration_ms > 0 ? it.clip_offset_ms / it.clip_duration_ms : 0.5);
  } else if (state.tab === 'e4_stress') {
    const cv = document.getElementById('e4-wave') as HTMLCanvasElement | null;
    const ph = state.ecoPhrases[state.e4PhraseIdx];
    if (cv && ph) drawWaveform(cv, ph.waveform, progressRatio);
  } else if (state.tab === 'e5_boundary') {
    const cv = document.getElementById('e5-wave') as HTMLCanvasElement | null;
    const ph = state.ecoPhrases[state.e5PhraseIdx];
    if (cv && ph) drawWaveform(cv, ph.waveform, progressRatio);
  } else if (state.tab === 'e7_trial') {
    const cv = document.getElementById('e7-wave') as HTMLCanvasElement | null;
    const it = state.e7Items[state.e7Idx];
    if (cv && it) drawWaveform(cv, it.waveform, progressRatio);
  }
}

function bindEvents() {
  // Navigation
  document.querySelectorAll<HTMLElement>('[data-nav]').forEach((el) => {
    el.onclick = () => {
      navigateTo(el.dataset.nav as TabId);
    };
  });

  // Profile Modal
  document.getElementById('btn-open-profile')?.addEventListener('click', () => {
    state.showProfileModal = true;
    render(true);
  });
  document.getElementById('btn-close-profile')?.addEventListener('click', () => {
    state.showProfileModal = false;
    render(true);
  });
  document.getElementById('modal-backdrop')?.addEventListener('click', () => {
    state.showProfileModal = false;
    render(true);
  });

  const inpRater = document.getElementById('inp-rater') as HTMLInputElement | null;
  if (inpRater) {
    inpRater.onchange = () => {
      state.profile.rater_id = inpRater.value.trim() || 'rater_A';
      saveProfile(state.profile);
    };
  }
  const selRole = document.getElementById('sel-role') as HTMLSelectElement | null;
  if (selRole) {
    selRole.onchange = () => {
      state.profile.role = selRole.value as RaterProfile['role'];
      if (selRole.value === 'rater_A' || selRole.value === 'rater_B') state.profile.rater_id = selRole.value;
      saveProfile(state.profile);
      render(true);
    };
  }
  const inpSpk = document.getElementById('inp-speaker') as HTMLInputElement | null;
  if (inpSpk) {
    inpSpk.onchange = () => {
      state.profile.speaker_id = inpSpk.value.trim() || 'spk_user_water';
      saveProfile(state.profile);
    };
  }
  const inpSess = document.getElementById('inp-session') as HTMLInputElement | null;
  if (inpSess) {
    inpSess.onchange = () => {
      state.profile.session_id = inpSess.value.trim() || state.profile.session_id;
      saveProfile(state.profile);
    };
  }

  // ---------- E2 F0 ----------
  if (state.tab === 'e2_f0') {
    const it = state.e2Items[state.e2Idx];
    document.getElementById('btn-e2-play')?.addEventListener('click', () => {
      if (!it?.clip_url) return;
      playClip(`./${it.clip_url}`, {
        rate: state.e2PlayRate,
        onProgress: (cur, dur) => paintActiveWaveform(dur > 0 ? cur / dur : 0),
        onEnd: () => paintActiveWaveform(0),
      });
    });
    document.getElementById('btn-e2-rate')?.addEventListener('click', () => {
      state.e2PlayRate = state.e2PlayRate === 1.0 ? 0.75 : 1.0;
      render(true);
    });
    document.getElementById('btn-e2-stop')?.addEventListener('click', () => { stopAudio(); paintActiveWaveform(0); });
    document.querySelectorAll<HTMLElement>('[data-e2-verdict]').forEach((btn) => {
      btn.onclick = () => {
        if (!it) return;
        stopAudio();
        const noteEl = document.getElementById('inp-e2-note') as HTMLInputElement | null;
        state.e2Votes[it.item_id] = {
          item_id: it.item_id,
          verdict: btn.dataset.e2Verdict as E2F0Verdict,
          note: noteEl?.value || '',
          rater_id: state.profile.rater_id,
          reviewed_at: new Date().toISOString(),
        };
        saveE2F0Votes(state.e2Votes);
        // Auto-advance to next unrated frame!
        const nextU = state.e2Items.findIndex((x, i) => i > state.e2Idx && !state.e2Votes[x.item_id]);
        if (nextU >= 0) state.e2Idx = nextU;
        else if (state.e2Idx < state.e2Items.length - 1) state.e2Idx++;
        render(false);
      };
    });
    document.getElementById('btn-e2-prev')?.addEventListener('click', () => { stopAudio(); state.e2Idx = Math.max(0, state.e2Idx - 1); render(false); });
    document.getElementById('btn-e2-next')?.addEventListener('click', () => { stopAudio(); state.e2Idx = Math.min(state.e2Items.length - 1, state.e2Idx + 1); render(false); });
    document.getElementById('btn-e2-next-unrated')?.addEventListener('click', () => {
      stopAudio();
      const u = state.e2Items.findIndex((x) => !state.e2Votes[x.item_id]);
      if (u >= 0) { state.e2Idx = u; render(false); } else showToast('全部 38 帧已核验通关！');
    });
  }

  // ---------- Controlled Recorder (Exp A / Exp B) ----------
  if (state.tab === 'e4_rec' || state.tab === 'e5_rec') {
    const isA = state.tab === 'e4_rec';
    const exp = isA ? 'expA' : 'expB';
    const sentences = isA ? state.expAPack!.sentences : state.expBPack!.sentences;
    const conds = isA
      ? state.expAPack!.conditions.map((c) => c.condition_id)
      : state.expBPack!.treatments.map((t) => t.treatment_id);
    const sIdx = isA ? state.e4RecSentIdx : state.e5RecSentIdx;
    const cIdx = isA ? state.e4RecCondIdx : state.e5RecCondIdx;
    const sent = sentences[sIdx];
    const condId = conds[cIdx];
    const takeKey = `${exp}::${state.profile.speaker_id}::${sent.text_id}::${condId}`;

    document.getElementById('btn-rec-prev-s')?.addEventListener('click', () => {
      if (isA) state.e4RecSentIdx = Math.max(0, sIdx - 1); else state.e5RecSentIdx = Math.max(0, sIdx - 1);
      render(false);
    });
    document.getElementById('btn-rec-next-s')?.addEventListener('click', () => {
      if (isA) state.e4RecSentIdx = Math.min(sentences.length - 1, sIdx + 1); else state.e5RecSentIdx = Math.min(sentences.length - 1, sIdx + 1);
      render(false);
    });
    document.querySelectorAll<HTMLElement>('[data-rec-cond]').forEach((b) => {
      b.onclick = () => {
        const ci = parseInt(b.dataset.recCond || '0', 10);
        if (isA) state.e4RecCondIdx = ci; else state.e5RecCondIdx = ci;
        render(true);
      };
    });
    document.getElementById('btn-rec-toggle')?.addEventListener('click', async () => {
      if (!state.isRecording) {
        try {
          stopAudio();
          state.isRecording = true;
          state.recClipped = false;
          state.recDb = -60;
          render(true);
          await startDryRecording((db, clipped) => {
            state.recDb = db;
            if (clipped) state.recClipped = true;
            const fill = document.querySelector<HTMLElement>('.meter-fill');
            if (fill) fill.style.width = `${Math.max(0, Math.min(100, ((db + 60) / 60) * 100))}%`;
          });
        } catch (err: any) {
          state.isRecording = false;
          showToast(err?.message || '无法启动录音');
          render(true);
        }
      } else {
        try {
          const res = await stopDryRecording();
          state.isRecording = false;
          const take: RecordedTake = {
            take_key: takeKey,
            experiment: exp,
            speaker_id: state.profile.speaker_id,
            session_id: state.profile.session_id,
            text_id: sent.text_id,
            condition_id: condId,
            filename: `${exp}_${state.profile.speaker_id}_${sent.text_id}_${condId}.wav`,
            duration_ms: res.durationMs,
            peak_db: res.peakDb,
            clipped: res.clipped,
            demucs_applied: false,
            recorded_at: new Date().toISOString(),
            wav_base64: res.wavBase64,
          };
          await saveRecordedTake(take);
          state.takes = await loadAllRecordedTakes();
          showToast(`干声已保存 ${(res.durationMs / 1000).toFixed(1)}s`);
          render(true);
        } catch (err: any) {
          state.isRecording = false;
          showToast(err?.message || '停止录音失败');
          render(true);
        }
      }
    });
    document.getElementById('btn-rec-play')?.addEventListener('click', () => {
      const t = state.takes.find((x) => x.take_key === takeKey);
      if (t) playBase64Wav(t.wav_base64);
    });
    document.getElementById('btn-rec-del')?.addEventListener('click', async () => {
      await deleteRecordedTake(takeKey);
      state.takes = await loadAllRecordedTakes();
      showToast('已删除，可重新录制');
      render(true);
    });
    document.getElementById('btn-rec-next-auto')?.addEventListener('click', () => {
      stopAudio();
      if (cIdx < conds.length - 1) {
        if (isA) state.e4RecCondIdx++; else state.e5RecCondIdx++;
      } else if (sIdx < sentences.length - 1) {
        if (isA) { state.e4RecSentIdx++; state.e4RecCondIdx = 0; }
        else { state.e5RecSentIdx++; state.e5RecCondIdx = 0; }
      }
      render(false);
    });
  }

  // ---------- E4 Stress ----------
  if (state.tab === 'e4_stress') {
    const ph = state.ecoPhrases[state.e4PhraseIdx];
    const vote = getOrInitE4Vote(ph);
    document.querySelectorAll<HTMLElement>('[data-e4-layer]').forEach((b) => {
      b.onclick = () => { state.e4Layer = b.dataset.e4Layer as 'L2' | 'L3'; render(true); };
    });
    document.querySelectorAll<HTMLElement>('[data-e4-tool]').forEach((b) => {
      b.onclick = () => { state.e4Tool = b.dataset.e4Tool as any; render(true); };
    });
    document.getElementById('btn-e4-play-full')?.addEventListener('click', () => {
      playClip(`./${ph.clip_url}`, {
        onProgress: (cur, dur) => paintActiveWaveform(dur > 0 ? cur / dur : 0),
        onEnd: () => paintActiveWaveform(0),
      });
    });
    document.getElementById('btn-e4-stop')?.addEventListener('click', () => { stopAudio(); paintActiveWaveform(0); });
    document.querySelectorAll<HTMLElement>('[data-e4-syl]').forEach((b) => {
      b.onclick = () => {
        const sylId = b.dataset.e4Syl!;
        const tok = ph.tokens.find((t) => t.syl_id === sylId);
        if (tok) playClip(`./${ph.clip_url}`, { startMs: tok.start_ms, endMs: tok.end_ms });
        if (state.e4Tool === 'listen' || vote.l2_locked) return;
        vote.no_prominent_word = false;
        if (state.e4Tool === 'clear') delete vote.l2_labels[sylId];
        else vote.l2_labels[sylId] = state.e4Tool as L2Prominence;
        saveE4StressVotes(state.e4Votes);
        render(true);
      };
    });
    document.getElementById('chk-e4-noprom')?.addEventListener('change', (ev) => {
      const checked = (ev.target as HTMLInputElement).checked;
      vote.no_prominent_word = checked;
      if (checked) vote.l2_labels = {};
      saveE4StressVotes(state.e4Votes);
      render(true);
    });
    document.getElementById('btn-e4-lock')?.addEventListener('click', () => {
      stopAudio();
      vote.l2_locked = true;
      vote.l2_locked_at = new Date().toISOString();
      vote.l2_duration_sec = Math.round(((Date.now() - state.e4StartTs) / 1000) * 10) / 10;
      saveE4StressVotes(state.e4Votes);
      const nextU = state.ecoPhrases.findIndex((p, i) => i > state.e4PhraseIdx && !state.e4Votes[e4VoteKey(p.phrase_id)]?.l2_locked);
      if (nextU >= 0) state.e4PhraseIdx = nextU;
      else if (state.e4PhraseIdx < state.ecoPhrases.length - 1) state.e4PhraseIdx++;
      state.e4StartTs = Date.now();
      showToast('已锁定 L2 盲票，进入下一条');
      render(false);
    });
    document.getElementById('btn-e4-unlock')?.addEventListener('click', () => {
      vote.l2_locked = false;
      saveE4StressVotes(state.e4Votes);
      render(true);
    });
    document.querySelectorAll<HTMLElement>('[data-e4-l3-syl]').forEach((b) => {
      b.onclick = () => {
        state.e4SelectedSyl = b.dataset.e4L3Syl!;
        const tok = ph.tokens.find((t) => t.syl_id === state.e4SelectedSyl);
        if (tok) playClip(`./${ph.clip_url}`, { startMs: tok.start_ms, endMs: tok.end_ms });
        render(true);
      };
    });
    document.getElementById('btn-e4-play-syl')?.addEventListener('click', () => {
      const syl = state.e4SelectedSyl || ph.tokens[0]?.syl_id;
      const tok = ph.tokens.find((t) => t.syl_id === syl);
      if (tok) playClip(`./${ph.clip_url}`, { startMs: tok.start_ms, endMs: tok.end_ms });
    });
    document.querySelectorAll<HTMLElement>('[data-e4-l3-type]').forEach((b) => {
      b.onclick = () => {
        const syl = state.e4SelectedSyl || ph.tokens[0]?.syl_id;
        if (!syl) return;
        const prev = vote.l3_labels[syl] || { stress_type: 'neutral' as L3StressType, breathy_flag: false };
        vote.l3_labels[syl] = { ...prev, stress_type: b.dataset.e4L3Type as L3StressType };
        saveE4StressVotes(state.e4Votes);
        render(true);
      };
    });
    document.getElementById('chk-e4-breathy')?.addEventListener('change', (ev) => {
      const syl = state.e4SelectedSyl || ph.tokens[0]?.syl_id;
      if (!syl) return;
      const prev = vote.l3_labels[syl] || { stress_type: 'neutral' as L3StressType, breathy_flag: false };
      vote.l3_labels[syl] = { ...prev, breathy_flag: (ev.target as HTMLInputElement).checked };
      saveE4StressVotes(state.e4Votes);
      render(true);
    });
    document.getElementById('btn-e4-save-l3')?.addEventListener('click', () => {
      stopAudio();
      vote.l3_saved = true;
      vote.l3_saved_at = new Date().toISOString();
      saveE4StressVotes(state.e4Votes);
      if (state.e4PhraseIdx < state.ecoPhrases.length - 1) state.e4PhraseIdx++;
      state.e4SelectedSyl = '';
      showToast('已保存 L3，进入下一条');
      render(false);
    });
    document.getElementById('btn-e4-prev')?.addEventListener('click', () => { stopAudio(); state.e4PhraseIdx = Math.max(0, state.e4PhraseIdx - 1); state.e4SelectedSyl = ''; state.e4StartTs = Date.now(); render(false); });
    document.getElementById('btn-e4-next')?.addEventListener('click', () => { stopAudio(); state.e4PhraseIdx = Math.min(state.ecoPhrases.length - 1, state.e4PhraseIdx + 1); state.e4SelectedSyl = ''; state.e4StartTs = Date.now(); render(false); });
  }

  // ---------- E5 Boundary ----------
  if (state.tab === 'e5_boundary') {
    const ph = state.ecoPhrases[state.e5PhraseIdx];
    const vote = getOrInitE5Vote(ph);
    const jKey = String(state.e5SelectedJunc);

    document.querySelectorAll<HTMLElement>('[data-e5-layer]').forEach((b) => {
      b.onclick = () => { state.e5Layer = b.dataset.e5Layer as 'L2' | 'L3'; render(true); };
    });
    document.getElementById('btn-e5-play-full')?.addEventListener('click', () => {
      playClip(`./${ph.clip_url}`, {
        onProgress: (cur, dur) => paintActiveWaveform(dur > 0 ? cur / dur : 0),
        onEnd: () => paintActiveWaveform(0),
      });
    });
    document.getElementById('btn-e5-play-junc')?.addEventListener('click', () => {
      const lt = ph.tokens[state.e5SelectedJunc];
      const rt = ph.tokens[state.e5SelectedJunc + 1];
      if (lt && rt) playClip(`./${ph.clip_url}`, { startMs: Math.max(0, lt.start_ms - 180), endMs: rt.end_ms + 220 });
    });
    document.getElementById('btn-e5-stop')?.addEventListener('click', () => { stopAudio(); paintActiveWaveform(0); });
    document.querySelectorAll<HTMLElement>('[data-e5-junc]').forEach((b) => {
      b.onclick = () => {
        state.e5SelectedJunc = parseInt(b.dataset.e5Junc || '0', 10);
        const lt = ph.tokens[state.e5SelectedJunc];
        const rt = ph.tokens[state.e5SelectedJunc + 1];
        if (lt && rt) playClip(`./${ph.clip_url}`, { startMs: Math.max(0, lt.start_ms - 150), endMs: rt.end_ms + 180 });
        render(true);
      };
    });
    document.querySelectorAll<HTMLElement>('[data-e5-l2-lv]').forEach((b) => {
      b.onclick = () => {
        if (vote.l2_locked) return;
        const prev = vote.l2_junctions[jKey] || { level: 'none', sense: 'uncertain', audible_gap: false };
        vote.l2_junctions[jKey] = { ...prev, level: b.dataset.e5L2Lv as L2GroupLevel };
        saveE5BoundaryVotes(state.e5Votes);
        render(true);
      };
    });
    document.querySelectorAll<HTMLElement>('[data-e5-l2-sense]').forEach((b) => {
      b.onclick = () => {
        if (vote.l2_locked) return;
        const prev = vote.l2_junctions[jKey] || { level: 'none', sense: 'uncertain', audible_gap: false };
        vote.l2_junctions[jKey] = { ...prev, sense: b.dataset.e5L2Sense as L2SenseType };
        saveE5BoundaryVotes(state.e5Votes);
        render(true);
      };
    });
    document.getElementById('chk-e5-gap')?.addEventListener('change', (ev) => {
      if (vote.l2_locked) return;
      const prev = vote.l2_junctions[jKey] || { level: 'none', sense: 'uncertain', audible_gap: false };
      vote.l2_junctions[jKey] = { ...prev, audible_gap: (ev.target as HTMLInputElement).checked };
      saveE5BoundaryVotes(state.e5Votes);
    });
    document.querySelectorAll<HTMLElement>('[data-e5-l3-method]').forEach((b) => {
      b.onclick = () => {
        vote.l3_junctions[jKey] = b.dataset.e5L3Method as L3BreakMethod;
        saveE5BoundaryVotes(state.e5Votes);
        render(true);
      };
    });
    document.getElementById('btn-e5-lock')?.addEventListener('click', () => {
      stopAudio();
      vote.l2_locked = true;
      vote.l2_locked_at = new Date().toISOString();
      vote.l2_duration_sec = Math.round(((Date.now() - state.e5StartTs) / 1000) * 10) / 10;
      saveE5BoundaryVotes(state.e5Votes);
      const nextU = state.ecoPhrases.findIndex((p, i) => i > state.e5PhraseIdx && !state.e5Votes[e5VoteKey(p.phrase_id)]?.l2_locked);
      if (nextU >= 0) state.e5PhraseIdx = nextU;
      else if (state.e5PhraseIdx < state.ecoPhrases.length - 1) state.e5PhraseIdx++;
      state.e5SelectedJunc = 0;
      state.e5StartTs = Date.now();
      showToast('已锁定停连票，进入下一条');
      render(false);
    });
    document.getElementById('btn-e5-unlock')?.addEventListener('click', () => { vote.l2_locked = false; saveE5BoundaryVotes(state.e5Votes); render(true); });
    document.getElementById('btn-e5-save-l3')?.addEventListener('click', () => {
      stopAudio();
      vote.l3_saved = true;
      vote.l3_saved_at = new Date().toISOString();
      saveE5BoundaryVotes(state.e5Votes);
      if (state.e5PhraseIdx < state.ecoPhrases.length - 1) state.e5PhraseIdx++;
      state.e5SelectedJunc = 0;
      showToast('已保存 L3 四法，进入下一条');
      render(false);
    });
    document.getElementById('btn-e5-prev')?.addEventListener('click', () => { stopAudio(); state.e5PhraseIdx = Math.max(0, state.e5PhraseIdx - 1); state.e5SelectedJunc = 0; state.e5StartTs = Date.now(); render(false); });
    document.getElementById('btn-e5-next')?.addEventListener('click', () => { stopAudio(); state.e5PhraseIdx = Math.min(state.ecoPhrases.length - 1, state.e5PhraseIdx + 1); state.e5SelectedJunc = 0; state.e5StartTs = Date.now(); render(false); });
  }

  // ---------- E7 Human Trial ----------
  if (state.tab === 'e7_trial') {
    const item = state.e7Items[state.e7Idx];
    const rec = getOrInitE7Record(item);

    document.querySelectorAll<HTMLElement>('[data-e7-mode]').forEach((b) => {
      b.onclick = () => { flushE7Timer(); state.e7Mode = b.dataset.e7Mode as 'proofread' | 'audit'; touchE7Activity(); render(true); };
    });
    document.querySelectorAll<HTMLElement>('[data-e7-tool]').forEach((b) => {
      b.onclick = () => { state.e7Tool = b.dataset.e7Tool as any; touchE7Activity(); render(true); };
    });
    document.getElementById('btn-e7-play')?.addEventListener('click', () => {
      touchE7Activity();
      playClip(`./${item.clip_url}`, {
        onProgress: (cur, dur) => paintActiveWaveform(dur > 0 ? cur / dur : 0),
        onEnd: () => paintActiveWaveform(0),
      });
    });
    document.getElementById('btn-e7-stop')?.addEventListener('click', () => { stopAudio(); paintActiveWaveform(0); });
    document.querySelectorAll<HTMLElement>('[data-e7-idx]').forEach((b) => {
      b.onclick = () => {
        touchE7Activity();
        const i = parseInt(b.dataset.e7Idx || '0', 10);
        const tok = item.tokens[i];
        if (tok) playClip(`./${item.clip_url}`, { startMs: tok.start_ms, endMs: tok.end_ms });
        if (state.e7Tool === 'listen') return;
        const k = String(i);
        const hadDraftP = Boolean(item.machine_draft.prominence[k]);
        const isAbst = item.machine_draft.abstain_indices.includes(i);
        rec.edits_count++;
        if (state.e7Tool === 'P2' || state.e7Tool === 'P1') {
          if (!hadDraftP) rec.missed_additions++;
          if (isAbst) rec.abstain_fills++;
          rec.final_prominence[k] = state.e7Tool;
        } else if (state.e7Tool === 'clear_p') {
          if (hadDraftP) rec.false_positive_deletes++;
          delete rec.final_prominence[k];
        } else if (state.e7Tool === 'minor_b') { rec.final_breaks[k] = 'minor'; }
        else if (state.e7Tool === 'major_b') { rec.final_breaks[k] = 'major'; }
        else if (state.e7Tool === 'clear_b') { delete rec.final_breaks[k]; }
        saveE7TrialRecords(state.e7Records);
        render(true);
      };
    });
    document.getElementById('btn-e7-complete')?.addEventListener('click', () => {
      stopAudio();
      rec.active_elapsed_ms = state.e7ActiveMs;
      rec.paused_idle_ms = state.e7IdleMs;
      rec.completed = true;
      rec.completed_at = new Date().toISOString();
      saveE7TrialRecords(state.e7Records);
      const nextU = state.e7Items.findIndex((it, i) => i > state.e7Idx && !state.e7Records[e7RecKey(it.trial_id)]?.completed);
      if (nextU >= 0) state.e7Idx = nextU;
      else if (state.e7Idx < state.e7Items.length - 1) state.e7Idx++;
      const nextRec = getOrInitE7Record(state.e7Items[state.e7Idx]);
      state.e7ActiveMs = nextRec.active_elapsed_ms;
      state.e7IdleMs = nextRec.paused_idle_ms;
      state.e7LastActTs = Date.now();
      showToast(`已完结，进入下一题`);
      render(false);
    });
    document.getElementById('btn-e7-save-audit')?.addEventListener('click', () => {
      stopAudio();
      const crit = parseInt((document.getElementById('inp-e7-crit') as HTMLInputElement)?.value || '0', 10);
      const minor = parseInt((document.getElementById('inp-e7-minor') as HTMLInputElement)?.value || '0', 10);
      const note = (document.getElementById('inp-e7-note') as HTMLInputElement)?.value || '';
      rec.audit_completed = true;
      rec.auditor_id = state.profile.rater_id;
      rec.audit_critical_errors = Math.max(0, crit);
      rec.audit_minor_errors = Math.max(0, minor);
      rec.audit_note = note;
      rec.audited_at = new Date().toISOString();
      saveE7TrialRecords(state.e7Records);
      if (state.e7Idx < state.e7Items.length - 1) state.e7Idx++;
      showToast('盲审已保存，进入下一题');
      render(false);
    });
    document.getElementById('btn-e7-prev')?.addEventListener('click', () => {
      stopAudio();
      flushE7Timer();
      state.e7Idx = Math.max(0, state.e7Idx - 1);
      const r = getOrInitE7Record(state.e7Items[state.e7Idx]);
      state.e7ActiveMs = r.active_elapsed_ms;
      state.e7IdleMs = r.paused_idle_ms;
      state.e7LastActTs = Date.now();
      render(false);
    });
    document.getElementById('btn-e7-next')?.addEventListener('click', () => {
      stopAudio();
      flushE7Timer();
      state.e7Idx = Math.min(state.e7Items.length - 1, state.e7Idx + 1);
      const r = getOrInitE7Record(state.e7Items[state.e7Idx]);
      state.e7ActiveMs = r.active_elapsed_ms;
      state.e7IdleMs = r.paused_idle_ms;
      state.e7LastActTs = Date.now();
      render(false);
    });
  }

  // ---------- Export ----------
  if (state.tab === 'export') {
    document.querySelectorAll<HTMLElement>('[data-exp-prev]').forEach((b) => {
      b.onclick = () => { state.exportPreviewKey = b.dataset.expPrev as any; render(true); };
    });
    document.getElementById('btn-exp-master')?.addEventListener('click', async () => {
      try {
        const path = await exportMasterBundle({
          e2Items: state.e2Items, e2Votes: state.e2Votes, phrases: state.ecoPhrases,
          e4Votes: state.e4Votes, e5Votes: state.e5Votes, e7Records: state.e7Records,
          takes: state.takes, profile: state.profile, share: true,
        });
        showToast(`已导出总包：${path}`);
      } catch (e: any) { showToast(`导出失败: ${e?.message || e}`); }
    });
    document.getElementById('btn-exp-e2')?.addEventListener('click', async () => {
      const p = await exportFile('e2_f0_reviewed.json', 'application/json', JSON.stringify(buildE2F0Export(state.e2Items, state.e2Votes), null, 2), true);
      showToast(`已导出：${p}`);
    });
    document.getElementById('btn-exp-e4rec')?.addEventListener('click', async () => { showToast(`已导出：${await exportControlledZip('expA', state.takes, true)}`); });
    document.getElementById('btn-exp-e4s')?.addEventListener('click', async () => {
      const p = await exportFile('e4_expA_votes.json', 'application/json', JSON.stringify(buildE4StressExport(state.ecoPhrases, state.e4Votes), null, 2), true);
      showToast(`已导出：${p}`);
    });
    document.getElementById('btn-exp-e5rec')?.addEventListener('click', async () => { showToast(`已导出：${await exportControlledZip('expB', state.takes, true)}`); });
    document.getElementById('btn-exp-e5b')?.addEventListener('click', async () => {
      const p = await exportFile('e5_expB_boundary_votes.json', 'application/json', JSON.stringify(buildE5BoundaryExport(state.ecoPhrases, state.e5Votes), null, 2), true);
      showToast(`已导出：${p}`);
    });
    document.getElementById('btn-exp-e7')?.addEventListener('click', async () => {
      const p = await exportFile('e7_human_trial_export.json', 'application/json', JSON.stringify(buildE7TrialExport(state.e7Records), null, 2), true);
      showToast(`已导出：${p}`);
    });
  }

  // ---------- Update ----------
  if (state.tab === 'update') {
    const inpMirror = document.getElementById('inp-mirror') as HTMLInputElement | null;
    if (inpMirror) {
      inpMirror.onchange = () => { state.profile.update_mirror = inpMirror.value.trim(); saveProfile(state.profile); };
    }
    document.getElementById('btn-check-update')?.addEventListener('click', async () => {
      state.checkingUpdate = true;
      state.updateError = '';
      render(true);
      try {
        state.latestRelease = await checkLatestRelease(state.profile.update_mirror);
        showToast(`检查完成：最新 ${state.latestRelease.tag_name}`);
      } catch (err: any) {
        state.updateError = err?.message || '检查更新失败，请检查网络';
      } finally {
        state.checkingUpdate = false;
        render(true);
      }
    });
    document.getElementById('btn-install-apk')?.addEventListener('click', async () => {
      const rel = state.latestRelease;
      if (!rel?.apk_url) return;
      if (isNativeAndroid()) {
        try {
          state.downloadProgress = 1;
          state.downloadStatus = '正在下载安装包…';
          render(true);
          await attachDownloadProgressListener((info) => {
            state.downloadProgress = info.progress;
            state.downloadStatus = info.status;
            render(true);
          });
          await AppUpdaterPlugin.downloadAndInstallApk({ url: rel.apk_url, fileName: rel.apk_name });
        } catch (err: any) {
          state.downloadProgress = -1;
          state.updateError = err?.message || '下载安装失败';
          render(true);
        }
      } else {
        window.open(rel.apk_url, '_blank');
      }
    });
  }
}

initApp();
