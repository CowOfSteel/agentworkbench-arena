# Locked Decisions

1. Trials support two or more candidates.
2. Candidate count is configuration data and must not be hard-coded in the runner or schema.
3. A configurable operational safety limit may be added later, but it is not a product-level maximum.
4. The first live trial uses six configurations: Luna Low, Luna Medium, and Luna High through Codex, plus Luna Low, Luna Medium, and Luna High through OpenCode.
5. Candidate enumeration is independent of adapter enumeration.
6. Plugins and tools, including RTK and Ponytail, are part of candidate provenance and configuration identity.
7. Phase 0 may reserve schema concepts for plugins and tools, but does not implement plugin orchestration, installation, execution, or plugin-specific telemetry.
8. Raw evidence remains authoritative.
9. Arena remains separate from AgentWorkbench v1.
10. Core implementation remains in one primary Codex conversation.
11. Arena compares complete configurations and must not make unsupported single-variable causal claims.
12. Phase 0 uses a minimal TypeScript CLI, Node’s built-in test runner, and no runtime dependencies.
13. The project uses the MIT license.
