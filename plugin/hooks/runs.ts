import type { FsEntry, FsStat } from 'claude-code';

import type { UiCompareRun } from '../types';
import type { ReviewFile } from './review-file';
import { runPath, STORE } from './summary';

export const REVIEW_FILE = 'review.json';

const RUN_ID = /^[0-9a-z]{6}$/;
const STRIP_FILE = /^review\/[A-Za-z0-9._-]+\.png$/;
const DIFF_FILE = /^diff\/[A-Za-z0-9._-]+\.png$/;

export type RunFiles = {
  list: (path: string) => Promise<FsEntry[]>;
  stat: (path: string) => Promise<FsStat>;
};

export type ReviewProblem = 'unreadable' | 'version';

export type ReadReview = { review: ReviewFile } | { problem: ReviewProblem };

export async function newestRun(
  files: RunFiles,
): Promise<UiCompareRun | undefined> {
  const entries = await files.list(STORE).catch((): FsEntry[] => []);
  const runs = await Promise.all(
    entries
      .filter(({ kind, name }) => kind === 'dir' && RUN_ID.test(name))
      .map(({ name }) =>
        files.stat(runPath(name, REVIEW_FILE)).then(
          ({ mtimeMs }): UiCompareRun => ({ id: name, mtimeMs }),
          () => undefined,
        ),
      ),
  );
  return runs.reduce<UiCompareRun | undefined>(
    (newest, run) =>
      run !== undefined &&
      (newest === undefined || run.mtimeMs > newest.mtimeMs)
        ? run
        : newest,
    undefined,
  );
}

type Check = (value: unknown) => boolean;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isString: Check = (value) => typeof value === 'string';

const isSize: Check = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const matches =
  (pattern: RegExp): Check =>
  (value) =>
    typeof value === 'string' && pattern.test(value);

const oneOf =
  (...options: readonly unknown[]): Check =>
  (value) =>
    options.includes(value);

const optional =
  (check: Check): Check =>
  (value) =>
    value === undefined || check(value);

const listOf =
  (check: Check): Check =>
  (value) =>
    Array.isArray(value) && value.every(check);

const shape =
  (fields: Record<string, Check>): Check =>
  (value) =>
    isRecord(value) &&
    Object.entries(fields).every(([key, check]) => check(value[key]));

const isPair: Check = (value) =>
  Array.isArray(value) && value.length === 2 && value.every(isSize);

const isArea = shape({ x: isSize, y: isSize, width: isSize, height: isSize });

const isStripImage = shape({
  width: isSize,
  height: isSize,
  strips: listOf(
    shape({ file: matches(STRIP_FILE), y: isSize, height: isSize }),
  ),
});

const isScreen = shape({
  key: isString,
  kind: oneOf('url', 'component'),
  label: isString,
});

const isVariant = shape({
  shotKey: isString,
  viewport: shape({ width: isSize, height: isSize }),
  colorScheme: oneOf('light', 'dark'),
  story: optional(isString),
  warnings: listOf(isString),
});

const isPage = shape({
  before: optional(isStripImage),
  after: optional(isStripImage),
  unstable: optional(isStripImage),
  marks: listOf(isArea),
});

const isChange = shape({
  variants: listOf(isVariant),
  crops: listOf(
    shape({
      area: isArea,
      box: isArea,
      before: isStripImage,
      after: isStripImage,
    }),
  ),
  fullPage: oneOf(true, false),
  dimensions: optional(shape({ before: isPair, after: isPair })),
  page: isPage,
  diff: matches(DIFF_FILE),
});

const isLine = shape({
  screen: isScreen,
  variants: listOf(isVariant),
  reason: optional(isString),
  page: optional(isPage),
});

const isReview = shape({
  version: oneOf(1),
  id: matches(RUN_ID),
  beforeAt: isString,
  afterAt: isString,
  errors: listOf(
    shape({
      screen: isScreen,
      variants: listOf(isVariant),
      phase: oneOf('before', 'after'),
      message: isString,
    }),
  ),
  changed: listOf(shape({ screen: isScreen, changes: listOf(isChange) })),
  noise: listOf(isLine),
  unchanged: listOf(isLine),
  skipped: listOf(isLine),
});

export function parseReview(text: string, id: string): ReadReview {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { problem: 'unreadable' };
  }
  if (isRecord(value) && value.version !== undefined && value.version !== 1)
    return { problem: 'version' };
  return isReview(value) && (value as ReviewFile).id === id
    ? { review: value as ReviewFile }
    : { problem: 'unreadable' };
}
