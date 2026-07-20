# AgentWorkbench Arena

AgentWorkbench Arena is a local calibration tool for comparing complete coding-agent configurations on a user-owned repository. It is a separate contest-period prototype of a future AgentWorkbench configuration-calibration system.

Phase 1 native feasibility is complete with a passing `LIVE_MODE` gate. Phase 2 supplies deterministic telemetry, independent canonical validation, explicit hard gates, and a portable run manifest. Phase 3 can consume only finalized Phase 2 packets for identity-masked semantic adjudication; deterministic hard gates remain authoritative.

## Quick start

```text
npm install
npm run build
npm test
npm start -- doctor examples/bounded-fix/trial.yml
npm start -- diagnose examples/bounded-fix/trial.yml codex-luna-low
npm start -- run examples/bounded-fix/trial.yml
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

Each candidate receives `raw-telemetry.json`, `telemetry.json`, and `validation.json`; every run receives `manifest.json` and `trial-snapshot.json`. Raw events remain authoritative. `telemetry.json` uses `{ value, availability, source }`: unavailable data is `null`, while zero is emitted only when Arena establishes it.

Candidate process duration is measured with a monotonic clock across all attempts. Validation duration is measured separately and never attributed to candidate execution. The manifest measures the full Arena pipeline through finalization. Native timing and usage remain source-native facts in `raw-telemetry.json`.

Trials must declare `validation_timeout_ms` and `dependency_policy`. `no_changes` rejects semantic npm dependency additions/removals; package and lockfile changes remain separate deterministic facts. All validation commands use argument arrays, a bounded timeout, and portable worktree paths.

The ten hard gates are explicit in each `telemetry.json`; an unavailable gate cannot pass, and no future adjudicator may override a failed gate. Artifact completeness is finalized after telemetry generation so its self-check is deterministic.

## Phase 3 adjudication

`arena adjudicate <run-directory> --dry-run` validates a finalized packet, constructs no candidate worktrees, and uses no model quota. A real adjudication uses read-only, ephemeral Codex execution with `approval_policy="never"`; it defaults to `gpt-5.6-sol` at Low reasoning. `--reasoning high` is reserved for an explicit human final-stabilization run; efforts above High are rejected. The judge sees only labels and a bounded allowlisted packet. It writes masked input, execution/repair evidence, and `evaluation.json`, never a Phase 4 report or `recommendation.yml`.

## Phase boundaries

Phase 1 contains the fixture, YAML trial schema, Codex and OpenCode native adapters, sequential worktree runner, and raw evidence preservation. Candidate count is configuration data: the first trial has six candidates, while adding a seventh changes only the trial file.

It does not contain GPT-5.6 adjudication, identity masking, HTML reporting, ranking, recommendations, import fallback, plugin orchestration, controlled tool comparisons, parallel execution, additional adapters, automatic routing, or AgentWorkbench v1 integration.

See [`docs/COMPETITION-SPRINT-ROADMAP.md`](docs/COMPETITION-SPRINT-ROADMAP.md) for the authoritative roadmap, [`SCOPE.md`](SCOPE.md) for boundaries, [`DECISIONS.md`](DECISIONS.md) for locked decisions, and [`IMPLEMENTATION_STATE.md`](IMPLEMENTATION_STATE.md) for current status.

## Collaboration and provenance

Core implementation remains in one primary Codex conversation. The human owns the product problem, scope, acceptance contract, and evaluation policy; Codex implements the bounded repository work. Arena remains separate from AgentWorkbench v1 until a later migration decision.

## License

MIT. See [`LICENSE`](LICENSE).
