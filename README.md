# OSOT 声笺实验台 (Android)

把 **OSOT 播音科研（E2 尾项 → E4 → E5 → E7）** 剩下全部可由手机完成的人工录音与双盲标注环节，按严格实行顺序打包成独立 Android App，内置真实名家实验音频切片、无损干声 WAV 录音棚、一键导出给电脑分析，以及基于 GitHub Releases 的**应用内实时点击更新系统**。

## 内置 6 大顺序实验模块

| 顺序 | 模块 | 内置实验音频/剧本 | 导出文件 | 电脑对接位置 |
|---|---|---|---|---|
| 1 | **E2 尾项 · F0 分层抽检** | 38 帧真实干声 1s 切片 (`e2_f0_stratified_pack.json`) | `e2_f0_reviewed.json` | `experiments/e2_blind_eval/e2_f0_reviewed.json` |
| 2 | **E4 实验 A · 受控干声录音棚** | 12 句 × 4 条件（中性/强读/轻读重音/普通弱读） | `osot_expA_dry_audio_*.zip` | `experiments/expA/mobile_dry_audio/` |
| 3 | **E4 实验 A · 重音/凸显双盲标定** | 20 条真实名家自然短语（严格 L2 盲票 + L3 独立虚声） | `e4_expA_votes.json` | `experiments/expA/mobile_votes/` |
| 4 | **E5 实验 B · 停连四法录音棚** | 10 句 × 4 手法（直连/曲连/扬停/落停，含去声/三声变调陷阱） | `osot_expB_dry_audio_*.zip` | `experiments/expB/mobile_dry_audio/` |
| 5 | **E5 实验 B · 全接点停连与四法** | 20 条真实名家短语（开放全部相邻字接点，L2 分组+延续/收束+有无空隙） | `e5_expB_boundary_votes.json` | `experiments/expB/mobile_votes/` |
| 6 | **E7 · 真人省工交叉对照与盲审** | 10 组盲化 Arm 对照 + 60s 发呆自动停表 + 盲审残留错复核 | `e7_human_trial_export.json` | `experiments/e7_trial/mobile_sessions/` |

## 一键传回电脑分析

在手机 App「导出」页点击 **「导出全部实验成果总包 (.zip)」**，通过微信/QQ/网盘/数据线传到电脑后，在 `D:\otos\osot-annotator` 运行：

```powershell
python scripts/import_mobile_pack.py <导出的zip路径>
```

脚本会自动将所有 JSON 票据与无损 WAV 干声归位到对应实验目录，并在检测到 `e2_f0_reviewed.json` 时自动触发 `run_e2_f0_stratified_check.py`。

## 实时在线更新（GitHub Releases）

- 每次推送新版本标签（例如 `git tag v1.0.1 && git push origin v1.0.1`），GitHub Actions 会自动编译**同一 Release 密钥签名**的 APK 并发布到 GitHub Releases。
- 手机端打开 App 底部 **「更新」** 页 → 点击 **「立即检查更新」** → 点击 **「一键下载并安装新版本 APK」** 即可覆盖更新（支持配置国内加速镜像前缀如 `https://ghfast.top/`，更新不丢本地数据）。
