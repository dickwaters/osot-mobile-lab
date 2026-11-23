import JSZip from 'jszip';
import { APP_VERSION, GITHUB_REPO } from './types';
import type {
  E2F0Item,
  E2F0Vote,
  E4StressVote,
  E5BoundaryVote,
  E7TrialRecord,
  EcoPhrase,
  RaterProfile,
  RecordedTake,
  ReleaseInfo,
} from './types';
import { base64ToUint8, exportFile } from './bridge';

// ---------- 1. E2 F0 Stratified Check -> e2_f0_reviewed.json ----------
// Directly accepted by D:\otos\osot-annotator\scripts\run_e2_f0_stratified_check.py
export function buildE2F0Export(items: E2F0Item[], votes: Record<string, E2F0Vote>) {
  const out = [];
  for (const it of items) {
    const v = votes[it.item_id];
    if (!v) continue;
    const isAbstained = v.verdict === 'abstained';
    const isUnvoiced = v.verdict === 'unvoiced_false_pos';
    const isOctave = v.verdict === 'octave_half' || v.verdict === 'octave_double';
    out.push({
      audio_id: it.audio_id,
      frame_index: it.frame_index,
      time_ms: it.time_ms,
      f0_hz: it.f0_hz,
      char: it.char,
      speaker_id: it.speaker_id,
      pitch_register: it.pitch_register,
      voicing: it.voicing,
      voice_difficulty: it.voice_difficulty,
      work_id: it.work_id,
      human_status: isAbstained ? 'abstained' : 'reviewed',
      is_voiced_gt: !isUnvoiced,
      octave_error: isOctave,
      voicing_error: isUnvoiced,
      verdict: v.verdict,
      note: v.note,
      rater_id: v.rater_id,
      reviewed_at: v.reviewed_at,
    });
  }
  return out;
}

// ---------- 2. E4 Exp A Stress Votes -> e4_expA_votes.json ----------
// Follows E3/E4 per_vote_records schema with strict L2/L3 separation & loss_mask
export function buildE4StressExport(phrases: EcoPhrase[], votes: Record<string, E4StressVote>) {
  const phraseMap = new Map(phrases.map((p) => [p.phrase_id, p]));
  const perVoteRecords: any[] = [];
  const l3Records: any[] = [];

  for (const v of Object.values(votes)) {
    const ph = phraseMap.get(v.phrase_id);
    if (!ph) continue;
    if (v.l2_locked) {
      const perInstance: Record<string, any> = {};
      const scope: string[] = [];
      for (const tok of ph.tokens) {
        scope.push(tok.syl_id);
        const lbl = v.l2_labels[tok.syl_id] || 'none';
        if (lbl === 'abstained') {
          perInstance[tok.syl_id] = { label: 'abstained', judgment_status: 'abstained', loss_mask: 0 };
        } else if (lbl === 'P1' || lbl === 'P2') {
          perInstance[tok.syl_id] = { label: lbl, judgment_status: 'human_positive', loss_mask: 1 };
        } else {
          perInstance[tok.syl_id] = { label: 'none', judgment_status: 'human_negative', loss_mask: 1 };
        }
      }
      perVoteRecords.push({
        record_type: 'l2_blind_vote',
        phrase_id: v.phrase_id,
        audio_id: v.audio_id,
        rater_id: v.rater_id,
        layer: 'L2',
        blind_status: 'blind_no_hints',
        locked_at: v.l2_locked_at,
        duration_sec: v.l2_duration_sec,
        listening_scope: scope,
        no_prominent_word: v.no_prominent_word,
        per_instance_status: perInstance,
        grouping_junctions: {},
      });
    }
    if (v.l3_saved) {
      l3Records.push({
        record_type: 'l3_teacher_stress_vote',
        phrase_id: v.phrase_id,
        audio_id: v.audio_id,
        rater_id: v.rater_id,
        layer: 'L3',
        saved_at: v.l3_saved_at,
        labels: v.l3_labels,
      });
    }
  }

  return {
    schema_version: 'osot-mobile-e4-v1.0',
    compatible_with: 'osot-unified-v3.0 / scripts/run_expA_stress_eval.py',
    exported_at: new Date().toISOString(),
    app_version: APP_VERSION,
    l2_per_vote_records: perVoteRecords,
    l3_teacher_records: l3Records,
  };
}

// ---------- 3. E5 Exp B Boundary Votes -> e5_expB_boundary_votes.json ----------
export function buildE5BoundaryExport(phrases: EcoPhrase[], votes: Record<string, E5BoundaryVote>) {
  const phraseMap = new Map(phrases.map((p) => [p.phrase_id, p]));
  const l2Records: any[] = [];
  const l3Records: any[] = [];

  for (const v of Object.values(votes)) {
    const ph = phraseMap.get(v.phrase_id);
    if (!ph) continue;
    if (v.l2_locked) {
      const junctions: Record<string, any> = {};
      // Enumerate ALL adjacent junctions 0 .. tokens.length - 2
      for (let i = 0; i < ph.tokens.length - 1; i++) {
        const key = String(i);
        const j = v.l2_junctions[key] || { level: 'none', sense: 'uncertain', audible_gap: false };
        const leftTok = ph.tokens[i];
        const rightTok = ph.tokens[i + 1];
        junctions[`${leftTok.syl_id}__to__${rightTok.syl_id}`] = {
          junction_index: i,
          left_char: leftTok.char,
          right_char: rightTok.char,
          has_punct: Boolean(leftTok.punct),
          level: j.level,
          sense: j.sense,
          audible_gap: j.audible_gap,
          loss_mask: j.level === 'abstained' ? 0 : 1,
        };
      }
      l2Records.push({
        record_type: 'e5_l2_all_junction_vote',
        phrase_id: v.phrase_id,
        audio_id: v.audio_id,
        rater_id: v.rater_id,
        layer: 'L2',
        blind_status: 'blind_all_junctions',
        locked_at: v.l2_locked_at,
        duration_sec: v.l2_duration_sec,
        total_junctions: Math.max(0, ph.tokens.length - 1),
        junctions,
      });
    }
    if (v.l3_saved) {
      l3Records.push({
        record_type: 'e5_l3_four_methods_vote',
        phrase_id: v.phrase_id,
        audio_id: v.audio_id,
        rater_id: v.rater_id,
        layer: 'L3',
        saved_at: v.l3_saved_at,
        junction_methods: v.l3_junctions,
      });
    }
  }

  return {
    schema_version: 'osot-mobile-e5-v1.0',
    compatible_with: 'scripts/run_expB_boundary_eval.py',
    exported_at: new Date().toISOString(),
    app_version: APP_VERSION,
    l2_grouping_records: l2Records,
    l3_four_methods_records: l3Records,
  };
}

// ---------- 4. E7 Human Proofreading & Blind Audit -> e7_human_trial_export.json ----------
export function buildE7TrialExport(records: Record<string, E7TrialRecord>) {
  return {
    schema_version: 'osot-mobile-e7-v1.0',
    compatible_with: 'e7_release_flywheel.py / e7_human_trial_report.json',
    exported_at: new Date().toISOString(),
    app_version: APP_VERSION,
    preregistered_gate: {
      max_critical_error_delta: 0,
      idle_pause_sec: 60,
    },
    sessions: Object.values(records),
  };
}

// ---------- 5. Controlled Dry Audio ZIP (Exp A or Exp B) ----------
export async function exportControlledZip(
  experiment: 'expA' | 'expB',
  takes: RecordedTake[],
  share = true
): Promise<string> {
  const filtered = takes.filter((t) => t.experiment === experiment);
  const zip = new JSZip();
  const manifestEntries = [];
  for (const t of filtered) {
    const wavBytes = base64ToUint8(t.wav_base64);
    zip.file(`audio/${t.filename}`, wavBytes);
    manifestEntries.push({
      take_key: t.take_key,
      experiment: t.experiment,
      speaker_id: t.speaker_id,
      session_id: t.session_id,
      text_id: t.text_id,
      condition_id: t.condition_id,
      audio_relpath: `audio/${t.filename}`,
      duration_ms: t.duration_ms,
      peak_db: t.peak_db,
      clipped: t.clipped,
      demucs_applied: false,
      recorded_at: t.recorded_at,
    });
  }
  const manifest = {
    schema_version: `osot-mobile-${experiment}-controlled-v1.0`,
    experiment,
    demucs_policy: 'STRICTLY_DRY_CLEAN_NO_DEMUCS',
    exported_at: new Date().toISOString(),
    count: manifestEntries.length,
    entries: manifestEntries,
  };
  zip.file(`${experiment}_controlled_manifest.json`, JSON.stringify(manifest, null, 2));
  const zipBytes = await zip.generateAsync({ type: 'uint8array' });
  const ts = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  return await exportFile(`osot_${experiment}_dry_audio_${ts}.zip`, 'application/zip', zipBytes, share);
}

// ---------- 6. Master All-in-One ZIP Export (All JSONs + All Dry WAVs) ----------
export async function exportMasterBundle(params: {
  e2Items: E2F0Item[];
  e2Votes: Record<string, E2F0Vote>;
  phrases: EcoPhrase[];
  e4Votes: Record<string, E4StressVote>;
  e5Votes: Record<string, E5BoundaryVote>;
  e7Records: Record<string, E7TrialRecord>;
  takes: RecordedTake[];
  profile: RaterProfile;
  share?: boolean;
}): Promise<string> {
  const zip = new JSZip();
  const e2Data = buildE2F0Export(params.e2Items, params.e2Votes);
  const e4Data = buildE4StressExport(params.phrases, params.e4Votes);
  const e5Data = buildE5BoundaryExport(params.phrases, params.e5Votes);
  const e7Data = buildE7TrialExport(params.e7Records);

  zip.file('e2_f0_reviewed.json', JSON.stringify(e2Data, null, 2));
  zip.file('e4_expA_votes.json', JSON.stringify(e4Data, null, 2));
  zip.file('e5_expB_boundary_votes.json', JSON.stringify(e5Data, null, 2));
  zip.file('e7_human_trial_export.json', JSON.stringify(e7Data, null, 2));

  const expATakes = params.takes.filter((t) => t.experiment === 'expA');
  const expBTakes = params.takes.filter((t) => t.experiment === 'expB');

  for (const t of expATakes) {
    zip.file(`expA_audio/${t.filename}`, base64ToUint8(t.wav_base64));
  }
  for (const t of expBTakes) {
    zip.file(`expB_audio/${t.filename}`, base64ToUint8(t.wav_base64));
  }
  zip.file(
    'expA_controlled_manifest.json',
    JSON.stringify(
      {
        experiment: 'expA',
        demucs_applied: false,
        entries: expATakes.map(({ wav_base64: _, ...rest }) => rest),
      },
      null,
      2
    )
  );
  zip.file(
    'expB_controlled_manifest.json',
    JSON.stringify(
      {
        experiment: 'expB',
        demucs_applied: false,
        entries: expBTakes.map(({ wav_base64: _, ...rest }) => rest),
      },
      null,
      2
    )
  );

  zip.file(
    'BUNDLE_README.json',
    JSON.stringify(
      {
        bundle_type: 'osot_mobile_master_export',
        app_version: APP_VERSION,
        rater_id: params.profile.rater_id,
        speaker_id: params.profile.speaker_id,
        exported_at: new Date().toISOString(),
        counts: {
          e2_f0_reviewed: e2Data.length,
          e4_l2_votes: e4Data.l2_per_vote_records.length,
          e4_l3_votes: e4Data.l3_teacher_records.length,
          e5_l2_votes: e5Data.l2_grouping_records.length,
          e5_l3_votes: e5Data.l3_four_methods_records.length,
          e7_sessions: e7Data.sessions.length,
          expA_dry_wavs: expATakes.length,
          expB_dry_wavs: expBTakes.length,
        },
        pc_import_command: 'python scripts/import_mobile_pack.py <this_zip_file>',
      },
      null,
      2
    )
  );

  const zipBytes = await zip.generateAsync({ type: 'uint8array' });
  const ts = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  return await exportFile(
    `osot_mobile_export_${params.profile.rater_id}_${ts}.zip`,
    'application/zip',
    zipBytes,
    params.share ?? true
  );
}

// ---------- 7. Real-Time GitHub Release Update Checker ----------
export function parseVersionCode(tag: string): number {
  const m = tag.replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return 0;
  return parseInt(m[1], 10) * 10000 + parseInt(m[2], 10) * 100 + parseInt(m[3], 10);
}

export async function checkLatestRelease(mirrorPrefix: string): Promise<ReleaseInfo> {
  const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
  const res = await fetch(apiUrl, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) {
    throw new Error(`GitHub API 请求失败 (HTTP ${res.status})`);
  }
  const data = await res.json();
  const assets = (data.assets || []) as any[];
  const apk = assets.find((a) => String(a.name || '').endsWith('.apk')) || assets[0];
  let rawApkUrl = apk?.browser_download_url || '';
  if (rawApkUrl && mirrorPrefix && mirrorPrefix.trim()) {
    const cleanMirror = mirrorPrefix.trim().endsWith('/') ? mirrorPrefix.trim() : `${mirrorPrefix.trim()}/`;
    rawApkUrl = `${cleanMirror}${rawApkUrl}`;
  }
  const tagName = String(data.tag_name || 'v1.0.0');
  return {
    tag_name: tagName,
    version_name: tagName.replace(/^v/i, ''),
    version_code: parseVersionCode(tagName),
    body: String(data.body || '暂无更新说明'),
    published_at: String(data.published_at || ''),
    apk_url: rawApkUrl,
    apk_name: String(apk?.name || `osot-mobile-lab-${tagName}.apk`),
    apk_size: Number(apk?.size || 0),
  };
}
