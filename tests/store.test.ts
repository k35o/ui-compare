import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test';

import { UsageError } from '../src/errors.ts';
import {
  clearAfter,
  createRun,
  isPaneAlive,
  readRun,
  runDir,
  writeRun,
} from '../src/store.ts';
import type { RunFile } from '../src/types.ts';

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'ui-compare-store-'));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

function runFile(id: string, createdAt: string): RunFile {
  return { version: 1, id, createdAt, masks: [], shots: [], before: [] };
}

async function saveRun(run: RunFile): Promise<void> {
  const dir = runDir(cwd, run.id);
  await mkdir(dir, { recursive: true });
  await writeRun(dir, run);
}

describe('createRun', () => {
  test('ignores every file in .ui-compare so screenshots are never committed', async () => {
    await createRun(cwd);

    await expect(
      readFile(join(cwd, '.ui-compare', '.gitignore'), 'utf8'),
    ).resolves.toBe('*\n');
  });

  test('creates the run directory under .ui-compare with a six-character base36 id', async () => {
    const { id, dir } = await createRun(cwd);

    expect(id).toMatch(/^[0-9a-z]{6}$/);
    expect(dir).toBe(join(cwd, '.ui-compare', id));
  });
});

describe('readRun', () => {
  test('returns a written run by its id', async () => {
    const { id, dir } = await createRun(cwd);
    const run = runFile(id, '2026-11-01T10:00:00.000Z');
    await writeRun(dir, run);

    await expect(readRun(cwd, id)).resolves.toStrictEqual({ dir, run });
  });

  test('an unknown id lists the five newest existing ids', async () => {
    await saveRun(runFile('aaaaa1', '2026-11-01T10:00:01.000Z'));
    await saveRun(runFile('aaaaa6', '2026-11-01T10:00:06.000Z'));
    await saveRun(runFile('aaaaa3', '2026-11-01T10:00:03.000Z'));
    await saveRun(runFile('aaaaa2', '2026-11-01T10:00:02.000Z'));
    await saveRun(runFile('aaaaa5', '2026-11-01T10:00:05.000Z'));
    await saveRun(runFile('aaaaa4', '2026-11-01T10:00:04.000Z'));

    await expect(readRun(cwd, 'zzzzzz')).rejects.toStrictEqual(
      new UsageError(
        'No run zzzzzz in .ui-compare. Recent runs, newest first: aaaaa6, aaaaa5, aaaaa4, aaaaa3, aaaaa2',
      ),
    );
  });

  test('an unknown id without any runs says how to start one', async () => {
    await expect(readRun(cwd, 'zzzzzz')).rejects.toStrictEqual(
      new UsageError(
        'No run zzzzzz in .ui-compare: there are no runs yet. Start one with: ui-compare before <targets...>',
      ),
    );
  });

  test('an id that is a path outside the store is unknown', async () => {
    await saveRun(runFile('aaaaa1', '2026-11-01T10:00:01.000Z'));
    await writeRun(cwd, runFile('aaaaa9', '2026-11-01T10:00:09.000Z'));

    await expect(readRun(cwd, '..')).rejects.toStrictEqual(
      new UsageError(
        'No run .. in .ui-compare. Recent runs, newest first: aaaaa1',
      ),
    );
  });
});

describe('clearAfter', () => {
  test('removes what after wrote, review.json and its strips included, and keeps Before', async () => {
    const { dir } = await createRun(cwd);
    await writeRun(dir, runFile('aaaaa1', '2026-11-01T10:00:01.000Z'));
    for (const folder of ['before', 'unstable', 'after', 'diff', 'review']) {
      await mkdir(join(dir, folder));
      await writeFile(join(dir, folder, 'shot.png'), '');
    }
    for (const file of [
      'summary.json',
      'report.html',
      'review.json',
      'review.json.tmp',
    ]) {
      await writeFile(join(dir, file), '');
    }

    await clearAfter(dir);

    expect((await readdir(dir)).toSorted()).toStrictEqual([
      'before',
      'run.json',
      'unstable',
    ]);
  });
});

describe('isPaneAlive', () => {
  const touch = async (secondsAgo: number) => {
    await mkdir(join(cwd, '.ui-compare'), { recursive: true });
    const file = join(cwd, '.ui-compare', 'pane-alive');
    await writeFile(file, '');
    const time = new Date(Date.now() - secondsAgo * 1000);
    await utimes(file, time, time);
  };

  test('is true when the pane touched pane-alive within 15 seconds', async () => {
    await touch(10);

    await expect(isPaneAlive(cwd)).resolves.toBe(true);
  });

  test('is false when pane-alive was last touched more than 15 seconds ago', async () => {
    await touch(16);

    await expect(isPaneAlive(cwd)).resolves.toBe(false);
  });

  test('is false when pane-alive was touched more than 15 seconds in the future, as after a clock step back', async () => {
    await touch(-60);

    await expect(isPaneAlive(cwd)).resolves.toBe(false);
  });

  test('is false when pane-alive is a symlink, even to a fresh file', async () => {
    await mkdir(join(cwd, '.ui-compare'), { recursive: true });
    const target = join(cwd, 'fresh');
    await writeFile(target, '');
    await symlink(target, join(cwd, '.ui-compare', 'pane-alive'));

    await expect(isPaneAlive(cwd)).resolves.toBe(false);
  });

  test('is false without pane-alive', async () => {
    await expect(isPaneAlive(cwd)).resolves.toBe(false);
  });
});
