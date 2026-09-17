import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  EXPECTED_RSS_EXAMPLE_COUNT,
  EXPECTED_RSS_EXAMPLE_FILES,
  rssExamplePath
} from "./rssExampleCorpus";
import {
  collectUnsupportedWasmImports,
  completionCatalogWithWasm,
  installPlaygroundWasmFromBytes,
  lintWithWasm,
  resetPlaygroundWasmForTests,
  runCommandWithWasm,
  runWithWasm,
  type FuelConfig,
  type RunReport
} from "../src/wasmRuntime";

const WASM_PATH = resolve(import.meta.dir, "../public/wasm/pd_vm_wasm.wasm");
const IDLE_FUEL: FuelConfig = {
  fuel: null,
  fuelCheckInterval: null
};

function requireBuiltWasm(): Uint8Array {
  if (!existsSync(WASM_PATH)) {
    throw new Error(
      `playground wasm missing at ${WASM_PATH}; run bun run build:wasm-playground against the pinned core`
    );
  }
  return new Uint8Array(readFileSync(WASM_PATH));
}

async function runUntilHalted(source: string): Promise<RunReport> {
  let report = await runWithWasm(source, "rustscript", IDLE_FUEL);
  const started = Date.now();
  while (!report.halted && report.error === null) {
    if (Date.now() - started > 8_000) {
      throw new Error(`timed out waiting for playground wasm run to halt: ${report.commandOutput}`);
    }
    if (!report.yielded) {
      await Bun.sleep(15);
    }
    report = await runCommandWithWasm({ kind: "resume" });
  }
  return report;
}

describe("playground wasm runtime integration", () => {
  beforeAll(async () => {
    const bytes = requireBuiltWasm();
    const wasmModule = await WebAssembly.compile(bytes);
    expect(collectUnsupportedWasmImports(wasmModule)).toEqual([]);
    const imports = WebAssembly.Module.imports(wasmModule);
    expect(imports).toHaveLength(1);
    expect(imports[0]?.module).toBe("env");
    expect(imports[0]?.name).toBe("pd_playground_now_ms");
    expect(imports[0]?.kind).toBe("function");
    await installPlaygroundWasmFromBytes(bytes);
  });

  afterAll(() => {
    resetPlaygroundWasmForTests();
  });

  test("enumerates and runs exactly five checked-in RSS examples on one reused VM", async () => {
    expect(EXPECTED_RSS_EXAMPLE_FILES).toHaveLength(EXPECTED_RSS_EXAMPLE_COUNT);
    const outputs: Record<string, string[]> = {};

    for (const fileName of EXPECTED_RSS_EXAMPLE_FILES) {
      const source = readFileSync(rssExamplePath(fileName), "utf8");
      const lint = await lintWithWasm(source, "rustscript");
      expect(lint.diagnostics, fileName).toEqual([]);

      const report = await runUntilHalted(source);
      expect(report.error, fileName).toBeNull();
      expect(report.ok, fileName).toBe(true);
      expect(report.halted, fileName).toBe(true);
      expect(report.diagnostics, fileName).toEqual([]);
      expect(report.output.length, fileName).toBeGreaterThan(0);
      outputs[fileName] = report.output;
    }

    expect(Object.keys(outputs)).toHaveLength(EXPECTED_RSS_EXAMPLE_COUNT);
    expect(outputs["rss-complex-example.rss"]?.join("\n")).toContain("closure_value is");
    for (const fileName of EXPECTED_RSS_EXAMPLE_FILES) {
      if (fileName === "rss-complex-example.rss") {
        continue;
      }
      expect(() => JSON.parse(outputs[fileName][0] ?? ""), fileName).not.toThrow();
    }
  });

  test("resets between a failing program and a later successful example", async () => {
    const failed = await runWithWasm("let value = ;", "rustscript", IDLE_FUEL);
    expect(failed.ok).toBe(false);
    expect(failed.halted).toBe(true);
    expect(failed.diagnostics.length).toBeGreaterThan(0);

    const source = readFileSync(rssExamplePath("rss-ifft-example.rss"), "utf8");
    const recovered = await runUntilHalted(source);
    expect(recovered.ok).toBe(true);
    expect(recovered.error).toBeNull();
    expect(recovered.diagnostics).toEqual([]);
    expect(recovered.output[0]).toContain("{");
  });

  test("exposes a typed host completion catalog under the frozen core", async () => {
    const catalog = await completionCatalogWithWasm();
    expect(Array.isArray(catalog.rustscript)).toBe(true);
    expect(Array.isArray(catalog.javascript)).toBe(true);
    expect(Array.isArray(catalog.lua)).toBe(true);
    expect(Array.isArray(catalog.scheme)).toBe(true);
    expect(catalog.rustscript.length).toBeGreaterThan(0);
    expect(catalog.javascript.length).toBeGreaterThan(0);
    expect(catalog.lua.length).toBeGreaterThan(0);

    const rustscriptLabels = catalog.rustscript.map((entry) => entry.label);
    expect(rustscriptLabels).toContain("print");
    expect(rustscriptLabels).toContain("runtime::sleep");
    expect(catalog.rustscript.every((entry) => entry.kind === "function")).toBe(true);

    const fingerprint = rustscriptLabels.slice().sort().join("\n");
    expect(fingerprint).toContain("json::encode");
    expect(fingerprint).toContain("re::match");
  });
});
