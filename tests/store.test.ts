import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test';

import { UsageError } from '../src/errors.ts';
import { createRun, readRun, runDir, writeRun } from '../src/store.ts';
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
