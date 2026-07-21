# Submission readiness

| Item | Status | Evidence or remaining action |
| --- | --- | --- |
| Track: Developer Tools | READY | Arena is a repository-specific developer configuration-calibration tool. |
| Primary `/feedback` Session ID | READY | `019f80f2-5a79-7ff1-b3ac-24ccbeaf44a4` is recorded in the development provenance. |
| Windows install and judge path | READY | `npm run verify:clean` proves clean install, tests, demo, package, and built/installed CLI paths. |
| License and notices | READY | MIT project license plus third-party notices are present. |
| Sanitized fallback demo | READY | `examples/demo-run` verifies without native credentials or model calls. |
| Six-route diagnostic proof | READY | PR #7 records one final shared-contract pass for all six configurations. |
| Final flagship candidate run | READY | The human-controlled six-configuration run completed; three candidates passed deterministic hard gates. |
| Final Sol High adjudication | READY | The accepted High verdict recommended Terra High through Codex with high confidence. |
| Repository access | READY | The repository is public at `https://github.com/CowOfSteel/agentworkbench-arena`. |
| GitHub Pages | READY | The public sample is live at `https://cowofsteel.github.io/agentworkbench-arena/`. |
| Submission video | PENDING_HUMAN | Record and upload after the final report is available. |
| Devpost | PENDING_HUMAN | Complete and submit the form after access, report, and video are ready. |

Run `npm run submission:preflight` before the flagship sequence and again before publication. A failed preflight or unsafe public artifact changes the relevant item to `BLOCKED` until repaired.

The flagship sanitizer rejected an absolute-path or sensitive-source condition, so the source report remains private. The current independently verified two-candidate sanitized demo remains the safe zero-credential public fallback.
