import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { scanPublicText, submissionPreflight } from "../src/submission-preflight";

const root = resolve(__dirname, "..", "..");
const feedbackId = "019f80f2-5a79-7ff1-b3ac-24ccbeaf44a4";
const count = (text: string, value: string): number => text.split(value).length - 1;
const read = (path: string): Promise<string> => readFile(resolve(root, path), "utf8");

async function preflightFixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "arena-phase6-test-"));
  await mkdir(join(directory, "docs"), { recursive: true });
  await mkdir(join(directory, "examples", "demo-run"), { recursive: true });
  await writeFile(join(directory, "README.md"), [
    "# Arena", "## Zero-credential judge path", "## Supported platform and prerequisites",
    "## Codex, GPT-5.6, and human decisions", "## Telemetry and efficiency semantics",
    "Candidate execution is not provider API request latency.", "## License and third-party software"
  ].join("\n"));
  await writeFile(join(directory, "docs", "CODEX-DEVELOPMENT.md"), feedbackId);
  await writeFile(join(directory, "docs", "SUBMISSION-READINESS.md"), feedbackId);
  await writeFile(join(directory, "THIRD_PARTY_NOTICES.md"), "yaml 2.9.0 ISC\nTypeScript 5.9.3 Apache-2.0\n@types/node 24.13.3 MIT\nundici-types 7.18.2 MIT\n");
  await writeFile(join(directory, "LICENSE"), "MIT License\n");
  await writeFile(join(directory, "package-lock.json"), JSON.stringify({ packages: {
    "node_modules/yaml": { version: "2.9.0", license: "ISC" },
    "node_modules/typescript": { version: "5.9.3", license: "Apache-2.0" },
    "node_modules/@types/node": { version: "24.13.3", license: "MIT" },
    "node_modules/undici-types": { version: "7.18.2", license: "MIT" }
  } }));
  await writeFile(join(directory, "examples", "demo-run", "README.md"), "Sanitized sample\n");
  execFileSync("git", ["init"], { cwd: directory });
  execFileSync("git", ["config", "user.name", "Arena Test"], { cwd: directory });
  execFileSync("git", ["config", "user.email", "arena@example.invalid"], { cwd: directory });
  execFileSync("git", ["add", "."], { cwd: directory });
  execFileSync("git", ["commit", "-m", "fixture"], { cwd: directory });
  return directory;
}

test("public closeout documentation is judge-first, current, and provenance-safe", async () => {
  const readme = await read("README.md"), provenance = await read("docs/CODEX-DEVELOPMENT.md"), readiness = await read("docs/SUBMISSION-READINESS.md"), notices = await read("THIRD_PARTY_NOTICES.md");
  assert.equal(count(provenance, feedbackId), 1);
  assert.equal(count(readiness, feedbackId), 1);
  assert.doesNotMatch(`${readme}\n${provenance}\n${readiness}`, /submission-provenance blocker|missing feedback|unmerged PR/i);
  const headings = ["See the result first", "Zero-credential judge path", "What the report tells you", "Product workflow", "Run Arena on your repository", "Architecture and trust"];
  for (let index = 1; index < headings.length; index++) assert.ok(readme.indexOf(headings[index - 1]) < readme.indexOf(headings[index]));
  assert.match(readme, /Tested:\*\* Windows/);
  assert.match(readme, /not provider API request latency/);
  assert.match(readme, /Arena measures and recommends\. AgentWorkbench operationalizes\./);
  assert.match(readme, /Neither RTK nor Ponytail is required to install or run Arena/);
  assert.match(notices, /yaml 2\.9\.0[\s\S]*ISC/);
  assert.match(notices, /TypeScript 5\.9\.3[\s\S]*Apache-2\.0/);
});

test("obsolete sprint documents are deleted and no public source links to them", async () => {
  const removed = ["CONTEST_WORK.md", "DECISIONS.md", "IMPLEMENTATION_STATE.md", "SCOPE.md", "docs/COMPETITION-SPRINT-ROADMAP.md", "docs/PHASE1-FEASIBILITY-REPORT.md", "docs/PHASE4_5-PRODUCT-EXPERIENCE.md", "docs/PHASE5-ENVIRONMENT-RESOLUTION.md", "docs/PHASE5-RUNBOOK.md"];
  for (const file of removed) await assert.rejects(stat(resolve(root, file)));
  for (const file of ["README.md", "docs/QUICKSTART-LIVE.md", "docs/CODEX-DEVELOPMENT.md", "docs/ARCHITECTURE-AND-TRUST.md", "docs/DEVELOPMENT-HISTORY.md", "docs/FINAL-FLAGSHIP-RUNBOOK.md", "docs/SUBMISSION-READINESS.md"]) {
    const content = await read(file);
    for (const deleted of removed) assert.ok(!content.includes(deleted));
  }
});

test("flagship runbook preserves candidates and orders the one High adjudication safely", async () => {
  const runbook = await read("docs/FINAL-FLAGSHIP-RUNBOOK.md");
  assert.equal((runbook.match(/npm start -- run phase5\.local\.yml/g) ?? []).length, 1);
  assert.match(runbook, /8dda0e4068a8b7fb27793cfbab6947076ec24e7f/);
  assert.match(runbook, /subst R:/);
  assert.ok(runbook.indexOf("Copy-Item") < runbook.indexOf("npm start -- adjudicate"));
  assert.ok(runbook.indexOf("--dry-run --reasoning high") < runbook.indexOf("--reasoning high"));
  assert.match(runbook, /never rerun candidates/i);
  assert.match(runbook, /current verified `examples\/demo-run` fallback/);
});

test("public scanner rejects high-confidence values without echoing them", () => {
  scanPublicText("ordinary public documentation");
  const secret = ["sk", "zyxwvutsrqponmlk"].join("-");
  assert.throws(() => scanPublicText(`value=${secret}`), (error: unknown) => error instanceof Error && error.message === "unsafe_public_text" && !error.message.includes(secret));
  const privatePath = ["C:", "Users", "person", "private.txt"].join("\\");
  assert.throws(() => scanPublicText(privatePath), /unsafe_public_text/);
});

test("submission preflight reports sanitized checks and invokes no external adapters", async () => {
  const directory = await preflightFixture();
  let verifyCalls = 0, stageCalls = 0;
  try {
    const result = await submissionPreflight({
      root: directory, skip_clean: true,
      verify: async () => { verifyCalls++; return { status: "VERIFIED", checks: [] } as any; },
      stage: async (_source, destination) => { stageCalls++; return { directory: destination, index: join(destination, "index.html"), files: [] }; }
    });
    assert.equal(result.status, "READY", JSON.stringify(result.checks));
    assert.deepEqual(result.checks.map((item) => item.id), ["git_clean", "documentation", "tracked_tree", "reachable_history", "links", "demo_verify", "pages_stage"]);
    assert.ok(result.checks.every((item) => item.status === "passed" && item.classification === "completed"));
    assert.equal(verifyCalls, 1); assert.equal(stageCalls, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("report provenance language and ignored local trial remain publication-safe", async () => {
  const source = await read("src/report.ts"), ignore = await read(".gitignore"), sample = await read("examples/demo-run/README.md");
  assert.doesNotMatch(source, /submission-provenance blocker/);
  assert.match(source, /human-owned product decisions and implementation history/);
  assert.match(ignore, /^phase5\.local\.yml$/m);
  assert.match(sample, /Sanitized Arena demo/);
  assert.match(sample, /bounded two-candidate proof/);
  assert.match(sample, /remains the fallback/);
});
