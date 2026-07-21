# AgentWorkbench Arena

AgentWorkbench Arena is a local calibration tool for comparing complete coding-agent configurations on a user-owned repository. It is a separate contest-period prototype of a future AgentWorkbench configuration-calibration system.

Phase 1 native feasibility is complete with a passing `LIVE_MODE` gate. Phase 2 supplies deterministic telemetry, independent canonical validation, explicit hard gates, and a portable run manifest. Phase 3 can consume only finalized Phase 2 packets for identity-masked semantic adjudication; deterministic hard gates remain authoritative.

Phase 3 implementation, deterministic tests, Windows CI, and the bounded authenticated Sol Low proof are complete. Phase 4 now provides deterministic static HTML/YAML reporting and an offline sanitized demo. Sol High remains reserved for final end-to-end stabilization; Phase 5 has not started.

## Quick start

```text
npm install
npm run build
npm test
npm start -- doctor examples/bounded-fix/trial.yml
npm start -- diagnose examples/bounded-fix/trial.yml codex-luna-low
npm start -- run examples/bounded-fix/trial.yml
npm start -- report <completed-run-directory>
npm run demo
```

The project uses TypeScript, Node.js, native Git/process capabilities, Node’s built-in test runner, and one YAML parser. It has no web framework, database, dashboard, or plugin framework.

## Codex executable and authentication

Codex resolution uses a candidate `adapter_options.codex_executable`, then `ARENA_CODEX_EXECUTABLE`, then a local `.arena/config.json`, and finally `codex` on `PATH`. Copy [`.arena/config.example.json`](.arena/config.example.json) for a local non-secret executable path; local config is ignored by Git.

Arena uses the existing Codex CLI environment so normal ChatGPT authentication works. Sign in with `codex login` and choose Sign in with ChatGPT when needed; Arena never copies, prints, or records credentials. `CODEX_ACCESS_TOKEN` is an optional advanced authentication mode only: when already supplied by the shell, Arena passes it through and redacts its value from captured evidence. Do not create, reveal, or paste a token for Arena.

```powershell
codex login
```

## Locked product direction

- A trial supports two or more candidates, with no hard-coded candidate count.
- Candidate enumeration is independent of adapter enumeration.
- The first live trial contains six configurations: Luna Low, Luna Medium, and Luna High through Codex, plus the same three levels through OpenCode.
- Complete configurations include harness, provider, model, variant or reasoning level, profile, permissions, skills, tools, and budget. Plugins and tools are part of provenance and configuration identity.
- Raw evidence remains authoritative. The product compares complete configurations and does not make unsupported single-variable causal claims.
- Plugins and tools may have reserved schema concepts later, but Phase 0 does not orchestrate, install, execute, or emit plugin-specific telemetry.

## Deterministic artifacts

Each candidate receives `raw-telemetry.json`, `telemetry.json`, and `validation.json`; every run receives `manifest.json`, `trial-snapshot.json`, and a hash-checked `task-contract.json`. The task contract preserves the safe objective and contract policies needed for Phase 3; historical runs without it remain valid Phase 2 evidence but cannot be adjudicated. Raw events remain authoritative. `telemetry.json` uses `{ value, availability, source }`: unavailable data is `null`, while zero is emitted only when Arena establishes it.

Candidate process duration is measured with a monotonic clock across all attempts. Validation duration is measured separately and never attributed to candidate execution. The manifest measures the full Arena pipeline through finalization. Native timing and usage remain source-native facts in `raw-telemetry.json`.

Trials must declare `validation_timeout_ms` and `dependency_policy`. `no_changes` rejects semantic npm dependency additions/removals; package and lockfile changes remain separate deterministic facts. All validation commands use argument arrays, a bounded timeout, and portable worktree paths.

The ten hard gates are explicit in each `telemetry.json`; an unavailable gate cannot pass, and no future adjudicator may override a failed gate. Artifact completeness is finalized after telemetry generation so its self-check is deterministic.

## Phase 3 adjudication

`arena adjudicate <run-directory> --dry-run` validates a finalized packet, constructs no candidate worktrees, uses no model quota, and atomically refreshes the inspectable `<run-directory>/phase3-preview/` cache. That cache contains only `masked-judge-input.json`, `judge-output-schema.json`, and `dry-run.json`; it creates neither an identity map nor adjudication/evaluation artifacts. A real adjudication uses one fresh OS-temporary staging directory outside the run tree, read-only ephemeral Codex execution, and `approval_policy="never"`; the staging directory is deleted after the original and optional single repair call. It defaults to `gpt-5.6-sol` at Low reasoning. `--reasoning high` is reserved for an explicit human final-stabilization run; efforts above High are rejected. The judge sees only labels and a bounded allowlisted packet: real identities, provenance, configuration hashes, machine paths, and unsafe validation output are rejected. It writes masked input, execution/repair evidence, and `evaluation.json`, never a Phase 4 report or `recommendation.yml`.

## Phase 4 static report

`arena report <run-directory>` validates a completed Phase 2/3 artifact set and atomically regenerates only `report.html` and `recommendation.yml`. Reporting is presentation-only: `evaluation.json` controls outcome, eligibility, and order; Phase 2 artifacts control deterministic facts; and accepted Phase 3 artifacts control semantic findings. The command invokes no candidate or judge adapter.

The HTML report is self-contained with inline CSS and portable evidence links. The versioned YAML recommendation is non-operative (`routing_applied: false`) and does not modify AgentWorkbench routing. Unknown metrics remain explicit as `Not reported by harness`, and candidate execution, independent validation, and full-pipeline time remain separate.

`npm run demo` regenerates the sanitized bounded proof under `examples/demo-run/` without authentication or network access. The sample omits raw logs, worktrees, executable details, private transcripts, and account/session data while preserving the real Low-proof recommendation.

## Phase boundaries

Phase 1 contains the fixture, YAML trial schema, Codex and OpenCode native adapters, sequential worktree runner, and raw evidence preservation. Candidate count is configuration data: the first trial has six candidates, while adding a seventh changes only the trial file.

Phase 3 adds identity-masked adjudication artifacts and `evaluation.json`. Phase 4 presents those finalized artifacts as static HTML and non-operative YAML. Neither phase adds dashboards, import fallback, plugin orchestration, controlled tool comparisons, parallel execution, additional candidate adapters, automatic routing, or AgentWorkbench v1 integration.

See [`docs/COMPETITION-SPRINT-ROADMAP.md`](docs/COMPETITION-SPRINT-ROADMAP.md) for the authoritative roadmap, [`SCOPE.md`](SCOPE.md) for boundaries, [`DECISIONS.md`](DECISIONS.md) for locked decisions, and [`IMPLEMENTATION_STATE.md`](IMPLEMENTATION_STATE.md) for current status.

## Collaboration and provenance

Core implementation remains in one primary Codex conversation. The human owns the product problem, scope, acceptance contract, and evaluation policy; Codex implements the bounded repository work. Arena remains separate from AgentWorkbench v1 until a later migration decision.

## License

MIT. See [`LICENSE`](LICENSE).
