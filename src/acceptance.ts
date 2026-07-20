import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Script, createContext } from "node:vm";
import * as ts from "typescript";

export interface FractionalPriceAcceptance {
  validator: "fractional-price";
  status: "passed" | "failed" | "not_applicable";
  expected: number;
  actual?: number;
  error?: string;
}

const sourceRelativePath = join("fixtures", "bounded-inventory", "src", "inventory.ts");

export async function validateFractionalPrice(worktree: string): Promise<FractionalPriceAcceptance> {
  const source = await readFile(join(worktree, sourceRelativePath), "utf8").catch(() => undefined);
  const expected = 2.83;
  if (source === undefined) return { validator: "fractional-price", status: "not_applicable", expected };

  try {
    const module = { exports: {} as Record<string, unknown> };
    const context = createContext({ module, exports: module.exports });
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Script(output).runInContext(context, { timeout: 1000 });
    const inventoryTotal = module.exports.inventoryTotal;
    if (typeof inventoryTotal !== "function") throw new Error("inventoryTotal export is missing");
    const actual = (inventoryTotal as (lines: Array<{ quantity: number; unitPrice: number }>) => number)([
      { quantity: 2, unitPrice: 1.25 },
      { quantity: 1, unitPrice: 0.33 }
    ]);
    return { validator: "fractional-price", status: actual === expected ? "passed" : "failed", expected, actual };
  } catch (error) {
    return { validator: "fractional-price", status: "failed", expected, error: error instanceof Error ? error.message : String(error) };
  }
}
