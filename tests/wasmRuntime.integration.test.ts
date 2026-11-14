import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  EXPECTED_RSS_EXAMPLE_COUNT,
  EXPECTED_RSS_EXAMPLE_FILES,
  rssExamplePath
} from "./rssExampleCorpus";
import {
  installBuiltWasm,
  namedLines,
  outputLines,
  requireBuiltWasm,
  runUntilHalted
} from "./wasmExampleHarness";
import {
  collectUnsupportedWasmImports,
  completionCatalogWithWasm,
  resetPlaygroundWasmForTests,
  runWithWasm
} from "../src/wasmRuntime";

describe("playground wasm runtime integration", () => {
  beforeAll(async () => {
    const bytes = await installBuiltWasm();
    const wasmModule = await WebAssembly.compile(bytes);
    expect(collectUnsupportedWasmImports(wasmModule)).toEqual([]);
    const imports = WebAssembly.Module.imports(wasmModule);
    expect(imports).toHaveLength(1);
    expect(imports[0]?.module).toBe("env");
    expect(imports[0]?.name).toBe("pd_playground_now_ms");
    expect(imports[0]?.kind).toBe("function");
  });

  afterAll(() => {
    resetPlaygroundWasmForTests();
  });

  test("ships the pinned wasm artifact", () => {
    expect(() => requireBuiltWasm()).not.toThrow();
  });

  test("enumerates and runs exactly seven checked-in RSS examples on one reused VM", async () => {
    expect(EXPECTED_RSS_EXAMPLE_FILES).toHaveLength(EXPECTED_RSS_EXAMPLE_COUNT);
    const outputs: Record<string, string[]> = {};

    for (const fileName of EXPECTED_RSS_EXAMPLE_FILES) {
      const source = await Bun.file(rssExamplePath(fileName)).text();
      const report = await runUntilHalted(source);
      expect(report.error, fileName).toBeNull();
      expect(report.ok, fileName).toBe(true);
      expect(report.halted, fileName).toBe(true);
      expect(report.diagnostics, fileName).toEqual([]);
      expect(report.output.length, fileName).toBeGreaterThan(0);
      outputs[fileName] = outputLines(report);
    }

    expect(Object.keys(outputs)).toHaveLength(EXPECTED_RSS_EXAMPLE_COUNT);
    expect(outputs["rss-complex-example.rss"]?.join("\n")).toContain("closure_value is  12");

    const optionResult = namedLines(outputs["rss-option-result-example.rss"] ?? []);
    expect(optionResult["unit_literal"]).toBe("()");
    expect(optionResult["option_some_zero"]).toBe("0");
    expect(optionResult["option_relay_none"]).toBe("-1");
    expect(optionResult["result_map_err_then_try"]).toBe("7");
    expect(optionResult["project_field"]).toBe("crab");
    expect(optionResult["project_missing_string_index"]).toBe("missing");

    expect(outputs["rss-callable-values-example.rss"]).toEqual([
      "callable values: all assertions passed"
    ]);

    for (const fileName of EXPECTED_RSS_EXAMPLE_FILES) {
      if (
        fileName === "rss-complex-example.rss" ||
        fileName === "rss-option-result-example.rss" ||
        fileName === "rss-callable-values-example.rss"
      ) {
        continue;
      }
      expect(() => JSON.parse(outputs[fileName]?.[0] ?? ""), fileName).not.toThrow();
    }
  });

  test("resets between a failing program and a later successful example", async () => {
    const failed = await runWithWasm("let value = ;", "rustscript", {
      fuel: null,
      fuelCheckInterval: null
    });
    expect(failed.ok).toBe(false);
    expect(failed.halted).toBe(true);
    expect(failed.diagnostics.length).toBeGreaterThan(0);

    const source = await Bun.file(rssExamplePath("rss-ifft-example.rss")).text();
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
