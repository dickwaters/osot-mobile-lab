export const APP_VERSION = '1.0.0';
export const APP_VERSION_CODE = 10000;
export const GITHUB_REPO = 'dickwaters/osot-mobile-lab';

export type TabId = 'home' | 'e2_f0' | 'e4_rec' | 'e4_stress' | 'e5_rec' | 'e5_boundary' | 'e7_trial' | 'export' | 'update';

export interface RaterProfile {
  rater_id: string;
  role: 'rater_A' | 'rater_B' | 'teacher_L3' | 'auditor';
  speaker_id: string;
  session_id: string;
  update_mirror: string; // '' for direct GitHub, or e.g. 'https://ghfast.top/'
}

// ---------- E2 F0 Stratified Check ----------
export interface E2F0Item {
  item_id: string;
  audio_id: string;
  frame_index: number;
  time_ms: number;
  f0_hz: number;
  char: string;
  speaker_id: string;
  pitch_register: 'high' | 'mid' | 'low';
  voicing: string;
  voice_difficulty: string;
  work_id: string;
  audition_clip_start_ms: number;
  audition_clip_end_ms: number;
  clip_url: string;
  clip_offset_ms: number;
  clip_duration_ms: number;
  waveform: number[];
}

export type E2F0Verdict = 'correct' | 'octave_half' | 'octave_double' | 'unvoiced_false_pos' | 'abstained';

export interface E2F0Vote {
  item_id: string;
  verdict: E2F0Verdict;
  note: string;
  rater_id: string;
  reviewed_at: string;
}

// ---------- Ecological Phrases (shared by E4 Stress & E5 Boundary) ----------
export interface PhraseToken {
  syl_id: string;
  idx: number;
  orig_idx: number;
  char: string;
  punct: string;
  start_ms: number;
  end_ms: number;
}

export interface EcoPhrase {
  phrase_id: string;
  audio_id: string;
  title: string;
  speaker_id: string;
  work_family_id: string;
  demucs_applied: boolean;
  slice_start_ms: number;
  slice_end_ms: number;
  duration_ms: number;
  clip_url: string;
  text: string;
  waveform: number[];
  tokens: PhraseToken[];
}

// ---------- E4 Exp A Controlled Recording ----------
export interface ExpACondition {
  condition_id: 'neutral' | 'strong_stress' | 'soft_stress' | 'ordinary_weak';
  label_cn: string;
  instruction: string;
}

export interface ExpASentence {
  text_id: string;
  text: string;
  focus_span: string;
  weak_span: string;
}

export interface ExpAControlledPack {
  experiment: string;
  version: string;
  design: string;
  conditions: ExpACondition[];
  sentences: ExpASentence[];
}

// ---------- E5 Exp B Controlled Recording ----------
export interface ExpBTreatment {
  treatment_id: 'direct_link' | 'curved_link' | 'rising_pause' | 'falling_pause';
  label_cn: string;
  instruction: string;
}

export interface ExpBSentence {
  text_id: string;
  text: string;
  target_junction_after: string;
  trap_type: string;
  trap_note?: string;
}

export interface ExpBControlledPack {
  experiment: string;
  version: string;
  design: string;
  treatments: ExpBTreatment[];
  sentences: ExpBSentence[];
}

export interface RecordedTake {
  take_key: string; // e.g. expA::spk_water::expA_s01::soft_stress
  experiment: 'expA' | 'expB';
  speaker_id: string;
  session_id: string;
  text_id: string;
  condition_id: string;
  filename: string;
  duration_ms: number;
  peak_db: number;
  clipped: boolean;
  demucs_applied: false; // Hard redline: dry recordings NEVER pass Demucs
  recorded_at: string;
  wav_base64: string; // 16kHz 16-bit mono PCM WAV
}

// ---------- E4 Exp A Stress L2 / L3 Votes ----------
export type L2Prominence = 'none' | 'P1' | 'P2' | 'abstained';
export type L3StressType =
  | 'strong_stress'
  | 'soft_stress'
  | 'ordinary_weak'
  | 'neutral'
  | 'no_explicit_technique'
  | 'undecidable'
  | 'insufficient_evidence'
  | 'N/A';

export interface E4StressVote {
  phrase_id: string;
  audio_id: string;
  rater_id: string;
  // L2 Blind
  l2_locked: boolean;
  l2_locked_at?: string;
  l2_duration_sec: number;
  no_prominent_word: boolean;
  l2_labels: Record<string, L2Prominence>; // syl_id -> P2/P1/none/abstained
  // L3 Teacher (independent, strictly separated from L2)
  l3_saved: boolean;
  l3_saved_at?: string;
  l3_labels: Record<string, { stress_type: L3StressType; breathy_flag: boolean }>;
}

// ---------- E5 Exp B Full-Junction Boundary L2 / L3 Votes ----------
export type L2GroupLevel = 'none' | 'minor_group' | 'major_group' | 'abstained';
export type L2SenseType = 'continuation' | 'closure' | 'uncertain';
export type L3BreakMethod =
  | 'direct_link'
  | 'curved_link'
  | 'rising_pause'
  | 'falling_pause'
  | 'no_technique'
  | 'hard_to_decide';

export interface JunctionL2 {
  level: L2GroupLevel;
  sense: L2SenseType;
  audible_gap: boolean;
}

export interface E5BoundaryVote {
  phrase_id: string;
  audio_id: string;
  rater_id: string;
  l2_locked: boolean;
  l2_locked_at?: string;
  l2_duration_sec: number;
  l2_junctions: Record<string, JunctionL2>; // junction idx "0", "1"... after token[idx]
  l3_saved: boolean;
  l3_saved_at?: string;
  l3_junctions: Record<string, L3BreakMethod>;
}

// ---------- E7 Human Proofreading Trial & Blind Audit ----------
export interface E7TrialItem {
  trial_id: string;
  phrase_id: string;
  audio_id: string;
  title: string;
  arm_masked: string;
  task_type: string;
  idle_pause_threshold_sec: number;
  clip_url: string;
  duration_ms: number;
  text: string;
  waveform: number[];
  tokens: PhraseToken[];
  machine_draft: {
    prominence: Record<string, 'P1' | 'P2'>;
    breaks: Record<string, 'minor' | 'major'>;
    abstain_indices: number[];
  };
}

export interface E7TrialRecord {
  trial_id: string;
  phrase_id: string;
  audio_id: string;
  arm_masked: string;
  rater_id: string;
  active_elapsed_ms: number;
  paused_idle_ms: number;
  edits_count: number;
  false_positive_deletes: number;
  missed_additions: number;
  abstain_fills: number;
  final_prominence: Record<string, 'P1' | 'P2'>;
  final_breaks: Record<string, 'minor' | 'major'>;
  completed: boolean;
  completed_at?: string;
  // Blind Auditor section
  audit_completed?: boolean;
  auditor_id?: string;
  audit_critical_errors?: number;
  audit_minor_errors?: number;
  audit_note?: string;
  audited_at?: string;
}

export interface ReleaseInfo {
  tag_name: string;
  version_name: string;
  version_code: number;
  body: string;
  published_at: string;
  apk_url: string;
  apk_name: string;
  apk_size: number;
}
