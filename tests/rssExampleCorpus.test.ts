import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  EXPECTED_RSS_EXAMPLE_COUNT,
  EXPECTED_RSS_EXAMPLE_FILES,
  listCheckedInRssExamples,
  programKeyForRssExample
} from "./rssExampleCorpus";

describe("checked-in RSS playground corpus", () => {
  test("enumerates exactly five RSS example files", () => {
    const files = listCheckedInRssExamples();
    expect(files).toHaveLength(EXPECTED_RSS_EXAMPLE_COUNT);
    expect(files).toEqual([...EXPECTED_RSS_EXAMPLE_FILES]);
    expect(new Set(files).size).toBe(EXPECTED_RSS_EXAMPLE_COUNT);
  });

  test("registers each RSS example in playgroundConfig", () => {
    const configSource = readFileSync(resolve(import.meta.dir, "../src/playgroundConfig.ts"), "utf8");
    const importMatches = [...configSource.matchAll(/from "\.\/examples\/([^"]+\.rss)\?raw"/g)].map(
      (match) => match[1]
    );
    expect(importMatches.sort()).toEqual([...EXPECTED_RSS_EXAMPLE_FILES]);

    for (const fileName of EXPECTED_RSS_EXAMPLE_FILES) {
      const key = programKeyForRssExample(fileName);
      expect(configSource).toContain(`key: "${key}"`);
      expect(configSource).toContain(`./examples/${fileName}?raw`);
    }

    const optionKeys = [...configSource.matchAll(/key: "(complex|ifft|lrucache|collections_iter|strings_regex)"/g)].map(
      (match) => match[1]
    );
    expect(optionKeys).toHaveLength(EXPECTED_RSS_EXAMPLE_COUNT);
  });
});
