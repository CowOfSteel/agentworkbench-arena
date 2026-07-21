# Final flagship runbook

This is the authoritative human-controlled sequence for the expensive six-candidate scheduler comparison. The current sanitized demo remains the fallback.

## 1. Prepare a clean short-path checkout

```powershell
git switch main
git pull --ff-only
git status --short
npm ci
npm run submission:preflight

subst R: "<absolute-repository-path>"
R:
Set-Location \
```

`git status --short` must be empty. Do not type the angle brackets; substitute the repository’s absolute path. Remove the mapping later with `subst R: /D` after leaving `R:`.

## 2. Verify the frozen fixture baseline

```powershell
$ExpectedBaseline = "8dda0e4068a8b7fb27793cfbab6947076ec24e7f"
$Baseline = git rev-parse "phase5-concurrency-scheduler-baseline^{}"
if ($Baseline -ne $ExpectedBaseline) { throw "Unexpected scheduler baseline tag" }
git ls-remote --tags origin phase5-concurrency-scheduler-baseline "phase5-concurrency-scheduler-baseline^{}"
npm run scheduler:baseline-contract
```

The annotated tag already exists locally and remotely. Do not recreate or move it.

## 3. Protect and validate the local trial

`phase5.local.yml` is ignored by Git. Keep the already proven provider/model/variant values there; never copy credentials or executable paths into it. If the file is absent, copy `examples/concurrency-scheduler-phase5.yml`, set the repository and full baseline SHA, and resolve its explicitly marked provider variants using credential-safe local discovery.

```powershell
npm start -- preview phase5.local.yml
npm start -- doctor phase5.local.yml
git status --short
```

Doctor must report `ready`. PR #7 records all six exact configurations passing the final shared exact-byte diagnostic contract once. Do not repeat diagnostics when only documentation, presentation, or release checks changed. Rediagnose only a configuration whose model, provider route, native variant, executable, adapter, or diagnostic contract changed.

## 4. Execute candidates exactly once

```powershell
npm start -- run phase5.local.yml
```

Copy the printed completed run directory exactly:

```powershell
$Phase2Run = "<completed-run-directory>"
Test-Path "$Phase2Run\manifest.json"
Get-Content "$Phase2Run\manifest.json"
```

Inspect every candidate’s `telemetry.json`, `validation.json`, explicit hard gates, and evidence completeness before semantic adjudication. Preserve `$Phase2Run`; never rerun candidates because a later stage needs repair.

## 5. Work from an adjudication copy

```powershell
$Run = "$Phase2Run-adjudication"
if (Test-Path $Run) { throw "Adjudication copy already exists" }
Copy-Item $Phase2Run $Run -Recurse
```

If adjudication implementation—not candidate evidence—needs repair, create another fresh copy from `$Phase2Run`. Do not delete or overwrite the source run.

## 6. Validate the masked packet, then run Sol High once

```powershell
npm start -- adjudicate $Run --dry-run --reasoning high
Get-Content "$Run\phase3-preview\dry-run.json"
npm start -- adjudicate $Run --reasoning high
```

Inspect the preview before the live call. A valid recommendation, tie, no winner, or accepted semantic inconclusive result is a product outcome. A launch, authentication, timeout, or invalid-response failure is not a successful calibration.

## 7. Report, verify, and sanitize

```powershell
npm start -- report $Run
npm start -- verify $Run
npm start -- sanitize-sample $Run examples/demo-run
npm start -- verify examples/demo-run
npm run demo
npm start -- verify examples/demo-run
```

Report generation may be rerun from the preserved evaluated run. Sanitation may be rerun from the verified run and replaces only an existing Arena-owned sanitized sample. Neither operation invokes candidates or Sol.

## 8. Final offline preflight and safe commit

```powershell
npm run submission:preflight
git status --short
git switch -c release/flagship-sample
git add examples/demo-run
git diff --cached --check
git diff --cached --stat
git commit -m "Publish sanitized flagship Arena sample"
git push -u origin release/flagship-sample
```

Stage only the sanitized sample. Review the PR before merging.

## 9. Human publication steps

1. Make the repository public or grant durable judge access.
2. In GitHub, choose **Settings → Pages → GitHub Actions**.
3. Merge the safe sample PR; the `main` Pages workflow stages only allowlisted sample artifacts.
4. Confirm the expected URL: <https://cowofsteel.github.io/agentworkbench-arena/>.
5. Run the final secret/path scan, record the video, and submit Devpost.

If the flagship cannot finish, publish the current verified `examples/demo-run` fallback instead. Arena measures and recommends. AgentWorkbench operationalizes.
