import { lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { verifyReport } from "./report";

const rootFiles = new Set(["manifest.json", "task-contract.json", "trial-snapshot.json", "identity-map.json", "evaluation.json", "adjudication.json", "judge-result.json", "sample-metadata.json", "recommendation.yml", "README.md"]);
const candidateFiles = new Set(["provenance.json", "telemetry.json", "validation.json", "candidate.diff"]);
const unsafe = /(?:(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/]|file:\/\/|\/(?:Users|home)\/|(?:access[_ -]?token|api[_ -]?key|password|secret|credential)\s*[:=])/i;

const confined = (root: string, target: string): boolean => { const value = relative(root, target); return value !== "" && !value.startsWith("..") && !isAbsolute(value); };

async function regularFile(path: string): Promise<void> {
  const entry = await lstat(path);
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("Pages source contains an unsafe artifact");
}

export interface PagesStageResult { directory: string; index: string; files: string[]; }

/** Copy the report's explicit public evidence allowlist into a disposable Pages directory. */
export async function stagePagesSample(sourceDirectory: string, destinationDirectory: string): Promise<PagesStageResult> {
  const source = await realpath(resolve(sourceDirectory)), destination = resolve(destinationDirectory);
  if (source === destination || !confined(resolve(destination, ".."), destination)) throw new Error("Pages destination is unsafe");
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
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  for (const relativePath of files) {
    const sourcePath = relativePath === "index.html" ? join(source, "report.html") : join(source, ...relativePath.split("/"));
    await regularFile(sourcePath);
    const content = await readFile(sourcePath, "utf8");
    if (unsafe.test(content)) throw new Error("Pages source contains a secret or absolute path");
    const target = join(destination, ...relativePath.split("/"));
    if (!confined(destination, target)) throw new Error("Pages path escapes staging directory");
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  return { directory: destination, index: join(destination, "index.html"), files };
}
