import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PNG } from 'pngjs';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'vite-plus/test';

import type { ReviewFile } from '../plugin/hooks/review-file.ts';
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

function blocks(color: string, lefts: number[]): string {
  return lefts
    .map(
      (left) =>
        `<div style="position: absolute; left: ${left}px; top: 20px; width: 30px; height: 40px; background: ${color}"></div>`,
    )
    .join('');
}

function box(color: string): () => string {
  return () => html(blocks(color, [10]));
}

type Story = {
  name: string;
  body: string;
  vrt?: unknown;
  status?: string;
};

// The page stands in for Storybook's preview: it hands over the channel that
// ui-compare listens on, renders, and reports storyFinished with a status
// computed in the page, so a story can fail at some viewports only.
function storyPage({ name, body, vrt = {}, status = "'success'" }: Story) {
  return html(`<div id="root"></div><script>
    globalThis.__STORYBOOK_PREVIEW__ = {
      loadStory: async () => ({ parameters: { vrt: ${JSON.stringify(vrt)} } }),
    };
    setTimeout(() => {
      const listeners = new Map();
      globalThis.__STORYBOOK_ADDONS_CHANNEL__ = {
        on: (event, listener) => listeners.set(event, listener),
      };
      document.getElementById('root').innerHTML = ${JSON.stringify(body)};
      listeners.get('storyFinished')({ storyId: ${JSON.stringify(storyId(name))}, status: ${status} });
    }, 50);
  </script>`);
}

function storyId(name: string): string {
  return `button--${name.toLowerCase()}`;
}

function storybook(path: string, stories: Story[]): string {
  const entries = Object.fromEntries(
    stories.map(({ name }) => [
      storyId(name),
      {
        type: 'story',
        id: storyId(name),
        title: 'Button',
        name,
        importPath: './src/Button.stories.tsx',
      },
    ]),
  );
  pages.set(`${path}/index.json`, () => JSON.stringify({ v: 5, entries }));
  for (const story of stories) {
    pages.set(
      `${path}/iframe.html?id=${storyId(story.name)}&viewMode=story`,
      () => storyPage(story),
    );
  }
  return `${origin}${path}`;
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
  return /^Captured Before for run ([0-9a-z]{6}):/.exec(stdout)?.[1] ?? '';
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

async function embeddedJson(id: string, element: string): Promise<unknown> {
  const report = await readFile(
    join(cwd, '.ui-compare', id, 'report.html'),
    'utf8',
  );
  const json = new RegExp(
    `<script type="application/json" id="${element}">(.*?)</script>`,
    's',
  ).exec(report)?.[1];
  if (json === undefined) {
    throw new Error(`report.html of ${id} embeds no ${element}`);
  }
  return JSON.parse(json);
}

async function pngDataUri(file: string): Promise<string> {
  return `data:image/png;base64,${(await readFile(join(cwd, file))).toString('base64')}`;
}

function decodeDataUri(src: string): PNG {
  return PNG.sync.read(
    Buffer.from(src.slice('data:image/png;base64,'.length), 'base64'),
  );
}

function pixel(image: PNG, x: number, y: number): number[] {
  const offset = (y * image.width + x) * 4;
  return [...image.data.subarray(offset, offset + 4)];
}

function lines(...output: string[]): string {
  return `${output.join('\n')}\n`;
}

describe('before', () => {
  test('the shots of a screen that captured fine share one line, naming only the dark scheme', async () => {
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
        `Captured Before for run ${id}: 1 screen, 4 shots`,
        `  ok        ${origin}/sizes  400x300, 400x300 dark, 320x240, 320x240 dark`,
        `Next: make the change, then run: ui-compare after ${id}`,
      ),
    });
  });

  test('a warning of a group of shots is listed once under its line', async () => {
    pages.set('/warns', () =>
      html('<p>broken</p><script>throw new Error("boom")</script>'),
    );

    const result = await uiCompare(
      'before',
      `${origin}/warns`,
      '--viewport',
      '400x300',
      '--viewport',
      '320x240',
    );

    const id = runIdOf(result.stdout);
    expect(result).toStrictEqual({
      code: 0,
      stderr: '',
      stdout: lines(
        `Captured Before for run ${id}: 1 screen, 2 shots`,
        `  ok        ${origin}/warns  400x300, 320x240`,
        '    warning: Page error: boom',
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
        `Captured Before for run ${id}: 1 screen, 1 shot`,
        `  unstable  ${origin}/unstable  400x300  differs between two loads at x=100 y=0 50x20 (0.83%); mask it with --mask and run before again`,
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
        `Captured Before for run ${id}: 1 screen, 1 shot`,
        `  error     ${origin}/missing  400x300  HTTP 404 from ${origin}/missing`,
        `Next: make the change, then run: ui-compare after ${id}`,
      ),
    });
  });

  test('the stories of a component share a line, and skipped stories share one per reason', async () => {
    const url = storybook('/sb-before', [
      { name: 'Primary', body: blocks('#000', [10]) },
      { name: 'Secondary', body: blocks('#00f', [10]) },
      { name: 'Skipped', body: '', vrt: { skip: true } },
    ]);

    const result = await uiCompare(
      'before',
      '--storybook',
      url,
      '--viewport',
      '400x300',
    );

    const id = runIdOf(result.stdout);
    expect(result).toStrictEqual({
      code: 0,
      stderr: '',
      stdout: lines(
        `Captured Before for run ${id}: 1 screen, 3 shots`,
        '  ok        Button: Primary, Secondary  400x300',
        '  skipped   Button: Skipped  400x300  parameters.vrt.skip',
        `Next: make the change, then run: ui-compare after ${id}`,
      ),
    });
  });

  test('stories captured at different viewports get a line for each set of viewports', async () => {
    const url = storybook('/sb-narrow-error', [
      { name: 'Primary', body: blocks('#000', [10]) },
      {
        name: 'Secondary',
        body: blocks('#00f', [10]),
        status: "innerWidth < 400 ? 'error' : 'success'",
      },
    ]);

    const result = await uiCompare(
      'before',
      '--storybook',
      url,
      '--viewport',
      '400x300',
      '--viewport',
      '320x240',
    );

    const id = runIdOf(result.stdout);
    expect(result).toStrictEqual({
      code: 1,
      stderr: '',
      stdout: lines(
        `Captured Before for run ${id}: 1 screen, 4 shots`,
        '  ok        Button: Primary  400x300, 320x240',
        '  ok        Button: Secondary  400x300',
        '  error     Button: Secondary  320x240  Storybook reported an error while rendering button--secondary',
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
        `Compared run ${id}: 0 screens changed, 0 errors`,
        `  unchanged  ${origin}/same  400x300`,
        `Report:  .ui-compare/${id}/report.html`,
        `Summary: .ui-compare/${id}/summary.json`,
      ),
    });
    expect(existsSync(join(cwd, `.ui-compare/${id}/report.html`))).toBe(true);
  });

  test('a change is listed under its screen with its area and diff image', async () => {
    pages.set('/change', box('#000'));
    const id = await before(`${origin}/change`, '--viewport', '400x300');
    pages.set('/change', box('#f00'));

    const result = await uiCompare('after', id);

    expect(result).toStrictEqual({
      code: 0,
      stderr: '',
      stdout: lines(
        `Compared run ${id}: 1 screen changed, 0 errors`,
        `  changed    ${origin}/change`,
        `    400x300: 1 area at x=10 y=20 30x40  .ui-compare/${id}/diff/001-127-0-0-1-${port}-change-400x300-light.png`,
        `Report:  .ui-compare/${id}/report.html`,
        `Summary: .ui-compare/${id}/summary.json`,
      ),
    });
  });

  test('summary.json records the changed areas of each shot', async () => {
    pages.set('/areas', () => html(blocks('#000', [10, 100])));
    const id = await before(`${origin}/areas`, '--viewport', '400x300');
    pages.set('/areas', () => html(blocks('#f00', [10, 100])));

    await uiCompare('after', id);

    const [shot] = (await readJson<Summary>(id, 'summary.json')).shots;
    expect(shot?.diff).toStrictEqual({
      mismatchedPixels: 2400,
      mismatchRatio: 0.02,
      bbox: { x: 10, y: 20, width: 120, height: 40 },
      regions: [
        { x: 10, y: 20, width: 30, height: 40 },
        { x: 100, y: 20, width: 30, height: 40 },
      ],
    });
  });

  test('the same change at several viewports is listed once with every viewport', async () => {
    pages.set('/both', box('#000'));
    const id = await before(
      `${origin}/both`,
      '--viewport',
      '400x300',
      '--viewport',
      '320x240',
    );
    pages.set('/both', box('#f00'));

    const result = await uiCompare('after', id);

    expect(result.stdout).toBe(
      lines(
        `Compared run ${id}: 1 screen changed, 0 errors`,
        `  changed    ${origin}/both`,
        `    400x300, 320x240: 1 area at x=10 y=20 30x40 (in 400x300)  .ui-compare/${id}/diff/001-127-0-0-1-${port}-both-400x300-light.png`,
        `Report:  .ui-compare/${id}/report.html`,
        `Summary: .ui-compare/${id}/summary.json`,
      ),
    );
  });

  test('a change merged across viewports names the viewport its areas and diff image come from', async () => {
    const page = (color: string) => () =>
      html(
        `<div style="position: absolute; right: 10px; top: 20px; width: 30px; height: 40px; background: ${color}"></div>`,
      );
    pages.set('/right', page('#000'));
    const id = await before(
      `${origin}/right`,
      '--viewport',
      '400x300',
      '--viewport',
      '320x240',
    );
    pages.set('/right', page('#f00'));

    const result = await uiCompare('after', id);

    expect(result.stdout).toContain(
      `    400x300, 320x240: 1 area at x=360 y=20 30x40 (in 400x300)  .ui-compare/${id}/diff/001-127-0-0-1-${port}-right-400x300-light.png\n`,
    );
  });

  test('a change that resizes the page names both page sizes after its areas', async () => {
    pages.set('/grows', box('#000'));
    const id = await before(`${origin}/grows`, '--viewport', '400x300');
    pages.set('/grows', () =>
      html(`${blocks('#000', [10])}<div style="height: 500px"></div>`),
    );

    const result = await uiCompare('after', id);

    expect(result.stdout).toContain(
      `    400x300: 1 area at x=0 y=300 400x200, page size 400x300 -> 400x500  .ui-compare/${id}/diff/001-127-0-0-1-${port}-grows-400x300-light.png\n`,
    );
  });

  test('a change in four areas lists three of them and counts the rest', async () => {
    pages.set('/four', () => html(blocks('#000', [10, 500, 1000, 1500])));
    const id = await before(`${origin}/four`, '--viewport', '1600x900');
    pages.set('/four', () => html(blocks('#f00', [10, 500, 1000, 1500])));

    const result = await uiCompare('after', id);

    expect(result.stdout).toContain(
      `    1600x900: 4 areas at x=10 y=20 30x40, x=500 y=20 30x40, x=1000 y=20 30x40, +1 more  .ui-compare/${id}/diff/001-127-0-0-1-${port}-four-1600x900-light.png\n`,
    );
  });

  test('a change in five areas is reported across the page', async () => {
    const xs = [200, 600, 1000, 1400, 1800];
    pages.set('/five', () => html(blocks('#000', xs)));
    const id = await before(`${origin}/five`, '--viewport', '2000x900');
    pages.set('/five', () => html(blocks('#f00', xs)));

    const result = await uiCompare('after', id);

    expect(result.stdout).toContain(
      `    2000x900: changed across the page  .ui-compare/${id}/diff/001-127-0-0-1-${port}-five-2000x900-light.png\n`,
    );
  });

  test('a warning of a changed shot is listed under its change', async () => {
    const page = (color: string) => () =>
      html(`${blocks(color, [10])}<script>throw new Error("boom")</script>`);
    pages.set('/warned-change', page('#000'));
    const id = await before(`${origin}/warned-change`, '--viewport', '400x300');
    pages.set('/warned-change', page('#f00'));

    const result = await uiCompare('after', id);

    expect(result.stdout).toContain(
      `-warned-change-400x300-light.png\n      warning: Page error: boom\n`,
    );
  });

  test('the stories of a component with the same change are listed once under the component', async () => {
    const stories = (color: string) => [
      { name: 'Primary', body: blocks(color, [10]) },
      { name: 'Secondary', body: blocks(color, [10]) },
      { name: 'Skipped', body: '', vrt: { skip: true } },
    ];
    const url = storybook('/sb-after', stories('#000'));
    const id = await before('--storybook', url, '--viewport', '400x300');
    storybook('/sb-after', stories('#f00'));

    const result = await uiCompare('after', id);

    expect(result).toStrictEqual({
      code: 0,
      stderr: '',
      stdout: lines(
        `Compared run ${id}: 1 screen changed, 0 errors`,
        '  changed    Button (Storybook)',
        `    Primary, Secondary · 400x300: 1 area at x=10 y=20 30x40 (in Primary · 400x300)  .ui-compare/${id}/diff/001-button-primary-400x300-light.png`,
        '  skipped    Button: Skipped  400x300  parameters.vrt.skip',
        `Report:  .ui-compare/${id}/report.html`,
        `Summary: .ui-compare/${id}/summary.json`,
      ),
    });
  });

  test('a change merged across stories names the story and viewport its areas and diff image come from', async () => {
    const body = (color: string) =>
      `<div style="position: absolute; right: 10px; top: 20px; width: 30px; height: 40px; background: ${color}"></div>`;
    const stories = (color: string) => [
      { name: 'Primary', body: body(color) },
      { name: 'Secondary', body: body(color) },
    ];
    const url = storybook('/sb-merged', stories('#000'));
    const id = await before(
      '--storybook',
      url,
      '--viewport',
      '400x300',
      '--viewport',
      '320x240',
    );
    storybook('/sb-merged', stories('#f00'));

    const result = await uiCompare('after', id);

    expect(result.stdout).toContain(
      `    Primary, Secondary · 400x300, 320x240: 1 area at x=360 y=20 30x40 (in Primary · 400x300)  .ui-compare/${id}/diff/001-button-primary-400x300-light.png\n`,
    );
  });

  test('errors come first, then changed screens, then unchanged ones', async () => {
    pages.set('/order-same', box('#000'));
    pages.set('/order-change', box('#000'));
    pages.set('/order-breaks', box('#000'));
    const id = await before(
      `${origin}/order-same`,
      `${origin}/order-change`,
      `${origin}/order-breaks`,
      '--viewport',
      '400x300',
    );
    pages.set('/order-change', box('#f00'));
    pages.delete('/order-breaks');

    const result = await uiCompare('after', id);

    expect(result).toStrictEqual({
      code: 1,
      stderr: '',
      stdout: lines(
        `Compared run ${id}: 1 screen changed, 1 error`,
        `  error      ${origin}/order-breaks  400x300  after: HTTP 404 from ${origin}/order-breaks`,
        `  changed    ${origin}/order-change`,
        `    400x300: 1 area at x=10 y=20 30x40  .ui-compare/${id}/diff/002-127-0-0-1-${port}-order-change-400x300-light.png`,
        `  unchanged  ${origin}/order-same  400x300`,
        `Report:  .ui-compare/${id}/report.html`,
        `Summary: .ui-compare/${id}/summary.json`,
      ),
    });
  });

  test('the report embeds the full Before, After and diff pages of a change from the files on disk', async () => {
    pages.set('/embedded', box('#000'));
    const id = await before(`${origin}/embedded`, '--viewport', '400x300');
    pages.set('/embedded', box('#f00'));

    await uiCompare('after', id);

    const key = `001-127-0-0-1-${port}-embedded-400x300-light`;
    expect(await embeddedJson(id, 'images')).toStrictEqual({
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
          src: await pngDataUri(`.ui-compare/${id}/diff/${key}.png`),
          width: 400,
          height: 300,
        },
      },
    });
  });

  test('the report embeds Before and After crops of the changed area', async () => {
    pages.set('/cropped', box('#000'));
    const id = await before(`${origin}/cropped`, '--viewport', '400x300');
    pages.set('/cropped', box('#f00'));

    await uiCompare('after', id);

    const review = (await embeddedJson(id, 'review')) as {
      changed: Array<{
        changes: Array<{
          crops: Array<Record<'before' | 'after', { src: string }>>;
        }>;
      }>;
    };
    const look = ({ src }: { src: string }) => {
      const image = decodeDataUri(src);
      return {
        size: [image.width, image.height],
        insideTheBox: pixel(image, 20, 30),
      };
    };
    expect(
      review.changed.map(({ changes }) =>
        changes.map(({ crops }) =>
          crops.map((crop) => ({
            before: look(crop.before),
            after: look(crop.after),
          })),
        ),
      ),
    ).toStrictEqual([
      [
        [
          {
            before: { size: [320, 160], insideTheBox: [0, 0, 0, 255] },
            after: { size: [320, 160], insideTheBox: [255, 0, 0, 255] },
          },
        ],
      ],
    ]);
  });

  test('running after again once the change is reverted leaves no diff image', async () => {
    pages.set('/revert', box('#000'));
    const id = await before(`${origin}/revert`, '--viewport', '400x300');
    pages.set('/revert', box('#f00'));
    await uiCompare('after', id);
    pages.set('/revert', box('#000'));

    const result = await uiCompare('after', id);

    expect(result.stdout).toContain(`  unchanged  ${origin}/revert  400x300\n`);
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
      'div',
    );
    pages.set('/masked', box('#f00'));

    const result = await uiCompare('after', id);

    expect(result.stdout).toContain(`  unchanged  ${origin}/masked  400x300\n`);
  });

  test('a shot that failed in before is an error from the before phase and exits 1', async () => {
    const id = await before(`${origin}/gone`, '--viewport', '400x300');

    const result = await uiCompare('after', id);

    expect(result.code).toBe(1);
    expect(result.stdout).toContain(
      `  error      ${origin}/gone  400x300  before: HTTP 404 from ${origin}/gone\n`,
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

    expect(result.code).toBe(1);
    const [shot] = (await readJson<Summary>(id, 'summary.json')).shots;
    expect(shot?.error).toStrictEqual({
      phase: 'after',
      message: `HTTP 404 from ${origin}/breaks`,
    });
  });

  test('a change only where Before was unstable is listed as noise', async () => {
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
    pages.set('/flaky', () => stripe(120));

    const result = await uiCompare('after', id);

    expect(result).toStrictEqual({
      code: 0,
      stderr: '',
      stdout: lines(
        `Compared run ${id}: 0 screens changed, 0 errors`,
        `  noise      ${origin}/flaky  400x300  changed only where it was unstable in Before`,
        `Report:  .ui-compare/${id}/report.html`,
        `Summary: .ui-compare/${id}/summary.json`,
      ),
    });
  });

  test('summary.json keeps the unstable area of Before and its image', async () => {
    const stripe = (width: number) =>
      html(
        `<div style="width: ${width}px; height: 20px; background: #000"></div>`,
      );
    let loads = 0;
    pages.set('/unstable-summary', () => {
      loads += 1;
      return stripe(100 + 50 * (loads % 2));
    });
    const id = await before(
      `${origin}/unstable-summary`,
      '--viewport',
      '400x300',
    );
    pages.set('/unstable-summary', () => stripe(150));

    await uiCompare('after', id);

    const [shot] = (await readJson<Summary>(id, 'summary.json')).shots;
    const key = `001-127-0-0-1-${port}-unstable-summary-400x300-light`;
    expect({
      unstable: shot?.unstable,
      files: shot?.files,
    }).toStrictEqual({
      unstable: {
        mismatchRatio: 0.008333333333333333,
        bbox: { x: 100, y: 0, width: 50, height: 20 },
        regions: [{ x: 100, y: 0, width: 50, height: 20 }],
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

describe('the Claude Code pane', () => {
  const paneAlive = () => join(cwd, '.ui-compare', 'pane-alive');

  async function changedRun(path: string): Promise<string> {
    pages.set(path, box('#000'));
    const id = await before(`${origin}${path}`, '--viewport', '400x300');
    pages.set(path, box('#f00'));
    return id;
  }

  test('while the pane keeps pane-alive fresh, after writes review.json but no report.html and points to the pane', async () => {
    const id = await changedRun('/pane');
    await writeFile(paneAlive(), '');
    const touching = setInterval(() => {
      writeFileSync(paneAlive(), '');
    }, 1000);
    const result = await uiCompare('after', id).finally(() => {
      clearInterval(touching);
    });

    const key = `001-127-0-0-1-${port}-pane-400x300-light`;
    expect(result).toStrictEqual({
      code: 0,
      stderr: '',
      stdout: lines(
        `Compared run ${id}: 1 screen changed, 0 errors`,
        `  changed    ${origin}/pane`,
        `    400x300: 1 area at x=10 y=20 30x40  .ui-compare/${id}/diff/${key}.png`,
        'Report:  shown in the ui-compare pane in Claude Code',
        `Summary: .ui-compare/${id}/summary.json`,
      ),
    });
    expect(existsSync(join(cwd, `.ui-compare/${id}/report.html`))).toBe(false);
    const review = await readJson<ReviewFile>(id, 'review.json');
    expect({
      id: review.id,
      diffs: review.changed.flatMap(({ changes }) =>
        changes.map(({ diff }) => diff),
      ),
      strips: (
        await readdir(join(cwd, '.ui-compare', id, 'review'))
      ).toSorted(),
    }).toStrictEqual({
      id,
      diffs: [`diff/${key}.png`],
      strips: [
        `${key}-crop-0-after-0.png`,
        `${key}-crop-0-before-0.png`,
        `${key}-page-after-0.png`,
        `${key}-page-before-0.png`,
      ],
    });
  });

  test('with a pane-alive left over from a pane that closed, after writes review.json and report.html', async () => {
    const id = await changedRun('/closed-pane');
    await writeFile(paneAlive(), '');
    const stale = new Date(Date.now() - 60_000);
    await utimes(paneAlive(), stale, stale);

    const result = await uiCompare('after', id);

    expect(result.stdout).toContain(
      `\nReport:  .ui-compare/${id}/report.html\n`,
    );
    expect(
      ['report.html', 'review.json'].map((file) =>
        existsSync(join(cwd, '.ui-compare', id, file)),
      ),
    ).toStrictEqual([true, true]);
  });
});
