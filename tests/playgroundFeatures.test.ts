import { describe, expect, test } from "bun:test";

const mainSource = await Bun.file(new URL("../src/main.ts", import.meta.url)).text();
const configSource = await Bun.file(new URL("../src/playgroundConfig.ts", import.meta.url)).text();
const shellSource = await Bun.file(new URL("../src/playgroundShell.ts", import.meta.url)).text();
const styleSource = await Bun.file(new URL("../src/style.css", import.meta.url)).text();

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
    expect(mainSource).toContain('editor.onDidChangeCursorPosition');
    expect(mainSource).toContain('marker.severity !== monaco.MarkerSeverity.Error');
    expect(mainSource).toContain('editor.action.showHover');
    expect(mainSource).toContain('window.matchMedia("(max-width: 760px)")');
  });
});
