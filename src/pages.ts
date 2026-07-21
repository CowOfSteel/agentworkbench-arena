import { lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { verifyReport } from "./report";

const rootFiles = new Set(["manifest.json", "task-contract.json", "trial-snapshot.json", "identity-map.json", "evaluation.json", "adjudication.json", "judge-result.json", "sample-metadata.json", "recommendation.yml", "README.md"]);
const candidateFiles = new Set(["provenance.json", "telemetry.json", "validation.json", "candidate.diff"]);
const unsafe = /(?:(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/]|file:\/\/|\/(?:Users|home|private|mnt|opt|var)\/|(?:access[_ -]?token|api[_ -]?key|password|secret|credential|account[_ -]?(?:id|email)|session[_ -]?(?:id|token))\s*[:=]|\b(?:gh[pousr]_[A-Za-z0-9_]{12,}|sk-[A-Za-z0-9_-]{12,}|xox[baprs]-[A-Za-z0-9-]{12,}|AIza[A-Za-z0-9_-]{20,})\b)/i;

const confined = (root: string, target: string): boolean => { const value = relative(root, target); return value !== "" && !value.startsWith("..") && !isAbsolute(value); };
const comparable = (path: string): string => {
  const normalized = path.replace(/^[\\/]{2}\?[\\/]/, "");
  return process.platform === "win32" ? normalized.toLocaleLowerCase() : normalized;
};
const nested = (parent: string, child: string): boolean => { const value = relative(comparable(parent), comparable(child)); return value !== "" && !value.startsWith("..") && !isAbsolute(value); };

async function rejectSymlinkAncestry(path: string): Promise<void> {
  for (let current = resolve(path); ; current = dirname(current)) {
    if ((await lstat(current)).isSymbolicLink()) throw new Error("Pages destination has an unsafe symlink relationship");
    if (dirname(current) === current) return;
  }
}

async function regularFile(path: string): Promise<void> {
  const entry = await lstat(path);
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("Pages source contains an unsafe artifact");
}

export interface PagesStageResult { directory: string; index: string; files: string[]; }

/** Reject text that cannot appear in a public report artifact. */
export function assertSafePublicArtifactText(content: string, forbiddenValues: string[] = []): string {
  if (unsafe.test(content) || forbiddenValues.filter(Boolean).some((value) => content.toLocaleLowerCase().includes(value.toLocaleLowerCase()))) throw new Error("Pages source contains a secret or absolute path");
  return content;
}

/** Copy the report's explicit public evidence allowlist into a disposable Pages directory. */
export async function stagePagesSample(sourceDirectory: string, destinationDirectory: string): Promise<PagesStageResult> {
  const sourceRequested = resolve(sourceDirectory), sourceEntry = await lstat(sourceRequested).catch(() => null);
  if (!sourceEntry?.isDirectory() || sourceEntry.isSymbolicLink()) throw new Error("Pages source is unsafe");
  const source = await realpath(sourceRequested), destinationRequested = resolve(destinationDirectory), destinationEntry = await lstat(destinationRequested).catch(() => null);
  if (destinationEntry) throw new Error("Pages destination must not already exist");
  const parentRequested = dirname(destinationRequested); await rejectSymlinkAncestry(parentRequested);
  const parent = await realpath(parentRequested).catch(() => null);
  if (!parent) throw new Error("Pages destination has an unsafe symlink relationship");
  const destination = join(parent, basename(destinationRequested));
  if (comparable(source) === comparable(destination) || nested(source, destination) || nested(destination, source)) throw new Error("Pages destination is unsafe");
  const verified = await verifyReport(source);
  if (verified.status !== "VERIFIED") throw new Error("Pages source report must verify before staging");
  const names = await readdir(source, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of names) {
    if (entry.name === "report.html") { files.push("index.html"); continue; }
    if (rootFiles.has(entry.name)) { files.push(entry.name); continue; }
    if (entry.name === "candidates" && entry.isDirectory()) {
      for (const candidate of await readdir(join(source, entry.name), { withFileTypes: true })) {
        if (!candidate.isDirectory() || candidate.isSymbolicLink()) throw new Error("Pages source contains an unsafe candidate directory");
        for (const artifact of await readdir(join(source, entry.name, candidate.name), { withFileTypes: true })) {
          if (!candidateFiles.has(artifact.name) || !artifact.isFile() || artifact.isSymbolicLink()) throw new Error("Pages source contains an unapproved candidate artifact");
          files.push(`candidates/${candidate.name}/${artifact.name}`);
        }
      }
    }
  }
  files.sort();
  if (!files.includes("index.html")) throw new Error("Pages source report is missing");
  let created = false;
  try {
    await mkdir(destination); created = true;
    for (const relativePath of files) {
      const sourcePath = relativePath === "index.html" ? join(source, "report.html") : join(source, ...relativePath.split("/"));
      await regularFile(sourcePath);
      const content = await readFile(sourcePath, "utf8");
      assertSafePublicArtifactText(content);
      const target = join(destination, ...relativePath.split("/"));
      if (!confined(destination, target)) throw new Error("Pages path escapes staging directory");
      await mkdir(join(target, ".."), { recursive: true });
      await writeFile(target, content, "utf8");
    }
  } catch (error) { if (created) await rm(destination, { recursive: true, force: true }); throw error; }
  return { directory: destination, index: join(destination, "index.html"), files };
}
