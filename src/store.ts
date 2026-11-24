import { randomInt } from 'node:crypto';
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { ReviewFile } from '../plugin/hooks/review-file.ts';
import { UsageError } from './errors.ts';
import type { RunFile, Summary } from './types.ts';

export type ImageKind = 'before' | 'unstable' | 'after' | 'diff';

export type Run = { id: string; dir: string };

export const STORE_DIR = '.ui-compare';
export const SUMMARY_FILE = 'summary.json';
export const REPORT_FILE = 'report.html';
export const REVIEW_FILE = 'review.json';
export const REVIEW_DIR = 'review';
export const PANE_ALIVE_FILE = 'pane-alive';

const RUN_FILE = 'run.json';
const REVIEW_TEMP_FILE = `${REVIEW_FILE}.tmp`;
const ID_LENGTH = 6;
const ID_PATTERN = /^[0-9a-z]{6}$/;
const LISTED_RUNS = 5;
const PANE_ALIVE_MS = 15_000;

export function runDir(cwd: string, id: string): string {
  return join(cwd, STORE_DIR, id);
}

export function imageFile(kind: ImageKind, key: string): string {
  return `${kind}/${key}.png`;
}

export async function createRun(cwd: string): Promise<Run> {
  const root = join(cwd, STORE_DIR);
  await mkdir(root, { recursive: true });
  await writeFile(join(root, '.gitignore'), '*\n');
  for (;;) {
    const id = Array.from({ length: ID_LENGTH }, () =>
      randomInt(36).toString(36),
    ).join('');
    const dir = runDir(cwd, id);
    try {
      await mkdir(dir);
      return { id, dir };
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error;
    }
  }
}

export async function readRun(
  cwd: string,
  id: string,
): Promise<{ dir: string; run: RunFile }> {
  // The id becomes a path that runAfter deletes files under, so anything that
  // is not an id must never reach join().
  const run = ID_PATTERN.test(id) ? await readRunFile(runDir(cwd, id)) : null;
  if (run !== null) return { dir: runDir(cwd, id), run };

  const recent = await recentRunIds(cwd);
  throw new UsageError(
    recent.length === 0
      ? `No run ${id} in ${STORE_DIR}: there are no runs yet. Start one with: ui-compare before <targets...>`
      : `No run ${id} in ${STORE_DIR}. Recent runs, newest first: ${recent.join(', ')}`,
  );
}

export async function writeRun(dir: string, run: RunFile): Promise<void> {
  await writeFile(join(dir, RUN_FILE), `${JSON.stringify(run, null, 2)}\n`);
}

export async function writeImage(
  dir: string,
  file: string,
  png: Buffer,
): Promise<void> {
  const path = join(dir, file);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, png);
}

export async function readImage(dir: string, file: string): Promise<Buffer> {
  return readFile(join(dir, file));
}

export async function clearAfter(dir: string): Promise<void> {
  await Promise.all(
    [
      'after',
      'diff',
      SUMMARY_FILE,
      REPORT_FILE,
      REVIEW_FILE,
      REVIEW_TEMP_FILE,
      REVIEW_DIR,
    ].map((name) => rm(join(dir, name), { recursive: true, force: true })),
  );
}

export async function writeSummary(
  dir: string,
  summary: Summary,
): Promise<void> {
  await writeFile(
    join(dir, SUMMARY_FILE),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
}

export async function writeReport(dir: string, html: string): Promise<void> {
  await writeFile(join(dir, REPORT_FILE), html);
}

export async function writeReviewJson(
  dir: string,
  review: ReviewFile,
): Promise<void> {
  // Renamed into place so that the pane, which polls for review.json, never
  // reads a partly written file.
  const temp = join(dir, REVIEW_TEMP_FILE);
  await writeFile(temp, `${JSON.stringify(review)}\n`);
  await rename(temp, join(dir, REVIEW_FILE));
}

export async function isPaneAlive(cwd: string): Promise<boolean> {
  try {
    const alive = await lstat(join(cwd, STORE_DIR, PANE_ALIVE_FILE));
    return (
      alive.isFile() && Math.abs(Date.now() - alive.mtimeMs) < PANE_ALIVE_MS
    );
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return false;
    throw error;
  }
}

async function readRunFile(dir: string): Promise<RunFile | null> {
  try {
    return JSON.parse(await readFile(join(dir, RUN_FILE), 'utf8')) as RunFile;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null;
    throw error;
  }
}

async function recentRunIds(cwd: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(join(cwd, STORE_DIR), { withFileTypes: true });
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return [];
    throw error;
  }
  const runs: RunFile[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !ID_PATTERN.test(entry.name)) continue;
    const run = await readRunFile(runDir(cwd, entry.name));
    if (run !== null) runs.push(run);
  }
  return runs
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, LISTED_RUNS)
    .map((run) => run.id);
}

function errorCode(error: unknown): unknown {
  return error instanceof Error && 'code' in error ? error.code : undefined;
}
