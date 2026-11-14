import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  collectUnsupportedWasmImports,
  installPlaygroundWasmFromBytes,
  runCommandWithWasm,
  runWithWasm,
  type FuelConfig,
  type RunReport
} from "../src/wasmRuntime";

export const WASM_PATH = resolve(import.meta.dir, "../public/wasm/pd_vm_wasm.wasm");

export const IDLE_FUEL: FuelConfig = {
  fuel: null,
  fuelCheckInterval: null
};

/** Reads the artifact produced by `bun run build:wasm-playground`. */
export function requireBuiltWasm(): Uint8Array {
  if (!existsSync(WASM_PATH)) {
    throw new Error(
      `playground wasm missing at ${WASM_PATH}; run bun run build:wasm-playground against the pinned core`
    );
  }
  return new Uint8Array(readFileSync(WASM_PATH));
}

/** Compiles, import-checks, and installs the built wasm for the current test file. */
export async function installBuiltWasm(): Promise<Uint8Array> {
  const bytes = requireBuiltWasm();
  const wasmModule = await WebAssembly.compile(bytes);
  const unsupported = collectUnsupportedWasmImports(wasmModule);
  if (unsupported.length > 0) {
    throw new Error(`unsupported playground wasm imports: ${JSON.stringify(unsupported)}`);
  }
  await installPlaygroundWasmFromBytes(bytes);
  return bytes;
}

/** Drives the resumable run session until the program halts. */
export async function runUntilHalted(source: string): Promise<RunReport> {
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

/** Flattens print output into trimmed, non-empty lines. */
export function outputLines(report: RunReport): string[] {
  return report.output
    .flatMap((entry) => entry.split("\n"))
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Parses `name=value` contract lines into a lookup map. */
export function namedLines(lines: string[]): Record<string, string> {
  const named: Record<string, string> = {};
  for (const line of lines) {
    const separator = line.indexOf("=");
    if (separator <= 0) {
      throw new Error(`example output line '${line}' should be a named contract line`);
    }
    named[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return named;
}
