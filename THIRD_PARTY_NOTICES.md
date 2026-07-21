# Third-party notices

This file distinguishes software distributed with Arena from separately installed tools and development-only tooling. It is an inventory, not a legal-compliance warranty.

## Bundled runtime dependency

### yaml 2.9.0

- Purpose: YAML trial parsing and deterministic YAML recommendation output.
- Source: <https://github.com/eemeli/yaml>
- License: ISC.
- Copyright: Eemeli Aro.

The ISC notice included with the installed package permits use, copying, modification, and distribution with or without fee provided its copyright and permission notice remain included. The software is provided without warranty.

## Development-only dependencies

- TypeScript 5.9.3 — Apache-2.0.
- `@types/node` 24.13.3 — MIT.
- `undici-types` 7.18.2 — MIT.

These support compilation and typechecking and are not Arena runtime integrations.

## GitHub Actions

The workflows reference official GitHub-maintained actions: `actions/checkout`, `actions/setup-node`, `actions/configure-pages`, `actions/upload-pages-artifact`, and `actions/deploy-pages`. Their source repositories publish MIT licenses. The actions are fetched by GitHub Actions and are not bundled in the Arena package.

## External native tools and product integrations

Arena can invoke separately installed Codex and OpenCode clients and can evaluate provider/model configurations available through those clients. Arena does not bundle those clients, provider SDKs, models, subscriptions, or credentials. Their licenses and service terms remain with their respective publishers.

GPT-5.6 Sol is an external product integration used for identity-masked semantic adjudication. It is not distributed with this repository.

## Development workflow tools

RTK and Ponytail were used during development workflow. Neither is bundled, required at runtime, part of candidate evaluation, or an input to deterministic gates, semantic adjudication, or recommendations.
