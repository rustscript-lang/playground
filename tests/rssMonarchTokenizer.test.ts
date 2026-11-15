import { describe, expect, test } from "bun:test";

import { createRustScriptMonarchLanguage } from "../src/monaco/rustscriptLanguage";
import { EXPECTED_RSS_EXAMPLE_FILES, rssExamplePath } from "./rssExampleCorpus";

/**
 * Tokenizes real RustScript source with Monaco's own Monarch compiler, so these tests cover
 * what the playground editor actually renders instead of only the TextMate JSON regexes.
 * `monarchCompile` is a Monaco internal: if a future monaco-editor upgrade moves it the import
 * below fails loudly, which is the intended signal to re-point it.
 */
const { compile } = (await import(
  "monaco-editor/esm/vs/editor/standalone/common/monarch/monarchCompile.js"
)) as unknown as { compile: (languageId: string, json: unknown) => CompiledLexer };

type CompiledAction = string | { token?: string; next?: string } | { group: CompiledAction[] };

type CompiledRule = {
  matchOnlyAtLineStart: boolean;
  action: CompiledAction;
  resolveRegex(state: string): RegExp;
};

type CompiledLexer = {
  tokenizer: Record<string, CompiledRule[]>;
};

type TokenSpan = {
  token: string;
  value: string;
  start: number;
  end: number;
};

const lexer = compile("rustscript", createRustScriptMonarchLanguage());

function tokenOf(action: CompiledAction): string {
  if (typeof action === "string") {
    return action;
  }
  if (typeof action === "object" && "token" in action && typeof action.token === "string") {
    return action.token;
  }
  return "";
}

function groupOf(action: CompiledAction): CompiledAction[] | null {
  if (typeof action === "object" && "group" in action && Array.isArray(action.group)) {
    return action.group;
  }
  return null;
}

function collectTokens(rule: CompiledRule, matches: RegExpExecArray, offset: number, spans: TokenSpan[]): void {
  const group = groupOf(rule.action);
  if (group) {
    // Monaco refuses rules where the action count does not line up with the capture groups.
    expect(group).toHaveLength(matches.length - 1);
    let cursor = offset;
    for (let index = 1; index < matches.length; index += 1) {
      const token = tokenOf(group[index - 1]);
      const value = matches[index] ?? "";
      if (token.length > 0 && value.length > 0) {
        spans.push({ token, value, start: cursor, end: cursor + value.length });
      }
      cursor += value.length;
    }
    return;
  }

  const token = tokenOf(rule.action);
  if (token.length > 0 && matches[0].length > 0) {
    spans.push({ token, value: matches[0], start: offset, end: offset + matches[0].length });
  }
}

function applyTransition(rule: CompiledRule, state: string, stack: string[]): void {
  // Monarch drops a rule's third element for grouped (array/group) actions, so only plain
  // actions can switch state. Mirroring that keeps these tests honest about the editor.
  if (groupOf(rule.action)) {
    return;
  }
  const next = typeof rule.action === "object" && "next" in rule.action ? rule.action.next : undefined;
  if (typeof next !== "string") {
    return;
  }
  if (next === "@pop") {
    if (stack.length > 1) {
      stack.pop();
    }
    return;
  }
  if (next === "@push") {
    stack.push(state);
    return;
  }
  if (next === "@popall") {
    stack.length = 1;
    return;
  }
  stack.push(next.startsWith("@") ? next.slice(1) : next);
}

function tokenizeSpans(line: string, initialState = "root"): TokenSpan[] {
  const stack = [initialState];
  const spans: TokenSpan[] = [];
  let offset = 0;
  let guard = 0;

  while (offset < line.length) {
    guard += 1;
    if (guard > line.length * 20) {
      throw new Error(`Monarch tokenizer made no progress on ${JSON.stringify(line)}`);
    }

    const state = stack[stack.length - 1];
    const rules = lexer.tokenizer[state];
    if (!rules) {
      throw new Error(`unknown tokenizer state ${state}`);
    }

    const restOfLine = line.slice(offset);
    let advanced = false;
    for (const rule of rules) {
      if (offset !== 0 && rule.matchOnlyAtLineStart) {
        continue;
      }
      const matches = rule.resolveRegex(state).exec(restOfLine);
      if (!matches) {
        continue;
      }
      collectTokens(rule, matches, offset, spans);
      applyTransition(rule, state, stack);
      offset += matches[0].length === 0 ? 1 : matches[0].length;
      advanced = true;
      break;
    }

    if (!advanced) {
      offset += 1;
    }
  }

  return spans;
}

function tokenize(line: string): Array<{ token: string; value: string }> {
  return tokenizeSpans(line).map(({ token, value }) => ({ token, value }));
}

function unitTokens(line: string): Array<{ token: string; value: string }> {
  return tokenize(line).filter((token) => token.token === "constant.language.unit");
}

/** Unit tokens that sit right behind a callee, i.e. the exact `foo()` regression we guard. */
function unitTokensAfterCallee(line: string): TokenSpan[] {
  return tokenizeSpans(line).filter(
    (span) => span.token === "constant.language.unit" && /[A-Za-z0-9_]/.test(line.slice(0, span.start).slice(-1))
  );
}

/**
 * Counts the capturing groups in a compiled Monarch rule, so a rule's action list can be checked
 * against its pattern without having to guess an input that makes it match. Monarch throws
 * `matched number of groups does not match the number of actions` when they disagree.
 */
function captureGroupCount(source: string): number {
  let count = 0;
  let inCharacterClass = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (inCharacterClass) {
      if (char === "]") {
        inCharacterClass = false;
      }
      continue;
    }
    if (char === "[") {
      inCharacterClass = true;
      continue;
    }
    if (char !== "(") {
      continue;
    }
    if (source[index + 1] !== "?") {
      count += 1;
      continue;
    }
    // `(?:`, `(?=`, `(?!` are non-capturing; `(?<name>` is.
    const named = source[index + 2] === "<" && source[index + 3] !== "=" && source[index + 3] !== "!";
    if (named) {
      count += 1;
    }
  }

  return count;
}

describe("RustScript Monarch tokenizer", () => {
  test("keeps every grouped rule's actions aligned with its capture groups", () => {
    const mismatches: string[] = [];
    const groupedRules: CompiledRule[] = [];

    for (const [state, rules] of Object.entries(lexer.tokenizer)) {
      for (const rule of rules) {
        const group = groupOf(rule.action);
        if (!group) {
          continue;
        }
        groupedRules.push(rule);
        const source = rule.resolveRegex(state).source;
        const captures = captureGroupCount(source);
        if (captures !== group.length) {
          mismatches.push(`${state}: ${group.length} actions for ${captures} capture groups in ${source}`);
        }
      }
    }

    expect(groupedRules.length).toBeGreaterThan(0);
    expect(mismatches).toEqual([]);

    // The two generic empty-parameter headers must stay present *and* aligned (7 and 9 actions).
    const genericHeadRules = lexer.tokenizer["root"].filter((rule) => {
      const source = rule.resolveRegex("root").source;
      return source.includes("(fn)") && source.includes("(\\(\\))");
    });
    expect(genericHeadRules.map((rule) => groupOf(rule.action)?.length).sort()).toEqual([7, 9]);
    for (const rule of genericHeadRules) {
      expect(captureGroupCount(rule.resolveRegex("root").source)).toBe(groupOf(rule.action)?.length);
    }
  });

  test("tokenizes generic fn headers with an empty parameter list", () => {
    const cases: Array<{ line: string; generic: string; isPublic: boolean }> = [
      { line: "fn wrap<T>()", generic: "<T>", isPublic: false },
      { line: "fn wrap<T> ()", generic: "<T>", isPublic: false },
      { line: "fn wrap<K, V>()", generic: "<K, V>", isPublic: false },
      { line: "fn wrap<Option<int>>()", generic: "<Option<int>>", isPublic: false },
      { line: "pub fn wrap<T>()", generic: "<T>", isPublic: true }
    ];

    for (const { line, generic, isPublic } of cases) {
      const expected = [
        ...(isPublic ? [{ token: "keyword", value: "pub" }] : []),
        { token: "keyword", value: "fn" },
        { token: "function", value: "wrap" },
        { token: "type.identifier", value: generic },
        { token: "delimiter", value: "()" }
      ];
      expect({ line, tokens: tokenize(line) }).toEqual({ line, tokens: expected });

      // The `()` belongs to the declaration signature, never to the Unit literal or a call.
      expect(unitTokens(line)).toEqual([]);
      expect(tokenize(line).filter((token) => token.token === "function")).toEqual([
        { token: "function", value: "wrap" }
      ]);

      // The head is claimed in one rule that stays in `root`, so the body still tokenizes.
      const withBody = tokenize(`${line} {`);
      expect(withBody).toEqual([...expected, { token: "delimiter", value: "{" }]);
    }

    // A parameterized generic head keeps its existing path (fn rule, then the `<`/`(` states).
    expect(tokenize("fn wrap<T>(value: T) {")).toContainEqual({ token: "function", value: "wrap" });
  });

  test("does not scope null as a keyword or a function", () => {
    for (const line of [
      "let a = null;",
      "let fallback = null;",
      "assert(value == null);",
      "assert(null() == null);",
      "let called = null();"
    ]) {
      const tokens = tokenize(line).filter((token) => token.value === "null");
      expect(tokens).toEqual([]);
      expect(tokenize(line)).not.toContainEqual({ token: "keyword", value: "null" });
      expect(tokenize(line)).not.toContainEqual({ token: "function", value: "null" });
    }

    // `null` is consumed whole, so its tail can never be picked up as a callee.
    const nullCall = tokenize("assert(null());");
    expect(nullCall.filter((token) => token.token === "function")).toEqual([
      { token: "function", value: "assert" }
    ]);
    expect(nullCall).toEqual([
      { token: "function", value: "assert" },
      { token: "delimiter", value: "(" },
      { token: "delimiter", value: "()" },
      { token: "delimiter", value: ")" },
      { token: "delimiter", value: ";" }
    ]);
    expect(nullCall).not.toContainEqual({ token: "constant.language.unit", value: "()" });

    const keywordNullRules = lexer.tokenizer["root"].filter((rule) => {
      const matches = rule.resolveRegex("root").exec("null");
      return matches?.[0] === "null" && tokenOf(rule.action) === "keyword";
    });
    expect(keywordNullRules).toEqual([]);
  });

  test("scopes a standalone Unit literal without swallowing empty argument lists", () => {
    expect(unitTokens("let unit:() = ();")).toEqual([
      { token: "constant.language.unit", value: "()" },
      { token: "constant.language.unit", value: "()" }
    ]);

    // A call's empty argument list stays a call: no Unit token behind the callee.
    const zeroArgumentCalls = [
      "let unit_from_fn:() = nothing();",
      "let unit_from_explicit:() = explicit_unit();",
      "fn make_counter() {",
      "let copied = next_nodes[tail].copy();",
      "let pi = math::pi();",
      "let spaced_call = read_answer () == 42;"
    ];
    for (const line of zeroArgumentCalls) {
      expect(unitTokensAfterCallee(line)).toEqual([]);
      expect(tokenize(line)).toContainEqual({ token: "delimiter", value: "()" });
    }

    // The Unit in type position still highlights, the one in call position does not.
    expect(unitTokens("let unit_from_fn:() = nothing();")).toEqual([{ token: "constant.language.unit", value: "()" }]);
    expect(tokenize("let unit_from_fn:() = nothing();")).toContainEqual({ token: "function", value: "nothing" });

    expect(unitTokens("fn make_counter() {")).toEqual([]);
    expect(unitTokens("let unit = ();")).toEqual([{ token: "constant.language.unit", value: "()" }]);

    const memberCallTokens = tokenize("let copied = next_nodes[tail].copy();");
    expect(memberCallTokens).toContainEqual({ token: "variable", value: "copy" });
    expect(tokenize("let pi = math::pi() / 2.0;")).toContainEqual({ token: "function", value: "pi" });
    expect(unitTokens("let turbofish = apply::<int>(identity, 42);")).toEqual([]);
  });

  test("scopes bare Option constructors in expressions and match patterns", () => {
    const cases = [
      { line: "let some = Some(1);", constructors: ["Some"] },
      { line: "let none_variant: Option<int> = None;", constructors: ["None"] },
      { line: "match value { Some(x) => x, None => 0 }", constructors: ["Some", "None"] }
    ];
    for (const { line, constructors } of cases) {
      expect(tokenize(line).filter(({ token }) => token === "support.constant.constructor").map(({ value }) => value))
        .toEqual(constructors);
    }
    for (const line of ["Option::Some(1)", "Option::None", "Option :: Some(1)", "Option :: None", "Optional::Some(1)", "obj.None", "obj.Some(1)"]) {
      expect(tokenize(line).filter(({ token }) => token === "support.constant.constructor")).toEqual([]);
    }
    expect(tokenize("Some()")).toContainEqual({ token: "delimiter", value: "()" });
    expect(unitTokens("Some()")).toEqual([]);
  });

  test("keeps Result::Ok and Result::Err constructor scopes", () => {
    for (const [line, constructor] of [["Result::Ok(7)", "Ok"], ["Result::Err(\"bad\")", "Err"], ["Result::Ok()", "Ok"]]) {
      const tokens = tokenize(line);
      expect(tokens).toContainEqual({ token: "support.type", value: "Result" });
      expect(tokens).toContainEqual({ token: "punctuation.accessor", value: "::" });
      expect(tokens).toContainEqual({ token: "support.constant.constructor", value: constructor });
    }
    expect(unitTokens("Result::Ok()")).toEqual([]);
  });

  test("separates ? propagation from ?. optional access", () => {
    const propagation = tokenize("let item = checked(flag)?;");
    expect(propagation).toContainEqual({ token: "keyword.operator.propagation", value: "?" });
    expect(propagation).not.toContainEqual({ token: "keyword.operator.optional-access", value: "?." });

    const optionalAccess = tokenize("let name = record?.name;");
    expect(optionalAccess.filter((token) => token.value.includes("?."))).toEqual([
      { token: "keyword.operator.optional-access", value: "?." }
    ]);
    expect(optionalAccess).toContainEqual({ token: "variable", value: "name" });
    expect(optionalAccess).not.toContainEqual({ token: "keyword.operator.propagation", value: "?" });
    // `?.` must not be eaten by the member-access rule.
    expect(optionalAccess.filter((token) => token.token === "punctuation.accessor")).toEqual([]);

    const optionalIndex = tokenize("let bucket = table?.[\"b\"];");
    expect(optionalIndex).toContainEqual({ token: "keyword.operator.optional-access", value: "?." });
    expect(optionalIndex).not.toContainEqual({ token: "keyword.operator.propagation", value: "?" });
  });

  test("keeps ?. out of the member-access rule", () => {
    // Core's member-access pattern also accepts `?.`; the Monaco copy must not, otherwise
    // `a?.b` highlights as punctuation.accessor + variable and loses its optional-access token.
    const accessorRules = lexer.tokenizer["root"].filter((rule) =>
      (groupOf(rule.action) ?? []).some((action) => tokenOf(action) === "punctuation.accessor")
    );
    expect(accessorRules.length).toBeGreaterThan(0);
    for (const rule of accessorRules) {
      expect(rule.resolveRegex("root").exec("?.name")).toBeNull();
    }

    expect(tokenize("let a = b?.c;")).toEqual([
      { token: "keyword", value: "let" },
      { token: "identifier", value: "a" },
      { token: "operator", value: "=" },
      { token: "keyword.operator.optional-access", value: "?." },
      { token: "variable", value: "c" },
      { token: "delimiter", value: ";" }
    ]);
  });

  test("keeps member access, declarations and literals intact", () => {
    const memberAccess = tokenize("let row = entry.key;");
    expect(memberAccess).toContainEqual({ token: "punctuation.accessor", value: "." });
    expect(memberAccess).toContainEqual({ token: "variable", value: "key" });

    const declaration = tokenize("let mut detached: LruNode<K, V> = node;");
    expect(declaration).toContainEqual({ token: "keyword", value: "let" });
    expect(declaration).toContainEqual({ token: "keyword", value: "mut" });
    expect(declaration).toContainEqual({ token: "identifier", value: "detached" });
    expect(declaration).toContainEqual({ token: "delimiter", value: ":" });

    const functionDeclaration = tokenize("fn append_new_node<K, V>(nodes, head) {");
    expect(functionDeclaration).toContainEqual({ token: "keyword", value: "fn" });
    expect(functionDeclaration).toContainEqual({ token: "function", value: "append_new_node" });
    expect(functionDeclaration).toContainEqual({ token: "delimiter", value: "(" });

    const bytesLiteral = tokenize("let payload = b\"RSS\\x00\";");
    expect(bytesLiteral).toContainEqual({ token: "string", value: "b\"" });
    expect(bytesLiteral).toContainEqual({ token: "string.escape", value: "\\x00" });

    expect(tokenize("// comment body")).toEqual([{ token: "comment", value: "// comment body" }]);
    expect(tokenize("let flag = true;")).toContainEqual({ token: "keyword", value: "true" });
  });

  test("no example file reads an empty argument list as a Unit literal", async () => {
    const offenders: string[] = [];

    for (const fileName of EXPECTED_RSS_EXAMPLE_FILES) {
      const source = await Bun.file(rssExamplePath(fileName)).text();
      for (const [index, line] of source.split("\n").entries()) {
        for (const span of tokenizeSpans(line)) {
          if (span.token !== "constant.language.unit") {
            continue;
          }
          const preceding = line.slice(0, span.start);
          if (/[A-Za-z0-9_]/.test(preceding.slice(-1))) {
            offenders.push(`${fileName}:${index + 1}: ${line.trim()}`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
