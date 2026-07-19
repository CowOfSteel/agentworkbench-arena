# Scope

## Product

Arena compares complete coding-agent configurations on the user’s own repository. A result is a practical configuration comparison unless the trial explicitly holds variables constant. It is not a public benchmark leaderboard, generalized orchestrator, observability dashboard, or causal experiment.

## Phase 0 in scope

- Separate contest repository scaffold.
- Minimal Node.js and TypeScript CLI.
- Documentation of product scope, process, decisions, and implementation state.
- Reproducible build and test commands.
- Reserved documentation-level concepts for future configuration provenance, plugins, and tools.

## Phase 0 out of scope

- Codex or OpenCode adapters.
- Candidate execution, worktrees, trials, fixtures, or schemas.
- GPT-5.6 adjudication.
- Telemetry normalization or plugin-specific telemetry.
- HTML reports, routing recommendations, or sample runs.
- Plugin orchestration, installation, or execution.
- AgentWorkbench v1 integration.
- Web frameworks, databases, React, Electron, Docker, or generalized plugin infrastructure.

## Locked trial shape

Trials support two or more candidates. Candidate count is configuration data, not a runner or schema constant. An optional operational safety limit may be introduced later, but it will not be a product-level maximum.

The first live trial will use these six configurations:

1. Luna Low through Codex.
2. Luna Medium through Codex.
3. Luna High through Codex.
4. Luna Low through OpenCode.
5. Luna Medium through OpenCode.
6. Luna High through OpenCode.

Candidate enumeration is independent of adapter enumeration; one adapter may serve multiple candidates.

Plugins and tools, including RTK and Ponytail, belong to candidate provenance and configuration identity. Phase 0 may reserve concepts for them, but does not implement orchestration, installation, execution, or plugin-specific telemetry.

Raw evidence remains authoritative. Arena must not infer that one model, harness, provider, or reasoning setting caused an outcome unless the trial explicitly supports that claim.

## Repository boundary

Arena is a separate contest project and does not depend on AgentWorkbench v1. It may later be migrated or reused, but Phase 0 does not integrate the two repositories.
