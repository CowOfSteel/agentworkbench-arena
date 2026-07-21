# Phase 5 environment resolution

This record contains nonsecret local discovery only. It does not prove a provider can complete a coding task.

## Observed clients

- Codex CLI: `codex-cli 0.144.0` from `codex --version`.
- OpenCode: `1.18.3` from `opencode --version`.

## Resolved identifiers

`opencode models` listed these identifiers on the preparation machine:

- OpenAI: `openai/gpt-5.6-terra`.
- OpenCode Go: `opencode-go/deepseek-v4-flash`.
- Direct DeepSeek: `deepseek/deepseek-v4-flash`.

The Phase 5 template records their provider/model components. `opencode run --help` confirms the literal `--variant` argument, but it does not enumerate model-specific supported values.

## Still human-resolved

The three OpenCode `REPLACE_*_VARIANT` values and the repository/baseline placeholders remain blockers. Resolve them without exposing credentials:

```text
opencode auth list
opencode models openai
opencode models opencode-go
opencode models deepseek
npm start -- doctor <resolved-trial.yml>
npm start -- diagnose <resolved-trial.yml> <candidate-id>
```

The last command is the bounded route diagnostic and intentionally uses the configured candidate. Run it only during the human-controlled flagship sequence. Do not copy credential values, executable paths, or provider configuration into this repository.

