import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'vite-plus/test';

import type { Summary } from '../src/types.ts';

type CliResult = { code: number | null; stdout: string; stderr: string };

const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

const pages = new Map<string, () => string>();
let server: Server;
let port: number;
let origin: string;
let cwd: string;

beforeAll(async () => {
  server = createServer((request, response) => {
    const page = pages.get(request.url ?? '');
    if (page === undefined) {
      response.writeHead(404, { 'content-type': 'text/html' });
      response.end('<p>Not found</p>');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(page());
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  ({ port } = server.address() as AddressInfo);
  origin = `http://127.0.0.1:${port}`;
});

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'ui-compare-cli-'));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => {
    server.close(resolve);
  });
});

function html(body: string): string {
  return `<!doctype html><html><head><style>body { margin: 0; background: #fff; }</style></head><body>${body}</body></html>`;
}

function box(color: string): () => string {
  return () =>
    html(
      `<div id="box" style="position: absolute; left: 10px; top: 20px; width: 30px; height: 40px; background: ${color}"></div>`,
    );
}

function uiCompare(...args: string[]): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function runIdOf(stdout: string): string {
  return /^Captured Before for run ([0-9a-z]{6}) /.exec(stdout)?.[1] ?? '';
}

async function before(...args: string[]): Promise<string> {
  const result = await uiCompare('before', ...args);
  const id = runIdOf(result.stdout);
  if (id === '') {
    throw new Error(`before printed no run id: ${JSON.stringify(result)}`);
  }
  return id;
}

async function readJson<T>(id: string, file: string): Promise<T> {
  return JSON.parse(
    await readFile(join(cwd, '.ui-compare', id, file), 'utf8'),
  ) as T;
}

async function reportImages(id: string): Promise<unknown> {
  const report = await readFile(
    join(cwd, '.ui-compare', id, 'report.html'),
    'utf8',
  );
  const json =
    /<script type="application\/json" id="images">(.*?)<\/script>/s.exec(
      report,
    )?.[1];
  if (json === undefined) {
    throw new Error(`report.html of ${id} embeds no images`);
  }
  return JSON.parse(json);
}

async function pngDataUri(file: string): Promise<string> {
  return `data:image/png;base64,${(await readFile(join(cwd, file))).toString('base64')}`;
}

function lines(...output: string[]): string {
  return `${output.join('\n')}\n`;
}

describe('before', () => {
  test('--viewport and --color-scheme multiply the shots of each target', async () => {
    pages.set('/sizes', box('#000'));

    const result = await uiCompare(
      'before',
      `${origin}/sizes`,
      '--viewport',
      '400x300',
      '--viewport',
      '320x240',
      '--color-scheme',
      'light',
      '--color-scheme',
      'dark',
    );

    const id = runIdOf(result.stdout);
    expect(result).toStrictEqual({
      code: 0,
      stderr: '',
      stdout: lines(
        `Captured Before for run ${id} (4 shots)`,
        `  ok        ${origin}/sizes  400x300 light`,
        `  ok        ${origin}/sizes  400x300 dark`,
        `  ok        ${origin}/sizes  320x240 light`,
        `  ok        ${origin}/sizes  320x240 dark`,
        `Next: make the change, then run: ui-compare after ${id}`,
      ),
    });
  });

  test('a page that differs between two loads is reported unstable', async () => {
    let loads = 0;
    pages.set('/unstable', () => {
      loads += 1;
      return html(
        `<div style="width: ${100 + 50 * (loads % 2)}px; height: 20px; background: #000"></div>`,
      );
    });

    const result = await uiCompare(
      'before',
      `${origin}/unstable`,
      '--viewport',
      '400x300',
    );

    const id = runIdOf(result.stdout);
    expect(result).toStrictEqual({
      code: 0,
      stderr: '',
      stdout: lines(
        `Captured Before for run ${id} (1 shot)`,
        `  unstable  ${origin}/unstable  400x300 light  differs between two loads at x=100 y=0 50x20 (0.83%); mask it with --mask and run before again`,
        `Next: make the change, then run: ui-compare after ${id}`,
      ),
    });
    expect(
      existsSync(
        join(
          cwd,
          `.ui-compare/${id}/unstable/001-127-0-0-1-${port}-unstable-400x300-light.png`,
        ),
      ),
    ).toBe(true);
  });

  test('a target that fails to load makes before exit 1', async () => {
    const result = await uiCompare(
      'before',
      `${origin}/missing`,
      '--viewport',
      '400x300',
    );

    const id = runIdOf(result.stdout);
    expect(result).toStrictEqual({
      code: 1,
      stderr: '',
      stdout: lines(
        `Captured Before for run ${id} (1 shot)`,
        `  error     ${origin}/missing  400x300 light  HTTP 404 from ${origin}/missing`,
        `Next: make the change, then run: ui-compare after ${id}`,
      ),
    });
  });

  test('an invalid option value exits 2 with a one-line message', async () => {
    await expect(
      uiCompare('before', `${origin}/sizes`, '--viewport', 'big'),
    ).resolves.toStrictEqual({
      code: 2,
      stdout: '',
      stderr:
        'ui-compare: Invalid viewport: big. Use <width>x<height> with integers from 1 to 10000, such as 1280x720\n',
    });
  });

  test('an unknown option exits 2 with a one-line message', async () => {
    await expect(uiCompare('before', '--bogus', 'x')).resolves.toStrictEqual({
      code: 2,
      stdout: '',
      stderr: 'ui-compare: Unknown option `--bogus`\n',
    });
  });

  test('a file URL with a host exits 2 without creating a run', async () => {
    const result = await uiCompare('before', 'file://dist/index.html');

    expect(result).toStrictEqual({
      code: 2,
      stdout: '',
      stderr:
        'ui-compare: Not a valid file URL: file://dist/index.html (use file:///absolute/path or a plain path)\n',
    });
    expect(existsSync(join(cwd, '.ui-compare'))).toBe(false);
  });
});

describe('after', () => {
  test('an unchanged page exits 0 and writes the report', async () => {
    pages.set('/same', box('#000'));
    const id = await before(`${origin}/same`, '--viewport', '400x300');

    const result = await uiCompare('after', id);

    expect(result).toStrictEqual({
      code: 0,
      stderr: '',
      stdout: lines(
        `Compared run ${id}: 0 changed, 1 unchanged, 0 errors, 0 skipped`,
        `  unchanged  ${origin}/same  400x300 light`,
        `Report:  .ui-compare/${id}/report.html`,
        `Summary: .ui-compare/${id}/summary.json`,
      ),
    });
    expect((await readJson<Summary>(id, 'summary.json')).counts).toStrictEqual({
      changed: 0,
      unchanged: 1,
      error: 0,
      skipped: 0,
    });
    expect(existsSync(join(cwd, `.ui-compare/${id}/report.html`))).toBe(true);
  });

  test('a change is reported with its bounding box and a diff image', async () => {
    pages.set('/change', box('#000'));
    const id = await before(`${origin}/change`, '--viewport', '400x300');
    pages.set('/change', box('#f00'));

    const result = await uiCompare('after', id);

    const diffFile = `.ui-compare/${id}/diff/001-127-0-0-1-${port}-change-400x300-light.png`;
    expect(result).toStrictEqual({
      code: 0,
      stderr: '',
      stdout: lines(
        `Compared run ${id}: 1 changed, 0 unchanged, 0 errors, 0 skipped`,
        `  changed    ${origin}/change  400x300 light  1.00% at x=10 y=20 30x40  ${diffFile}`,
        `Report:  .ui-compare/${id}/report.html`,
        `Summary: .ui-compare/${id}/summary.json`,
      ),
    });
    const [shot] = (await readJson<Summary>(id, 'summary.json')).shots;
    expect(shot?.diff).toStrictEqual({
      mismatchedPixels: 1200,
      mismatchRatio: 0.01,
      bbox: { x: 10, y: 20, width: 30, height: 40 },
    });
    const key = `001-127-0-0-1-${port}-change-400x300-light`;
    expect(await reportImages(id)).toStrictEqual({
      [key]: {
        before: {
          src: await pngDataUri(`.ui-compare/${id}/before/${key}.png`),
          width: 400,
          height: 300,
        },
        after: {
          src: await pngDataUri(`.ui-compare/${id}/after/${key}.png`),
          width: 400,
          height: 300,
        },
        diff: {
          src: await pngDataUri(diffFile),
          width: 400,
          height: 300,
        },
      },
    });
  });

  test('running after again once the change is reverted leaves no diff image', async () => {
    pages.set('/revert', box('#000'));
    const id = await before(`${origin}/revert`, '--viewport', '400x300');
    pages.set('/revert', box('#f00'));
    await uiCompare('after', id);
    pages.set('/revert', box('#000'));

    const result = await uiCompare('after', id);

    expect(result.stdout).toContain(
      `Compared run ${id}: 0 changed, 1 unchanged, 0 errors, 0 skipped\n`,
    );
    expect(
      existsSync(
        join(
          cwd,
          `.ui-compare/${id}/diff/001-127-0-0-1-${port}-revert-400x300-light.png`,
        ),
      ),
    ).toBe(false);
  });

  test('masks given to before also hide the masked area in after', async () => {
    pages.set('/masked', box('#000'));
    const id = await before(
      `${origin}/masked`,
      '--viewport',
      '400x300',
      '--mask',
      '#box',
    );
    pages.set('/masked', box('#f00'));

    const result = await uiCompare('after', id);

    expect(result.stdout).toContain(
      `Compared run ${id}: 0 changed, 1 unchanged, 0 errors, 0 skipped\n`,
    );
  });

  test('a shot that failed in before is an error from the before phase and exits 1', async () => {
    const id = await before(`${origin}/gone`, '--viewport', '400x300');

    const result = await uiCompare('after', id);

    expect(result.code).toBe(1);
    expect(result.stdout).toContain(
      `  error      ${origin}/gone  400x300 light  before: HTTP 404 from ${origin}/gone\n`,
    );
    const [shot] = (await readJson<Summary>(id, 'summary.json')).shots;
    expect(shot?.error).toStrictEqual({
      phase: 'before',
      message: `HTTP 404 from ${origin}/gone`,
    });
  });

  test('a shot that breaks after the change is an error from the after phase and exits 1', async () => {
    pages.set('/breaks', box('#000'));
    const id = await before(`${origin}/breaks`, '--viewport', '400x300');
    pages.delete('/breaks');

    const result = await uiCompare('after', id);

    expect(result).toStrictEqual({
      code: 1,
      stderr: '',
      stdout: lines(
        `Compared run ${id}: 0 changed, 0 unchanged, 1 error, 0 skipped`,
        `  error      ${origin}/breaks  400x300 light  after: HTTP 404 from ${origin}/breaks`,
        `Report:  .ui-compare/${id}/report.html`,
        `Summary: .ui-compare/${id}/summary.json`,
      ),
    });
    const [shot] = (await readJson<Summary>(id, 'summary.json')).shots;
    expect(shot?.error).toStrictEqual({
      phase: 'after',
      message: `HTTP 404 from ${origin}/breaks`,
    });
  });

  test('a shot that was unstable in before is reported unstable by after', async () => {
    const stripe = (width: number) =>
      html(
        `<div style="width: ${width}px; height: 20px; background: #000"></div>`,
      );
    let loads = 0;
    pages.set('/flaky', () => {
      loads += 1;
      return stripe(100 + 50 * (loads % 2));
    });
    const id = await before(`${origin}/flaky`, '--viewport', '400x300');
    pages.set('/flaky', () => stripe(150));

    const result = await uiCompare('after', id);

    expect(result).toStrictEqual({
      code: 0,
      stderr: '',
      stdout: lines(
        `Compared run ${id}: 0 changed, 1 unchanged, 0 errors, 0 skipped`,
        `  unchanged  ${origin}/flaky  400x300 light`,
        '    unstable in Before: differs between two loads at x=100 y=0 50x20 (0.83%)',
        `Report:  .ui-compare/${id}/report.html`,
        `Summary: .ui-compare/${id}/summary.json`,
      ),
    });
    const [shot] = (await readJson<Summary>(id, 'summary.json')).shots;
    const key = `001-127-0-0-1-${port}-flaky-400x300-light`;
    expect({
      unstable: shot?.unstable,
      files: shot?.files,
    }).toStrictEqual({
      unstable: {
        mismatchRatio: 0.008333333333333333,
        bbox: { x: 100, y: 0, width: 50, height: 20 },
      },
      files: {
        before: `before/${key}.png`,
        unstable: `unstable/${key}.png`,
        after: `after/${key}.png`,
      },
    });
  });

  test('a missing run id exits 2 with a one-line message', async () => {
    await expect(uiCompare('after')).resolves.toStrictEqual({
      code: 2,
      stdout: '',
      stderr: 'ui-compare: missing required args for command `after <id>`\n',
    });
  });

  test('an unknown run id exits 2 with a one-line message', async () => {
    await expect(uiCompare('after', 'zzzzzz')).resolves.toStrictEqual({
      code: 2,
      stdout: '',
      stderr:
        'ui-compare: No run zzzzzz in .ui-compare: there are no runs yet. Start one with: ui-compare before <targets...>\n',
    });
  });
});
