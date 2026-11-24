import { launchCapturer } from './capture.ts';
import type { Capturer } from './capture.ts';
import { comparePngs } from './compare.ts';
import { UsageError } from './errors.ts';
import { renderReport } from './report.ts';
import { writeReviewFile } from './review-file.ts';
import { buildReview } from './review.ts';
import type { Review, ShotImages } from './review.ts';
import {
  clearAfter,
  createRun,
  imageFile,
  isPaneAlive,
  readImage,
  readRun,
  writeImage,
  writeReport,
  writeRun,
  writeSummary,
} from './store.ts';
import type { ImageKind } from './store.ts';
import { resolveShots } from './targets.ts';
import type { TargetInput } from './targets.ts';
import type {
  BeforeShot,
  CaptureOutcome,
  RunFile,
  Shot,
  ShotResult,
  ShotStatus,
  Summary,
} from './types.ts';

export type BeforeInput = TargetInput & { masks: string[] };

const MAX_PARALLEL_SHOTS = 4;
const IMAGE_KINDS: ImageKind[] = ['before', 'unstable', 'after', 'diff'];

export async function runBefore({
  masks,
  ...targetInput
}: BeforeInput): Promise<RunFile> {
  const shots = await resolveShots(targetInput);
  if (shots.length === 0) {
    throw new UsageError('Nothing to capture: the Storybook has no stories');
  }
  return withCapturer(async (capturer) => {
    const createdAt = new Date().toISOString();
    const { id, dir } = await createRun(targetInput.cwd);
    const before = await mapLimit(shots, (shot) =>
      captureBefore(capturer, dir, shot, masks),
    );
    const run: RunFile = { version: 1, id, createdAt, masks, shots, before };
    await writeRun(dir, run);
    return run;
  });
}

export async function runAfter({
  id,
  cwd,
}: {
  id: string;
  cwd: string;
}): Promise<{
  dir: string;
  summary: Summary;
  review: Review;
  report: 'file' | 'pane';
}> {
  const { dir, run } = await readRun(cwd, id);
  const pairs = shotsWithBefore(run);
  await clearAfter(dir);
  const afterAt = new Date().toISOString();
  const shots = await withCapturer((capturer) =>
    mapLimit(pairs, ({ shot, before }) =>
      compareShot(capturer, dir, shot, before, run.masks),
    ),
  );
  const summary: Summary = {
    version: 1,
    id,
    beforeAt: run.createdAt,
    afterAt,
    counts: countStatuses(shots),
    shots,
  };
  await writeSummary(dir, summary);
  const images = await readImages(dir, shots);
  const review = buildReview(summary, images);
  await writeReviewFile(dir, review, images, summary);
  if (await isPaneAlive(cwd)) return { dir, summary, review, report: 'pane' };
  await writeReport(dir, renderReport(review, images));
  return { dir, summary, review, report: 'file' };
}

export function shotsWithBefore(
  run: RunFile,
): Array<{ shot: Shot; before: BeforeShot }> {
  const beforeByKey = new Map(run.before.map((before) => [before.key, before]));
  return run.shots.map((shot) => {
    const before = beforeByKey.get(shot.key);
    if (before === undefined) {
      throw new Error(`run.json of ${run.id} has no Before for ${shot.key}`);
    }
    return { shot, before };
  });
}

async function captureBefore(
  capturer: Capturer,
  dir: string,
  shot: Shot,
  masks: string[],
): Promise<BeforeShot> {
  const { key } = shot;
  const first = await capturer.capture(shot, { masks });
  if (first.status !== 'captured') return notCaptured(key, first);
  const second = await capturer.capture(shot, { masks });
  if (second.status !== 'captured') return notCaptured(key, second);

  await writeImage(dir, imageFile('before', key), first.png);
  const warnings = unique([...first.warnings, ...second.warnings]);
  const { passed, diffPng, mismatchRatio, bbox, regions } = comparePngs(
    first.png,
    second.png,
  );
  if (passed || diffPng === null) {
    return { key, status: 'captured', warnings };
  }
  await writeImage(dir, imageFile('unstable', key), diffPng);
  return {
    key,
    status: 'captured',
    warnings,
    unstable: { mismatchRatio, bbox, regions },
  };
}

function notCaptured(
  key: string,
  outcome: Exclude<CaptureOutcome, { status: 'captured' }>,
): BeforeShot {
  return outcome.status === 'skipped'
    ? { key, status: 'skipped', reason: outcome.reason }
    : { key, status: 'error', message: outcome.message };
}

async function compareShot(
  capturer: Capturer,
  dir: string,
  shot: Shot,
  before: BeforeShot,
  masks: string[],
): Promise<ShotResult> {
  if (before.status === 'error') {
    return {
      shot,
      status: 'error',
      error: { phase: 'before', message: before.message },
      warnings: [],
      files: {},
    };
  }
  if (before.status === 'skipped') {
    return {
      shot,
      status: 'skipped',
      skipReason: before.reason,
      warnings: [],
      files: {},
    };
  }

  const beforeFile = imageFile('before', shot.key);
  const files: ShotResult['files'] = { before: beforeFile };
  if (before.unstable) files.unstable = imageFile('unstable', shot.key);
  const carried = {
    shot,
    files,
    ...(before.unstable ? { unstable: before.unstable } : {}),
  };

  const after = await capturer.capture(shot, { masks });
  if (after.status === 'error') {
    return {
      ...carried,
      status: 'error',
      error: { phase: 'after', message: after.message },
      warnings: before.warnings,
    };
  }
  if (after.status === 'skipped') {
    return {
      ...carried,
      status: 'skipped',
      skipReason: after.reason,
      warnings: before.warnings,
    };
  }

  files.after = imageFile('after', shot.key);
  await writeImage(dir, files.after, after.png);
  const warnings = unique([...before.warnings, ...after.warnings]);
  const { passed, diffPng, ...diff } = comparePngs(
    await readImage(dir, beforeFile),
    after.png,
  );
  if (passed || diffPng === null) {
    return { ...carried, status: 'unchanged', warnings };
  }
  files.diff = imageFile('diff', shot.key);
  await writeImage(dir, files.diff, diffPng);
  return { ...carried, status: 'changed', diff, warnings };
}

function countStatuses(results: ShotResult[]): Record<ShotStatus, number> {
  const counts = { changed: 0, unchanged: 0, error: 0, skipped: 0 };
  for (const { status } of results) counts[status]++;
  return counts;
}

async function readImages(
  dir: string,
  results: ShotResult[],
): Promise<ShotImages> {
  const images: ShotImages = new Map();
  for (const { shot, files } of results) {
    const set: Partial<Record<ImageKind, Buffer>> = {};
    for (const kind of IMAGE_KINDS) {
      const file = files[kind];
      if (file !== undefined) set[kind] = await readImage(dir, file);
    }
    images.set(shot.key, set);
  }
  return images;
}

async function withCapturer<T>(
  use: (capturer: Capturer) => Promise<T>,
): Promise<T> {
  const capturer = await launchCapturer();
  try {
    return await use(capturer);
  } finally {
    await capturer.close();
  }
}

async function mapLimit<T, R>(
  items: T[],
  map: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  const queue = items.entries();
  const worker = async () => {
    for (const [index, item] of queue) results[index] = await map(item);
  };
  await Promise.all(
    Array.from({ length: Math.min(MAX_PARALLEL_SHOTS, items.length) }, worker),
  );
  return results;
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}
