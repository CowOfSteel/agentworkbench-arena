import { execFileSync } from "node:child_process";
import { lstat, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, posix, resolve } from "node:path";
import { verifyClean } from "./clean-verify";
import { assertSafePublicArtifactText, stagePagesSample } from "./pages";
import { verifyReport } from "./report";

export interface SubmissionCheck { id: string; status: "passed" | "failed"; classification: string; }
export interface SubmissionPreflightResult { status: "READY" | "FAILED"; checks: SubmissionCheck[]; }
export interface SubmissionPreflightOptions {
  root?: string;
  skip_clean?: boolean;
  clean?: typeof verifyClean;
  verify?: typeof verifyReport;
  stage?: typeof stagePagesSample;
}

const rootDefault = resolve(__dirname, "..", "..");
const feedbackId = "019f80f2-5a79-7ff1-b3ac-24ccbeaf44a4";
const publicExtensions = new Set([".md", ".json", ".yml", ".yaml", ".html", ".diff"]);
const forbiddenTrackedName = /(?:^|\/)(?:runs?|phase5\.local\.yml|\.env(?:\..*)?|[^/]*\.(?:log|pem|key|p12|pfx)|credentials?|secrets?)(?:\/|$)/i;
const tokenShape = /\b(?:gh[pousr]_[A-Za-z0-9_]{12,}|sk-[A-Za-z0-9_-]{12,}|xox[baprs]-[A-Za-z0-9-]{12,}|AIza[A-Za-z0-9_-]{20,})\b/;
const privatePath = /(?:[A-Za-z]:[\\/]Users[\\/][^\\/\s"']+|\/(?:Users|home|private)\/[^/\s"']+|file:\/\/)/i;
const safeSynthetic = ["sk-abcdefghijklmnop", "session-123", "C:\\Users\\private\\model", "C:\\Users\\private\\tool"];
const stalePublic = /submission-provenance blocker|Phase 5 has not begun|IMPLEMENTATION_STATE\.md|COMPETITION-SPRINT-ROADMAP\.md|PHASE5-RUNBOOK\.md/i;

const git = (root: string, args: string[]): string => execFileSync("git", args, { cwd: root, encoding: "utf8", timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
const sanitizeFixtures = (value: string): string => safeSynthetic.reduce((text, fixture) => text.split(fixture).join("<synthetic-test-value>"), value);
const count = (text: string, value: string): number => text.split(value).length - 1;

async function scanDirectory(directory: string, needle: string): Promise<boolean> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && await scanDirectory(path, needle)) return true;
    if (entry.isFile() && (await readFile(path, "utf8")).includes(needle)) return true;
  }
  return false;
}

export function scanPublicText(content: string): void {
  const safe = sanitizeFixtures(content);
  if (tokenShape.test(safe) || privatePath.test(safe)) throw new Error("unsafe_public_text");
  assertSafePublicArtifactText(safe);
}

async function trackedFiles(root: string): Promise<string[]> {
  return git(root, ["ls-files", "-z"]).split("\0").filter(Boolean).map((value) => value.replace(/\\/g, "/"));
}

async function checkTrackedTree(root: string): Promise<void> {
  const files = await trackedFiles(root);
  for (const file of files) {
    if (forbiddenTrackedName.test(file)) throw new Error("unsafe_tracked_path");
    const absolute = join(root, ...file.split("/")), info = await lstat(absolute);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("unsafe_tracked_entry");
    const content = await readFile(absolute, "utf8"), safe = sanitizeFixtures(content);
    if (tokenShape.test(safe)) throw new Error("unsafe_tracked_secret_shape");
    if (publicExtensions.has(extname(file).toLowerCase()) && privatePath.test(safe)) throw new Error("unsafe_tracked_private_path");
    if (publicExtensions.has(extname(file).toLowerCase()) && stalePublic.test(safe)) throw new Error("stale_public_claim");
    if (/\b(?:TODO|FIXME)\b/.test(safe) && publicExtensions.has(extname(file).toLowerCase())) throw new Error("unfinished_public_text");
    if (safe.includes("REPLACE" + "_") && !file.startsWith("tests/") && file !== "src/templates.ts" && file !== "examples/concurrency-scheduler-phase5.yml") throw new Error("unsafe_placeholder");
  }
  const demo = join(root, "examples", "demo-run");
  if (await scanDirectory(demo, feedbackId)) throw new Error("feedback_id_in_run_artifact");
}

function checkReachableHistory(root: string): void {
  const rows = git(root, ["rev-list", "--objects", "--all"]).split(/\r?\n/).filter(Boolean), seen = new Set<string>();
  for (const row of rows) {
    const separator = row.indexOf(" "), object = separator < 0 ? row : row.slice(0, separator), path = separator < 0 ? "" : row.slice(separator + 1);
    if (seen.has(object)) continue; seen.add(object);
    if (path && forbiddenTrackedName.test(path)) throw new Error("unsafe_history_path");
    if (git(root, ["cat-file", "-t", object]).trim() !== "blob") continue;
    if (Number(git(root, ["cat-file", "-s", object]).trim()) > 2_000_000) continue;
    const safe = sanitizeFixtures(git(root, ["cat-file", "-p", object]));
    if (tokenShape.test(safe)) throw new Error("unsafe_history_secret_shape");
    if (path && publicExtensions.has(extname(path).toLowerCase()) && privatePath.test(safe)) throw new Error("unsafe_history_private_path");
  }
}

function checkLinks(root: string, files: string[]): void {
  const tracked = new Set(files);
  for (const file of files.filter((value) => value.endsWith(".md") || value === "examples/demo-run/report.html")) {
    const content = execFileSync("git", ["show", `HEAD:${file}`], { cwd: root, encoding: "utf8", timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
    const destinations = file.endsWith(".md") ? [...content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1]) : [...content.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
    for (const raw of destinations) {
      const value = raw.trim().replace(/^<|>$/g, "").split("#")[0];
      if (!value || /^[a-z][a-z0-9+.-]*:/i.test(value)) continue;
      const resolved = posix.normalize(posix.join(posix.dirname(file), decodeURIComponent(value)));
      if (resolved.startsWith("../") || !tracked.has(resolved)) throw new Error("broken_or_escaped_link");
    }
  }
}

function checkDocumentation(root: string): void {
  const read = (path: string): string => execFileSync("git", ["show", `HEAD:${path}`], { cwd: root, encoding: "utf8", timeout: 60_000 });
  const readme = read("README.md"), provenance = read("docs/CODEX-DEVELOPMENT.md"), readiness = read("docs/SUBMISSION-READINESS.md"), notices = read("THIRD_PARTY_NOTICES.md"), license = read("LICENSE");
  const lock = JSON.parse(read("package-lock.json")) as { packages?: Record<string, { version?: string; license?: string }> };
  if (count(provenance, feedbackId) !== 1 || count(readiness, feedbackId) !== 1) throw new Error("feedback_id_placement");
  for (const required of ["Zero-credential judge path", "Supported platform and prerequisites", "Codex, GPT-5.6, and human decisions", "Telemetry and efficiency semantics", "License and third-party software", "not provider API request latency"]) if (!readme.includes(required)) throw new Error("required_readme_content");
  if (stalePublic.test(`${readme}\n${provenance}\n${readiness}`)) throw new Error("stale_public_claim");
  for (const required of ["yaml 2.9.0", "ISC", "TypeScript 5.9.3", "Apache-2.0", "@types/node", "undici-types"]) if (!notices.includes(required)) throw new Error("third_party_notice_mismatch");
  if (!license.includes("MIT License")) throw new Error("license_mismatch");
  const plainNotices = notices.replace(/`/g, "").toLowerCase();
  for (const [name, version, packageLicense] of [["yaml", "2.9.0", "ISC"], ["typescript", "5.9.3", "Apache-2.0"], ["@types/node", "24.13.3", "MIT"], ["undici-types", "7.18.2", "MIT"]]) {
    const entry = lock.packages?.[`node_modules/${name}`];
    if (entry?.version !== version || entry.license !== packageLicense || !plainNotices.includes(`${name} ${version}`.toLowerCase())) throw new Error("third_party_notice_mismatch");
  }
}

/** Bounded offline publication-readiness verification. */
export async function submissionPreflight(options: SubmissionPreflightOptions = {}): Promise<SubmissionPreflightResult> {
  const root = options.root ?? rootDefault, checks: SubmissionCheck[] = [];
  const run = async (id: string, action: () => Promise<void> | void): Promise<void> => {
    try { await action(); checks.push({ id, status: "passed", classification: "completed" }); }
    catch (error) { checks.push({ id, status: "failed", classification: error instanceof Error ? error.message : "failed" }); }
  };
  await run("git_clean", () => { if (git(root, ["status", "--porcelain", "--untracked-files=all"]).trim()) throw new Error("working_tree_dirty"); });
  await run("documentation", () => checkDocumentation(root));
  await run("tracked_tree", () => checkTrackedTree(root));
  await run("reachable_history", () => checkReachableHistory(root));
  await run("links", async () => checkLinks(root, await trackedFiles(root)));
  await run("demo_verify", async () => { if ((await (options.verify ?? verifyReport)(join(root, "examples", "demo-run"))).status !== "VERIFIED") throw new Error("demo_not_verified"); });
  await run("pages_stage", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "arena-submission-"));
    try { await (options.stage ?? stagePagesSample)(join(root, "examples", "demo-run"), join(temporary, "pages")); }
    finally { await rm(temporary, { recursive: true, force: true }); }
  });
  if (!options.skip_clean) await run("clean_install", async () => { if ((await (options.clean ?? verifyClean)({ root })).status !== "VERIFIED") throw new Error("clean_verification_failed"); });
  return { status: checks.every((check) => check.status === "passed") ? "READY" : "FAILED", checks };
}

if (require.main === module) submissionPreflight().then((result) => {
  for (const check of result.checks) console.log(`${check.status === "passed" ? "[ok]" : "[failed]"} ${check.id}: ${check.classification}`);
  console.log(result.status); process.exitCode = result.status === "READY" ? 0 : 1;
}).catch(() => { console.error("submission preflight failed"); process.exitCode = 1; });
