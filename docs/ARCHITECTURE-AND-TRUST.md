# Architecture and trust model

## Data flow

```text
validated trial contract
  → isolated sequential candidate worktrees
  → raw native evidence and pre-validation candidate diff
  → independent validation and deterministic hard gates
  → bounded identity-masked semantic packet
  → controller-owned evaluation
  → static report and non-operative recommendation
```

## Authority

- Raw native evidence is authoritative for source events.
- Deterministic validation and hard gates control eligibility. Gate precedence is `failed > unavailable > passed`.
- GPT-5.6 cannot make an ineligible candidate eligible.
- `evaluation.json` controls outcome, eligibility, and candidate order.
- Decision lenses are informational and never rerank candidates.
- Reporting invokes no candidate or judge adapter and does not mutate source evidence.
- `recommendation.yml` has `routing_applied: false`.

## Evidence semantics

- Unavailable telemetry is not zero. Established zero requires deterministic evidence.
- Candidate execution, independent validation, candidate pipeline, and full Arena pipeline durations are separate.
- Candidate execution includes harness and tool activity; it is not provider API request latency.
- Provider-reported cost, estimated cost, subscription consumption, and quota are distinct.
- Raw source-native telemetry remains separate from normalized cross-harness telemetry.
- Failed candidates can have complete evidence, and complete evidence does not make them eligible.

## Masked semantic adjudication

Only allowlisted task, diff, validation, gate, telemetry-summary, and evidence-completeness facts enter the judge packet. Real candidate/configuration identities, raw logs, executable paths, and local paths are excluded. The judge runs read-only in a fresh temporary staging directory, with no approvals, and receives at most one structural repair attempt.

The semantic outcome may be a recommendation, tie, no winner, or inconclusive result. A judge execution failure remains distinct from an accepted semantic inconclusive result.

## Comparison boundary

Arena compares complete configurations. Structural topology can identify controlled sweeps only when every other known comparison dimension is equal. Multi-variable comparisons do not establish that one model, harness, provider, reasoning level, permission, profile, or tool caused an observed difference.

Arena does not use a weighted mega-score, historical dashboard, automatic routing, or statistical causal model.

## Privacy and publication

Credentials stay in native client authentication and never belong in trials or committed evidence. Public samples are allowlisted sanitized derivatives of finalized verified runs. They omit raw logs/events, worktrees, executable details, account/session material, and private judge transcripts while preserving accepted deterministic and semantic results.
