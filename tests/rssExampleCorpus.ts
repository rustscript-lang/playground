import { readdirSync } from "node:fs";
import { resolve } from "node:path";

export const EXPECTED_RSS_EXAMPLE_COUNT = 5;

export const EXPECTED_RSS_EXAMPLE_FILES = [
  "rss-collections-iter-example.rss",
  "rss-complex-example.rss",
  "rss-ifft-example.rss",
  "rss-lrucache-example.rss",
  "rss-strings-regex-example.rss"
] as const;

export type RssExampleFileName = (typeof EXPECTED_RSS_EXAMPLE_FILES)[number];

const FILE_TO_PROGRAM_KEY = {
  "rss-complex-example.rss": "complex",
  "rss-ifft-example.rss": "ifft",
  "rss-lrucache-example.rss": "lrucache",
  "rss-collections-iter-example.rss": "collections_iter",
  "rss-strings-regex-example.rss": "strings_regex"
} as const satisfies Record<RssExampleFileName, string>;

export function examplesDir(fromDir = import.meta.dir): string {
  return resolve(fromDir, "../src/examples");
}

export function listCheckedInRssExamples(fromDir = import.meta.dir): string[] {
  return readdirSync(examplesDir(fromDir))
    .filter((name) => name.endsWith(".rss"))
    .sort();
}

export function programKeyForRssExample(fileName: string): string {
  if (!(fileName in FILE_TO_PROGRAM_KEY)) {
    throw new Error(`unregistered playground RSS example: ${fileName}`);
  }
  return FILE_TO_PROGRAM_KEY[fileName as RssExampleFileName];
}

export function rssExamplePath(fileName: string, fromDir = import.meta.dir): string {
  return resolve(examplesDir(fromDir), fileName);
}
