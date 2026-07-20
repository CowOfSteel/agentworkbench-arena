# AgentWorkbench Arena

AgentWorkbench Arena is a local calibration tool for comparing complete coding-agent configurations on a user-owned repository. It is a separate contest-period prototype of a future AgentWorkbench configuration-calibration system.

The project is currently in the Phase 1 native feasibility spike. It runs the locked six candidate configurations sequentially in isolated Git worktrees and preserves raw evidence for inspection.

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

## Phase 1 boundaries

Phase 1 contains the fixture, YAML trial schema, Codex and OpenCode native adapters, sequential worktree runner, and raw evidence preservation. Candidate count is configuration data: the first trial has six candidates, while adding a seventh changes only the trial file.

It does not contain normalized telemetry, deterministic hard-gate ranking, GPT-5.6 adjudication, identity masking, HTML reporting, recommendations, import fallback, plugin orchestration, controlled tool comparisons, parallel execution, additional adapters, automatic routing, or AgentWorkbench v1 integration.

See [`docs/COMPETITION-SPRINT-ROADMAP.md`](docs/COMPETITION-SPRINT-ROADMAP.md) for the authoritative roadmap, [`SCOPE.md`](SCOPE.md) for boundaries, [`DECISIONS.md`](DECISIONS.md) for locked decisions, and [`IMPLEMENTATION_STATE.md`](IMPLEMENTATION_STATE.md) for current status.

## Collaboration and provenance

Core implementation remains in one primary Codex conversation. The human owns the product problem, scope, acceptance contract, and evaluation policy; Codex implements the bounded repository work. Arena remains separate from AgentWorkbench v1 until a later migration decision.

## License

MIT. See [`LICENSE`](LICENSE).
