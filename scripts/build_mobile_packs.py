#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Build real lightweight audio & task packs from D:\otos\osot-annotator
for the OSOT Mobile Lab Android app.

Generates:
  1. public/packs/e2_f0/manifest.json + 38 x 1s clips (E2 F0 stratified check)
  2. public/packs/eco_phrases/manifest.json + ~18 real ecological phrase clips
     (for E4 Exp A L2/L3 stress, E5 Exp B full-junction boundary, and E7 human trial)
  3. public/packs/expA_controlled.json (12 sentences x 4 conditions from controlled_prompts.json)
  4. public/packs/expB_controlled.json (10 sentences x 4 boundary treatments with tone-4/tone-3 traps)
  5. public/packs/e7_trial.json (Blinded Arm A/B proofreading & blind audit trial pack)
"""
from __future__ import annotations

import json
import math
import subprocess
import sys
import wave
from pathlib import Path
from typing import Any, Dict, List

OSOT_ROOT = Path(r"D:\otos\osot-annotator")
OUT_ROOT = Path(r"D:\otos\osot-mobile-lab\public\packs")


def find_ffmpeg() -> str:
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"


FFMPEG = find_ffmpeg()


def slice_audio_to_mp3(src_wav: Path, start_ms: float, end_ms: float, dst_mp3: Path, bitrate: str = "64k") -> bool:
    dst_mp3.parent.mkdir(parents=True, exist_ok=True)
    dur_s = max(0.2, (end_ms - start_ms) / 1000.0)
    cmd = [
        FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
        "-ss", f"{max(0.0, start_ms / 1000.0):.3f}",
        "-t", f"{dur_s:.3f}",
        "-i", str(src_wav),
        "-ac", "1", "-ar", "16000", "-b:a", bitrate,
        str(dst_mp3),
    ]
    res = subprocess.run(cmd, capture_output=True)
    return res.returncode == 0 and dst_mp3.exists()


def compute_waveform_peaks(src_wav: Path, start_ms: float, end_ms: float, num_points: int = 120) -> List[float]:
    try:
        with wave.open(str(src_wav), "rb") as wf:
            sr = wf.getframerate()
            ch = wf.getnchannels()
            sw = wf.getsampwidth()
            total = wf.getnframes()
            s_frame = max(0, min(total - 1, int(start_ms * sr / 1000.0)))
            e_frame = max(s_frame + 1, min(total, int(end_ms * sr / 1000.0)))
            wf.setpos(s_frame)
            raw = wf.readframes(e_frame - s_frame)
        if sw != 2 or not raw:
            return [0.2] * num_points
        import array
        samples = array.array("h")
        samples.frombytes(raw)
        if ch > 1:
            samples = samples[::ch]
        n = len(samples)
        if n == 0:
            return [0.2] * num_points
        step = max(1, n // num_points)
        peaks = []
        for i in range(num_points):
            seg = samples[i * step : min(n, (i + 1) * step)]
            if not seg:
                peaks.append(0.0)
            else:
                mx = max(abs(min(seg)), abs(max(seg))) / 32768.0
                peaks.append(round(min(1.0, mx), 3))
        return peaks
    except Exception:
        return [0.2] * num_points


def build_e2_f0_pack() -> int:
    pack_path = OSOT_ROOT / "experiments" / "e2_blind_eval" / "e2_f0_stratified_pack.json"
    data = json.loads(pack_path.read_text(encoding="utf-8-sig"))
    out_dir = OUT_ROOT / "e2_f0"
    out_dir.mkdir(parents=True, exist_ok=True)
    items_out = []
    for idx, it in enumerate(data.get("items", [])):
        audio_id = it["audio_id"]
        src_wav = OSOT_ROOT / "data" / "audio" / f"{audio_id}.wav"
        clip_name = f"f0_{idx:02d}_{audio_id}_{it['frame_index']}.mp3"
        s_ms = float(it.get("audition_clip_start_ms", max(0.0, it["time_ms"] - 500.0)))
        e_ms = float(it.get("audition_clip_end_ms", it["time_ms"] + 500.0))
        ok = False
        peaks = []
        if src_wav.exists():
            ok = slice_audio_to_mp3(src_wav, s_ms, e_ms, out_dir / clip_name, bitrate="64k")
            peaks = compute_waveform_peaks(src_wav, s_ms, e_ms, 80)
        entry = dict(it)
        entry["item_id"] = f"e2_f0_{idx:02d}"
        entry["clip_url"] = f"packs/e2_f0/{clip_name}" if ok else ""
        entry["clip_offset_ms"] = round(it["time_ms"] - s_ms, 1)
        entry["clip_duration_ms"] = round(e_ms - s_ms, 1)
        entry["waveform"] = peaks
        items_out.append(entry)
    manifest = {
        "pack_type": "e2_f0_stratified",
        "version": "1.0.0",
        "total_candidate_frames": data.get("total_candidate_frames", 1498),
        "sampled_count": len(items_out),
        "items": items_out,
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return len(items_out)


def build_ecological_phrases() -> List[Dict[str, Any]]:
    """Extract clean complete phrases (10-32 chars, 3-12s) from real master recordings."""
    out_dir = OUT_ROOT / "eco_phrases"
    out_dir.mkdir(parents=True, exist_ok=True)
    target_ids = [
        ("20261122_230114_a029e1", "003_离骚_方明", "spk_fangming", "work_离骚", 5),
        ("20261122_225940_1c9543", "041_滕王阁序_环佩叮当", "spk_huanpeidingdang", "work_滕王阁序", 5),
        ("20261121_231945_53cf4e", "岳阳楼记-徐涛", "spk_xutao", "work_岳阳楼记", 4),
        ("20261120_225306_129529", "将进酒-徐涛", "spk_xutao", "work_将进酒", 3),
        ("20261122_155249_f38d99", "017_兵车行_焦晃", "spk_jiaohuang", "work_兵车行", 3),
    ]
    phrases: List[Dict[str, Any]] = []
    phrase_seq = 0

    for audio_id, title, spk_id, work_id, max_take in target_ids:
        ann_path = OSOT_ROOT / "data" / "annotations" / f"{audio_id}.json"
        wav_path = OSOT_ROOT / "data" / "audio" / f"{audio_id}.wav"
        if not ann_path.exists() or not wav_path.exists():
            continue
        doc = json.loads(ann_path.read_text(encoding="utf-8-sig"))
        tokens = doc.get("tokens") or []
        # Group tokens into phrases by sentence punctuation or >= 500ms gap
        cur: List[Dict[str, Any]] = []
        groups: List[List[Dict[str, Any]]] = []
        for idx, tok in enumerate(tokens):
            t_copy = dict(tok)
            t_copy["_orig_idx"] = idx
            cur.append(t_copy)
            punc = str(tok.get("punct") or tok.get("punc") or "")
            gap = float((tok.get("features") or {}).get("pause_after_ms") or 0.0)
            next_gap = 0.0
            if idx + 1 < len(tokens):
                next_gap = float(tokens[idx + 1].get("start_ms") or 0) - float(tok.get("end_ms") or 0)
            eff_gap = max(gap, next_gap)
            if (any(p in punc for p in "。！？；") and len(cur) >= 6) or (len(cur) >= 10 and (eff_gap >= 350 or any(p in punc for p in "，、"))) or len(cur) >= 22:
                if 6 <= len(cur) <= 28:
                    groups.append(cur)
                cur = []
        if 6 <= len(cur) <= 28:
            groups.append(cur)

        # Pick evenly spaced phrases
        if not groups:
            continue
        step = max(1, len(groups) // max_take)
        selected = groups[::step][:max_take]

        for g in selected:
            s_ms = max(0.0, float(g[0].get("start_ms") or 0) - 200.0)
            e_ms = float(g[-1].get("end_ms") or (s_ms + 3000.0)) + 250.0
            if e_ms - s_ms < 1200 or e_ms - s_ms > 24000:
                continue
            phrase_seq += 1
            pid = f"eco_{phrase_seq:02d}"
            clip_name = f"{pid}_{audio_id}.mp3"
            ok = slice_audio_to_mp3(wav_path, s_ms, e_ms, out_dir / clip_name, bitrate="64k")
            if not ok:
                continue
            peaks = compute_waveform_peaks(wav_path, s_ms, e_ms, 120)
            # Strictly BLIND tokens: NO machine stress/break predictions exposed in L2!
            # Machine suggestions are stored in a separate sealed field ONLY used in E7 blinded trial.
            blind_tokens = []
            machine_hints = []
            for k, t in enumerate(g):
                ts = max(0.0, round(float(t.get("start_ms") or s_ms) - s_ms, 1))
                te = max(ts + 40.0, round(float(t.get("end_ms") or (s_ms + ts + 200.0)) - s_ms, 1))
                orig_idx = t["_orig_idx"]
                syl_id = f"{audio_id}::syl_{orig_idx:04d}"
                blind_tokens.append({
                    "syl_id": syl_id,
                    "idx": k,
                    "orig_idx": orig_idx,
                    "char": str(t.get("char") or ""),
                    "punct": str(t.get("punct") or t.get("punc") or ""),
                    "start_ms": ts,
                    "end_ms": te,
                })
                # Keep machine hints only for E7 trial comparison (never rendered in E4/E5 L2!)
                stress = str(t.get("stress") or "none")
                brk = str(t.get("break_after") or t.get("pause") or "none")
                if stress in ("primary", "secondary") or brk in ("short", "long", "/", "//"):
                    machine_hints.append({"idx": k, "stress": stress, "break": brk})

            phrases.append({
                "phrase_id": pid,
                "audio_id": audio_id,
                "title": title,
                "speaker_id": spk_id,
                "work_family_id": work_id,
                "demucs_applied": bool(doc.get("vocal_separated") or doc.get("demucs_degraded")),
                "slice_start_ms": round(s_ms, 1),
                "slice_end_ms": round(e_ms, 1),
                "duration_ms": round(e_ms - s_ms, 1),
                "clip_url": f"packs/eco_phrases/{clip_name}",
                "text": "".join(t["char"] + t["punct"] for t in blind_tokens),
                "waveform": peaks,
                "tokens": blind_tokens,
                "_sealed_e7_hints": machine_hints,
            })

    manifest = {
        "pack_type": "ecological_phrases",
        "version": "1.0.0",
        "count": len(phrases),
        "blinding_policy": "L2_strict_no_machine_hints",
        "items": phrases,
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return phrases


def build_expA_controlled() -> int:
    src = OSOT_ROOT / "experiments" / "expA" / "controlled_prompts.json"
    data = json.loads(src.read_text(encoding="utf-8-sig"))
    OUT_ROOT.mkdir(parents=True, exist_ok=True)
    (OUT_ROOT / "expA_controlled.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return len(data.get("sentences", []))


def build_expB_controlled() -> int:
    """E5 Exp B: 10 sentences x 4 boundary treatments (direct/curved/rising/falling), including Tone-4 & Tone-3 sandhi traps."""
    data = {
        "experiment": "OSOT_Phase2_Step4_ExpB_Controlled_Boundary_Prompts",
        "version": "expB-prompts-v1.0",
        "design": "4 speakers x 10 sentences x 4 treatments = 160 utterances (dry clean only, demucs_applied=false)",
        "treatments": [
            {
                "treatment_id": "direct_link",
                "label_cn": "直连",
                "instruction": "标定接点处自然顺滑直连，语流紧凑不断裂、不做刻意气口或拖音转折。"
            },
            {
                "treatment_id": "curved_link",
                "label_cn": "曲连（藕断丝连）",
                "instruction": "标定接点处几乎不留静音空隙，但通过前字拉长、音高转折或气声过渡听出明显分组。"
            },
            {
                "treatment_id": "rising_pause",
                "label_cn": "扬停（声断气连/期待下文）",
                "instruction": "标定接点处做明显停顿，但前字尾音微扬或悬住，让听众明确感到话没说完、期待下文。"
            },
            {
                "treatment_id": "falling_pause",
                "label_cn": "落停（收束完结）",
                "instruction": "标定接点处做明显停顿，前字音高沉落收束，让听众明确感到意群在此落稳。"
            }
        ],
        "sentences": [
            {"text_id": "expB_s01", "text": "夜色已经很深了，远处的灯光却依然亮着。", "target_junction_after": "深了", "trap_type": "neutral_baseline"},
            {"text_id": "expB_s02", "text": "他慢慢放下手中的信，抬头望向窗外的雨。", "target_junction_after": "的信", "trap_type": "tone4_falling_trap", "trap_note": "“信”(去声)易与落停混淆"},
            {"text_id": "expB_s03", "text": "我们必须立刻出发，才能在天黑前赶到。", "target_junction_after": "出发", "trap_type": "no_punc_mid_clause"},
            {"text_id": "expB_s04", "text": "老李买好早点，顺手递给身旁的小女孩。", "target_junction_after": "早点", "trap_type": "tone3_sandhi_trap", "trap_note": "“买好早点”含连续三声变调"},
            {"text_id": "expB_s05", "text": "春风吹过山谷，唤醒了沉睡整冬的溪水。", "target_junction_after": "山谷", "trap_type": "tone3_boundary"},
            {"text_id": "expB_s06", "text": "这并非一次偶然的失误，而是长期忽视的结果。", "target_junction_after": "失误", "trap_type": "tone4_falling_trap", "trap_note": "“误”(去声)检验扬停抗四声干扰"},
            {"text_id": "expB_s07", "text": "广场上人群渐渐散去，只留下几盏微弱的路灯。", "target_junction_after": "散去", "trap_type": "tone4_falling_trap", "trap_note": "“散去”(双去声)检验扬停/曲连"},
            {"text_id": "expB_s08", "text": "请把这份材料仔细核对一遍，确认无误再提交。", "target_junction_after": "一遍", "trap_type": "tone4_falling_trap", "trap_note": "“遍”(去声)检验声调条件化F0"},
            {"text_id": "expB_s09", "text": "山雨欲来风满楼，空气里弥漫着潮湿的泥土味。", "target_junction_after": "满楼", "trap_type": "classical_poetry"},
            {"text_id": "expB_s10", "text": "只要脚步不停，再远的路也终究会被走完。", "target_junction_after": "不停", "trap_type": "tone2_rising_trap", "trap_note": "“停”(阳平)易与扬停混淆"}
        ]
    }
    (OUT_ROOT / "expB_controlled.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return len(data["sentences"])


def build_e7_trial_pack(phrases: List[Dict[str, Any]]) -> int:
    """Create blinded Arm X / Arm Y proofreading tasks from real phrases for E7 human effort trial."""
    tasks = []
    for idx, p in enumerate(phrases[:10]):
        arm_code = "ARM_ALPHA" if idx % 2 == 0 else "ARM_BETA"
        hints = p.get("_sealed_e7_hints") or []
        # Create realistic machine draft suggestions (including occasional abstain markers)
        draft_stress = {}
        draft_breaks = {}
        for h in hints:
            if h["stress"] in ("primary", "secondary"):
                draft_stress[str(h["idx"])] = "P2" if h["stress"] == "primary" else "P1"
            if h["break"] in ("short", "long", "/", "//"):
                draft_breaks[str(h["idx"])] = "major" if h["break"] in ("long", "//") else "minor"
        tasks.append({
            "trial_id": f"e7_trial_{idx+1:02d}",
            "phrase_id": p["phrase_id"],
            "audio_id": p["audio_id"],
            "title": p["title"],
            "arm_masked": arm_code,
            "task_type": "prominence_and_grouping_proofread",
            "idle_pause_threshold_sec": 60,
            "clip_url": p["clip_url"],
            "duration_ms": p["duration_ms"],
            "text": p["text"],
            "waveform": p["waveform"],
            "tokens": p["tokens"],
            "machine_draft": {
                "prominence": draft_stress,
                "breaks": draft_breaks,
                "abstain_indices": [len(p["tokens"]) // 2] if len(p["tokens"]) > 4 else [],
            }
        })
    pack = {
        "pack_type": "e7_human_trial",
        "version": "1.0.0",
        "preregistered_gate": {
            "max_critical_error_delta": 0,
            "idle_pause_sec": 60,
            "require_blind_audit": True,
        },
        "items": tasks,
    }
    (OUT_ROOT / "e7_trial.json").write_text(json.dumps(pack, ensure_ascii=False, indent=2), encoding="utf-8")
    return len(tasks)


if __name__ == "__main__":
    n_f0 = build_e2_f0_pack()
    phrases = build_ecological_phrases()
    n_a = build_expA_controlled()
    n_b = build_expB_controlled()
    n_e7 = build_e7_trial_pack(phrases)
    # Calculate total pack size
    total_bytes = sum(f.stat().st_size for f in OUT_ROOT.rglob("*") if f.is_file())
    print(f"DONE: E2_F0={n_f0}, EcoPhrases={len(phrases)}, ExpA_Prompts={n_a}, ExpB_Prompts={n_b}, E7_Trials={n_e7}")
    print(f"Total bundled pack size: {total_bytes / 1024 / 1024:.2f} MB")
