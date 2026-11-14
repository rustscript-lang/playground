import type * as Monaco from "monaco-editor";

import languageConfiguration from "./rss.language-configuration.json";
import tmLanguage from "./rss.tmLanguage.json";

type TmPattern = {
  name?: string;
  match?: string;
  begin?: string;
  end?: string;
  patterns?: TmPattern[];
};

type TmSection = {
  patterns?: TmPattern[];
  match?: string;
  begin?: string;
  end?: string;
};

type TmGrammar = {
  repository?: Record<string, TmSection>;
};

const FALLBACK_BLOCK_COMMENT_BEGIN = "/\\*";
const FALLBACK_BLOCK_COMMENT_END = "\\*/";
const FALLBACK_LINE_COMMENT = "//.*$";
const FALLBACK_BYTES_STRING_BEGIN = "b\"";
const FALLBACK_STRING_BEGIN = "\"";
const FALLBACK_STRING_END = "\"";
const FALLBACK_STRING_ESCAPE = "\\\\(?:x[0-9A-Fa-f]{2}|[nrt\\\\\"0])";
const FALLBACK_NUMBERS = "\\b(?:\\d+\\.\\d+|\\d+)\\b";
const FALLBACK_OPERATORS = "=>|==|!=|&&|\\|\\||&|=|\\+|-|\\*|/|%|<|>|!";
const FALLBACK_UNIT_LITERAL = "\\(\\)";
const FALLBACK_OPTIONAL_ACCESS = "\\?\\.";
const FALLBACK_PROPAGATION = "\\?(?!\\.)";
const FALLBACK_MEMBER_ACCESS = "\\.(\\s*)([A-Za-z_][A-Za-z0-9_]*)";
const FALLBACK_CONSTRUCTOR =
  "\\b((?:Option)(?=\\s*::\\s*(?:Some|None))|(?:Result)(?=\\s*::\\s*(?:Ok|Err)))(\\s*)(::)(\\s*)(Some|None|Ok|Err)\\b";
const IDENT = "[A-Za-z_][A-Za-z0-9_]*";
const GENERIC_BLOCK = "<[^<>\\n]*(?:<[^<>\\n]*>[^<>\\n]*)*>";
const PATH_IDENT = `(?:self|super|crate|${IDENT})`;
const PATH = `(?:${PATH_IDENT})(?:::(?:${PATH_IDENT}))*`;
const PATH_CALL = `${IDENT}(?:(?:\\s*::\\s*)${IDENT})*`;
const TYPE_TOKEN = new RegExp(`\\b${PATH_IDENT}\\b`);
const UNIT_LITERAL_LOOKBEHIND = /^\(\?<!\[[^\]]*\]\)/;
const RESERVED_WORDS = "pub|struct|fn|let|mut|for|if|else|match|while|break|continue|use|as|true|false";

let rustScriptLanguageRegistered = false;

function section(name: string): TmSection {
  const grammar = tmLanguage as TmGrammar;
  return grammar.repository?.[name] ?? {};
}

function sectionPatterns(name: string): TmPattern[] {
  return section(name).patterns ?? [];
}

function patternMatch(value: string | undefined, fallback: string): RegExp {
  try {
    return new RegExp(value && value.length > 0 ? value : fallback);
  } catch {
    return new RegExp(fallback);
  }
}

function sectionMatch(name: string, fallback: string): RegExp {
  return patternMatch(section(name).match, fallback);
}

function sectionPatternMatches(name: string): RegExp[] {
  return sectionPatterns(name)
    .map((entry) => entry.match)
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    .map((entry) => patternMatch(entry, "$^"));
}

function findByName(name: string, needle: string): TmPattern | null {
  return sectionPatterns(name).find((entry) => entry.name?.includes(needle)) ?? null;
}

function beginPattern(entry: TmPattern | null, fallback: string): RegExp {
  return patternMatch(entry?.begin, fallback);
}

function endPattern(entry: TmPattern | null, fallback: string): RegExp {
  return patternMatch(entry?.end, fallback);
}

function fullLineCommentPattern(entry: TmPattern | null, fallback: string): RegExp {
  const begin = entry?.begin;
  if (typeof begin === "string" && begin.length > 0) {
    return patternMatch(`${begin}.*$`, fallback);
  }
  return patternMatch(fallback, fallback);
}

/**
 * Core scopes the Unit literal with a look-behind so that `foo()` keeps being a call.
 * Monarch evaluates every rule as `^(?:pattern)` against the *remainder of the line*, so a
 * look-behind can never see the callee that was already consumed (`foo()` would still
 * highlight `()` as a Unit). We drop the look-behind and let the call rules swallow their
 * empty argument list instead (see `emptyCallTail`), which preserves the Core intent.
 */
function unitLiteralSource(): string {
  const source = section("unit-literal").match;
  if (typeof source !== "string" || source.length === 0) {
    return FALLBACK_UNIT_LITERAL;
  }
  const withoutLookbehind = source.replace(UNIT_LITERAL_LOOKBEHIND, "");
  return withoutLookbehind.length > 0 ? withoutLookbehind : FALLBACK_UNIT_LITERAL;
}

/**
 * Core's `member-access` rule accepts both `.` and `?.`. Optional access is tokenized by its
 * own rule that runs first, so this copy keeps only the plain `.` alternative (`?.` is
 * removed from the alternation, which keeps the capture numbering intact).
 */
function memberAccessSource(): string {
  const source = sectionPatterns("member-access")[0]?.match ?? FALLBACK_MEMBER_ACCESS;
  return source.includes("\\?\\.|") ? source.replace("\\?\\.|", "") : source;
}

function typeExpressionRules(
  terminators: ReadonlyArray<{ pattern: RegExp; token: string }>
): Monaco.languages.IMonarchLanguageRule[] {
  return [
    [/\s+/, ""],
    ...terminators.map(({ pattern, token }) => [pattern, token, "@pop"] as Monaco.languages.IMonarchLanguageRule),
    [/::/, "delimiter"],
    [/,/, "delimiter"],
    [/\[/, "delimiter", "@typeArray"],
    [/</, "delimiter", "@typeGeneric"],
    [TYPE_TOKEN, "type.identifier"]
  ];
}

function genericParameterRules(): Monaco.languages.IMonarchLanguageRule[] {
  return [
    [/\s+/, ""],
    [/>/, "delimiter", "@pop"],
    [/::/, "delimiter"],
    [/,/, "delimiter"],
    [/\[/, "delimiter", "@typeArray"],
    [/</, "delimiter", "@push"],
    [TYPE_TOKEN, "type.identifier"]
  ];
}

export function createRustScriptMonarchLanguage(): Monaco.languages.IMonarchLanguage {
  const lineCommentPattern = fullLineCommentPattern(findByName("comments", "comment.line"), FALLBACK_LINE_COMMENT);
  const blockCommentBegin = beginPattern(findByName("comments", "comment.block"), FALLBACK_BLOCK_COMMENT_BEGIN);
  const blockCommentEnd = endPattern(findByName("comments", "comment.block"), FALLBACK_BLOCK_COMMENT_END);
  const bytesStringBegin = beginPattern(section("byte-quoted-string"), FALLBACK_BYTES_STRING_BEGIN);
  const stringBegin = beginPattern(section("double-quoted-string"), FALLBACK_STRING_BEGIN);
  const stringEnd = endPattern(section("double-quoted-string"), FALLBACK_STRING_END);
  const stringEscape =
    sectionPatternMatches("double-quoted-string")[0] ?? patternMatch(FALLBACK_STRING_ESCAPE, FALLBACK_STRING_ESCAPE);

  const unitLiteral = unitLiteralSource();
  // `foo()`, `value.copy()`, `math::pi()`: a call's empty argument list belongs to the call,
  // not to the Unit literal, so every call rule consumes it here.
  const emptyCallTail = `((?:\\s*${unitLiteral})?)`;

  const rootRules: Monaco.languages.IMonarchLanguageRule[] = [
    [lineCommentPattern, "comment"],
    [blockCommentBegin, "comment", "@blockComment"],
    [bytesStringBegin, "string", "@string"],
    [stringBegin, "string", "@string"],
    [new RegExp(`\\b(struct)(\\s+)(${IDENT})\\b`), ["keyword", "", "type.identifier"], "@afterStructName"],
    [new RegExp(`\\b(use)(\\s+)(${PATH})(\\s+)(as)(\\s+)(${IDENT})\\b`), ["keyword", "", "type.identifier", "", "keyword", "", "identifier"]],
    [new RegExp(`\\b(use)(\\s+)(${PATH})(\\s*)(::)(\\s*)(\\{[^}\\\n]*\\}|\\*)`), ["keyword", "", "type.identifier", "", "delimiter", "", "type.identifier"]],
    [new RegExp(`\\b(use)(\\s+)(${PATH})\\b`), ["keyword", "", "type.identifier"]],
    // `fn wrap<T>()`: a generic header with an empty parameter list is a declaration, not a
    // Unit literal, so it is claimed before the Unit rule can see the parentheses.
    [
      new RegExp(`\\b(pub)(\\s+)(fn)(\\s+)(${IDENT})(\\s*)(${GENERIC_BLOCK})(\\s*)${unitLiteral}`),
      ["keyword", "", "keyword", "", "function", "", "type.identifier", "", "delimiter"],
      "@afterFunctionName"
    ],
    [
      new RegExp(`\\b(fn)(\\s+)(${IDENT})(\\s*)(${GENERIC_BLOCK})(\\s*)${unitLiteral}`),
      ["keyword", "", "function", "", "type.identifier", "", "delimiter"],
      "@afterFunctionName"
    ],
    [
      new RegExp(`\\b(pub)(\\s+)(fn)(\\s+)(${IDENT})\\b${emptyCallTail}`),
      ["keyword", "", "keyword", "", "function", "delimiter"],
      "@afterFunctionName"
    ],
    [
      new RegExp(`\\b(fn)(\\s+)(${IDENT})\\b${emptyCallTail}`),
      ["keyword", "", "function", "delimiter"],
      "@afterFunctionName"
    ],
    [new RegExp(`\\b(let)(\\s+)(mut)(\\s+)(${IDENT})(\\s*)(:)(\\s*)`), ["keyword", "", "keyword", "", "identifier", "", "delimiter", ""], "@typeBeforeAssign"],
    [new RegExp(`\\b(let)(\\s+)(${IDENT})(\\s*)(:)(\\s*)`), ["keyword", "", "identifier", "", "delimiter", ""], "@typeBeforeAssign"],
    [new RegExp(`\\b(let)(\\s+)(mut)(\\s+)(${IDENT})\\b`), ["keyword", "", "keyword", "", "identifier"]],
    [new RegExp(`\\b(let)(\\s+)(${IDENT})\\b`), ["keyword", "", "identifier"]],
    [
      new RegExp(sectionPatterns("option-result-constructor")[0]?.match ?? FALLBACK_CONSTRUCTOR),
      ["support.type", "", "punctuation.accessor", "", "support.constant.constructor"]
    ],
    [
      new RegExp(`\\b(${IDENT})(\\s*)(::)(\\s*)(${PATH_CALL})(\\s*)(::)(\\s*)(${GENERIC_BLOCK})(?=\\s*\\()${emptyCallTail}`),
      ["type.identifier", "", "delimiter", "", "function", "", "delimiter", "", "type.identifier", "delimiter"]
    ],
    [
      new RegExp(`\\b(${IDENT})(\\s*)(::)(\\s*)(${GENERIC_BLOCK})(?=\\s*\\()${emptyCallTail}`),
      ["function", "", "delimiter", "", "type.identifier", "delimiter"]
    ],
    [
      new RegExp(`\\b(${IDENT})(\\s*)(::)(\\s*)(${PATH_CALL})(?=\\s*\\()${emptyCallTail}`),
      ["type.identifier", "", "delimiter", "", "function", "delimiter"]
    ],
    [new RegExp(`\\b(println)(\\s*)(!)(?=\\s*\\()`), ["function", "", "operator"]],
    // `?.` must win over member access, which also matches a bare `.`.
    [
      new RegExp(`(\\?\\.)(\\s*)(${IDENT})${emptyCallTail}`),
      ["keyword.operator.optional-access", "", "variable", "delimiter"]
    ],
    [sectionMatch("optional-access-operator", FALLBACK_OPTIONAL_ACCESS), "keyword.operator.optional-access"],
    [new RegExp(`${memberAccessSource()}${emptyCallTail}`), ["punctuation.accessor", "", "variable", "delimiter"]],
    [sectionMatch("propagation-operator", FALLBACK_PROPAGATION), "keyword.operator.propagation"],
    [
      new RegExp(`\\b(?!(?:${RESERVED_WORDS})\\b)(${IDENT})(\\s*)(?=\\()${emptyCallTail}`),
      ["function", "", "delimiter"]
    ]
  ];

  rootRules.push([sectionMatch("booleans", "\\b(?:true|false)\\b"), "keyword"]);
  rootRules.push([sectionMatch("numbers", FALLBACK_NUMBERS), "number"]);
  for (const keywordPattern of sectionPatternMatches("keywords")) {
    rootRules.push([keywordPattern, "keyword"]);
  }
  rootRules.push([sectionMatch("wildcard-pattern", "\\b_\\b"), "keyword"]);
  rootRules.push([sectionMatch("closure-pipes", "\\|"), "delimiter"]);
  // Reached only when no call rule claimed the parentheses, i.e. a real standalone Unit.
  rootRules.push([patternMatch(unitLiteral, FALLBACK_UNIT_LITERAL), "constant.language.unit"]);
  rootRules.push([sectionMatch("operators", FALLBACK_OPERATORS), "operator"]);
  rootRules.push([sectionMatch("punctuation", "[(){}\\[\\],;:]"), "delimiter"]);

  return {
    tokenizer: {
      root: rootRules,
      blockComment: [
        [blockCommentEnd, "comment", "@pop"],
        [/./, "comment"]
      ],
      string: [
        [stringEscape, "string.escape"],
        [stringEnd, "string", "@pop"],
        [/[^\\"]+/, "string"],
        [/./, "string"]
      ],
      functionSignature: [
        [lineCommentPattern, "comment"],
        [blockCommentBegin, "comment", "@blockComment"],
        [bytesStringBegin, "string", "@string"],
        [stringBegin, "string", "@string"],
        [new RegExp(`\\b(${IDENT})(\\s*)(:)(\\s*)`), ["identifier", "", "delimiter", ""], "@typeBeforeParamDelimiter"],
        [/(->)(\s*)/, ["operator", ""], "@typeBeforeReturnTerminator"],
        [/\{/, "delimiter", "@pop"],
        [/=/, "operator", "@pop"],
        [/;/, "delimiter", "@pop"],
        [sectionMatch("punctuation", "[(){}\\[\\],;:]"), "delimiter"],
        [sectionMatch("operators", FALLBACK_OPERATORS), "operator"]
      ],
      afterStructName: [
        [/\s+/, ""],
        [/</, "delimiter", "@genericParams"],
        [/\{/, "delimiter", "@structBlock"]
      ],
      afterFunctionName: [
        [/\s+/, ""],
        [/</, "delimiter", "@genericParams"],
        [/\(/, "delimiter", "@functionSignature"]
      ],
      structBlock: [
        [lineCommentPattern, "comment"],
        [blockCommentBegin, "comment", "@blockComment"],
        [bytesStringBegin, "string", "@string"],
        [stringBegin, "string", "@string"],
        [/\{/, "delimiter", "@push"],
        [/\}/, "delimiter", "@pop"],
        [/\[/, "delimiter"],
        [/\]/, "delimiter"],
        [new RegExp(`\\b(${IDENT})(\\s*)(:)(\\s*)`), ["variable", "", "delimiter", ""], "@typeBeforeStructFieldDelimiter"],
        [sectionMatch("punctuation", "[(){}\\[\\],;:]"), "delimiter"]
      ],
      typeBeforeAssign: typeExpressionRules([{ pattern: /=/, token: "operator" }]),
      typeBeforeParamDelimiter: typeExpressionRules([
        { pattern: /,/, token: "delimiter" },
        { pattern: /\)/, token: "delimiter" }
      ]),
      typeBeforeReturnTerminator: typeExpressionRules([
        { pattern: /\{/, token: "delimiter" },
        { pattern: /=/, token: "operator" },
        { pattern: /;/, token: "delimiter" }
      ]),
      typeBeforeStructFieldDelimiter: typeExpressionRules([
        { pattern: /,/, token: "delimiter" },
        { pattern: /\}/, token: "delimiter" }
      ]),
      genericParams: genericParameterRules(),
      typeGeneric: [
        [/\s+/, ""],
        [/>/, "delimiter", "@pop"],
        [/::/, "delimiter"],
        [/,/, "delimiter"],
        [/\[/, "delimiter", "@typeArray"],
        [/</, "delimiter", "@typeGeneric"],
        [TYPE_TOKEN, "type.identifier"]
      ],
      typeArray: [
        [/\s+/, ""],
        [/\]/, "delimiter", "@pop"],
        [/::/, "delimiter"],
        [/,/, "delimiter"],
        [/\[/, "delimiter", "@typeArray"],
        [/</, "delimiter", "@typeGeneric"],
        [TYPE_TOKEN, "type.identifier"]
      ]
    }
  };
}

export function ensureRustScriptLanguage(monaco: typeof import("monaco-editor")): void {
  if (rustScriptLanguageRegistered) {
    return;
  }

  const languageId = "rustscript";
  if (!monaco.languages.getLanguages().some((item) => item.id === languageId)) {
    monaco.languages.register({ id: languageId });
  }

  monaco.languages.setMonarchTokensProvider(languageId, createRustScriptMonarchLanguage());

  monaco.languages.setLanguageConfiguration(
    languageId,
    languageConfiguration as unknown as Monaco.languages.LanguageConfiguration
  );

  rustScriptLanguageRegistered = true;
}
