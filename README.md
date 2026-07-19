# AgentWorkbench Arena

AgentWorkbench Arena is a local calibration tool for comparing complete coding-agent configurations on a user-owned repository. It is a separate contest-period prototype of a future AgentWorkbench configuration-calibration system.

The project is currently in Phase 0: scope lock and contest setup. The CLI scaffold builds and exposes help, but candidate execution has deliberately not started.

## Quick start

```text
npm install
npm run build
npm test
npm start -- --help
```

The project uses TypeScript, Node.js, native Git/process capabilities, and Node’s built-in test runner. It has no runtime dependencies, web framework, database, dashboard, or plugin framework.

## Locked product direction

- A trial supports two or more candidates, with no hard-coded candidate count.
- Candidate enumeration is independent of adapter enumeration.
- The first live trial contains six configurations: Luna Low, Luna Medium, and Luna High through Codex, plus the same three levels through OpenCode.
- Complete configurations include harness, provider, model, variant or reasoning level, profile, permissions, skills, tools, and budget. Plugins and tools are part of provenance and configuration identity.
- Raw evidence remains authoritative. The product compares complete configurations and does not make unsupported single-variable causal claims.
- Plugins and tools may have reserved schema concepts later, but Phase 0 does not orchestrate, install, execute, or emit plugin-specific telemetry.

## Phase boundaries

Phase 0 contains only the repository scaffold, documentation, and verification. It does not contain adapters, schemas, worktrees, trial execution, telemetry normalization, GPT-5.6 adjudication, reports, routing recommendations, fixtures, plugin execution, or AgentWorkbench integration.

The exact Phase 1 starting point is the fixture, candidate-adapter interface, and multi-candidate feasibility spike. It must prove the execution path before later evaluation features are added.

See [`docs/COMPETITION-SPRINT-ROADMAP.md`](docs/COMPETITION-SPRINT-ROADMAP.md) for the authoritative roadmap, [`SCOPE.md`](SCOPE.md) for boundaries, [`DECISIONS.md`](DECISIONS.md) for locked decisions, and [`IMPLEMENTATION_STATE.md`](IMPLEMENTATION_STATE.md) for current status.

## Collaboration and provenance

Core implementation remains in one primary Codex conversation. The human owns the product problem, scope, acceptance contract, and evaluation policy; Codex implements the bounded repository work. Arena remains separate from AgentWorkbench v1 until a later migration decision.

## License

MIT. See [`LICENSE`](LICENSE).
