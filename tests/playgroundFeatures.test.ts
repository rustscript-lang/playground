import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { EXPECTED_RSS_EXAMPLE_FILES, rssExamplePath } from "./rssExampleCorpus";
import { installBuiltWasm, namedLines, outputLines, runUntilHalted } from "./wasmExampleHarness";
import { lintWithWasm, resetPlaygroundWasmForTests } from "../src/wasmRuntime";

const mainSource = await Bun.file(new URL("../src/main.ts", import.meta.url)).text();
const configSource = await Bun.file(new URL("../src/playgroundConfig.ts", import.meta.url)).text();
const shellSource = await Bun.file(new URL("../src/playgroundShell.ts", import.meta.url)).text();
const styleSource = await Bun.file(new URL("../src/style.css", import.meta.url)).text();

/**
 * Every named contract line the canonical Unit/Option/Result example prints.
 * Mirrors the Core contract so a playground-only regression cannot hide.
 */
const OPTION_RESULT_EXPECTED: Record<string, string> = {
  unit_literal: "()",
  unit_fn_returns_unit: "()",
  unit_explicit_annotation: "()",
  unit_roundtrip: "()",
  option_some_zero: "0",
  option_none: "-1",
  option_some_false: "false",
  option_some_empty_is_empty: "true",
  option_match_none: "-2",
  option_map: "1",
  option_and_then: "2",
  option_or_else: "5",
  option_unwrap_or_else: "4",
  option_relay_some: "2",
  option_relay_none: "-1",
  result_is_ok: "true",
  result_is_err: "true",
  result_match_ok: "21",
  result_match_err: "bad input",
  result_chain_ok: "9",
  result_chain_err: "7",
  result_unwrap_or_ok: "11",
  result_unwrap_or_err: "30",
  result_unwrap_or_else_err: "42",
  result_forward_ok: "0",
  result_forward_err: "9",
  result_map_err_then_try: "7",
  result_ok_to_option: "21",
  result_err_to_option: "bad input",
  result_ok_err_is_none: "true",
  project_field: "crab",
  project_absent_key: "missing",
  project_present_key: "one",
  project_array_index: "20",
  project_string_index: "b",
  project_missing_string_index: "missing"
};

async function readExample(fileName: string): Promise<string> {
  return await Bun.file(rssExamplePath(fileName)).text();
}

describe("playground editor integrations", () => {
  test("loads the Monaco hover contribution when using the slim editor API", () => {
    expect(mainSource).toContain('from "monaco-editor/esm/vs/editor/editor.api"');
    expect(mainSource).toContain(
      'import "monaco-editor/esm/vs/editor/contrib/hover/browser/hoverContribution"'
    );
  });

  test("describes breakpoints without naming the editor implementation", () => {
    expect(shellSource).toContain(
      "Run or debug directly in wasm runtime with breakpoints, stepping controls, and hover variable inspect."
    );
    expect(shellSource).not.toContain("with Monaco breakpoints");
  });

  test("moves the program selector into a collapsible mobile tools window", () => {
    expect(shellSource).toContain('id="desktop-sample-slot"');
    expect(shellSource).toContain('id="mobile-sample-slot"');
    expect(shellSource).toContain('data-mobile-expanded="false"');
    expect(shellSource).toContain("setMobileExpanded");
    expect(styleSource).toContain('position: fixed;');
    expect(styleSource).toContain('height: 33.333dvh;');
  });

  test("uses a 16px editor font on mobile to avoid WebKit focus zoom", () => {
    expect(mainSource).toContain("const mobileEditorFontSize = 16;");
    expect(mainSource).toContain(
      "fontSize: mobileEditorQuery.matches ? mobileEditorFontSize : desktopEditorFontSize"
    );
    expect(mainSource).toContain('mobileEditorQuery.addEventListener("change"');
    expect(styleSource).toContain(".monaco-editor .ime-text-area");
    expect(styleSource).toContain("font-size: 16px !important;");
  });

  test("keeps the mobile app aligned with the visual viewport during keyboard panning", () => {
    expect(configSource).toContain("const offsetTop = viewport?.offsetTop ?? 0;");
    expect(configSource).toContain("VIEWPORT_OFFSET_TOP_CSS_VAR");
    expect(styleSource).toContain("transform: translateY(var(--pd-app-offset-top));");
    expect(mainSource).toContain(
      'window.visualViewport?.addEventListener("scroll", updateViewportHeightCssVar);'
    );
    expect(mainSource).not.toContain(
      'window.visualViewport?.addEventListener("scroll", refreshViewportLayout);'
    );
  });

  test("shows the standard lint hover when the mobile cursor enters an error span", () => {
    expect(mainSource).toContain("editor.onDidChangeCursorPosition");
    expect(mainSource).toContain("marker.severity !== monaco.MarkerSeverity.Error");
    expect(mainSource).toContain("editor.action.showHover");
    expect(mainSource).toContain('window.matchMedia("(max-width: 760px)")');
  });

  test("registers the Unit/Option/Result and callable-value examples in the selector", () => {
    expect(configSource).toContain('key: "option_result"');
    expect(configSource).toContain('./examples/rss-option-result-example.rss?raw');
    expect(configSource).toContain('key: "callable_values"');
    expect(configSource).toContain('./examples/rss-callable-values-example.rss?raw');
    expect(configSource).toContain('export const DEFAULT_RSS_PROGRAM_KEY: RssProgramKey = "complex";');
  });
});

describe("canonical RSS examples on the real wasm runtime", () => {
  const linesByFile: Record<string, string[]> = {};

  beforeAll(async () => {
    await installBuiltWasm();
  });

  afterAll(() => {
    resetPlaygroundWasmForTests();
  });

  test("compiles and runs every checked-in example without diagnostics", async () => {
    expect(EXPECTED_RSS_EXAMPLE_FILES).toHaveLength(7);

    for (const fileName of EXPECTED_RSS_EXAMPLE_FILES) {
      const source = await readExample(fileName);

      const lint = await lintWithWasm(source, "rustscript");
      expect(lint.diagnostics, fileName).toEqual([]);

      const report = await runUntilHalted(source);
      expect(report.error, fileName).toBeNull();
      expect(report.ok, fileName).toBe(true);
      expect(report.halted, fileName).toBe(true);
      expect(report.diagnostics, fileName).toEqual([]);

      const lines = outputLines(report);
      expect(lines.length, fileName).toBeGreaterThan(0);
      linesByFile[fileName] = lines;
    }

    expect(Object.keys(linesByFile)).toHaveLength(7);
  });

  test("option/result example prints every named contract line", () => {
    const lines = linesByFile["rss-option-result-example.rss"] ?? [];
    expect(lines).toHaveLength(Object.keys(OPTION_RESULT_EXPECTED).length);

    const actual = namedLines(lines);
    for (const [name, expected] of Object.entries(OPTION_RESULT_EXPECTED)) {
      expect(actual[name], `named line ${name}`).toBe(expected);
    }
  });

  test("callable values example completes all of its assertions", () => {
    const lines = linesByFile["rss-callable-values-example.rss"] ?? [];
    expect(lines).toEqual(["callable values: all assertions passed"]);
  });

  test("complex example keeps its formatted closure output", () => {
    const lines = linesByFile["rss-complex-example.rss"] ?? [];
    expect(lines.join("\n")).toContain("closure_value is  12");
  });

  test("ifft example keeps its reconstructed samples and total", () => {
    const lines = linesByFile["rss-ifft-example.rss"] ?? [];
    const summary = JSON.parse(lines[0] ?? "") as {
      samples: number[];
      imag_zero: boolean[];
      total_signal: number;
    };
    expect(summary.samples).toEqual([1, 2, 3, 4]);
    expect(summary.imag_zero).toEqual([true, true, true, true]);
    expect(summary.total_signal).toBe(10);
  });

  test("lru cache example keeps its report fields", () => {
    const lines = linesByFile["rss-lrucache-example.rss"] ?? [];
    const report = JSON.parse(lines[0] ?? "") as {
      newest_key: string;
      oldest_key: string;
      order: string[];
      total_visible_articles: number;
      visible_topics: string[];
    };
    expect(report.newest_key).toBe("build-ops");
    expect(report.oldest_key).toBe("world-news");
    expect(report.order).toEqual(["world-news", "breaking-alerts", "build-ops"]);
    expect(report.total_visible_articles).toBe(18);
    expect(report.visible_topics).toEqual(["world news", "breaking alerts", "build ops"]);
  });

  test("collections example keeps its aggregated counters", () => {
    const lines = linesByFile["rss-collections-iter-example.rss"] ?? [];
    const summary = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
    expect(summary.total_hits).toBe(420);
    expect(summary.retry_budget).toBe(10);
    expect(summary.config_mode).toBe("burst");
    expect(summary.scheduled_preview_count).toBe(2);
    expect(summary.slot_batch_count).toBe(2);
    expect(summary.hot_window_count).toBe(2);
    expect(typeof summary.unique_channel_count).toBe("number");
  });

  test("strings and regex example keeps its rewritten log summary", () => {
    const lines = linesByFile["rss-strings-regex-example.rss"] ?? [];
    const summary = JSON.parse(lines[0] ?? "") as {
      levels: string[];
      first_section: string;
      slow_routes: string[];
      warn_message: string;
      error_id: string;
      error_word_count: number;
    };
    expect(summary.levels).toEqual(["INFO", "WARN", "ERROR"]);
    expect(summary.first_section).toBe("world");
    expect(summary.slow_routes).toEqual(["rss::markets", "feed::culture"]);
    expect(summary.warn_message).toContain("edge-cache");
    expect(summary.error_id).toBe("77");
    expect(summary.error_word_count).toBe(3);
  });
});
