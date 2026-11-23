import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test';

import { UsageError } from '../src/errors.ts';
import {
  parseViewport,
  resolveShots,
  selectStories,
  shotKey,
} from '../src/targets.ts';
import type { TargetInput } from '../src/targets.ts';

const storyIndex = {
  v: 5,
  entries: {
    'components-button--docs': {
      type: 'docs',
      id: 'components-button--docs',
      title: 'Components/Button',
      name: 'Docs',
      importPath: './src/components/Button.stories.tsx',
      storiesImports: [],
      tags: ['autodocs'],
    },
    'components-button--primary': {
      type: 'story',
      id: 'components-button--primary',
      title: 'Components/Button',
      name: 'Primary',
      importPath: './src/components/Button.stories.tsx',
      tags: ['story'],
    },
    'components-button--secondary': {
      type: 'story',
      id: 'components-button--secondary',
      title: 'Components/Button',
      name: 'Secondary',
      importPath: './src/components/Button.stories.tsx',
      tags: ['story'],
    },
    'pages-settings--default': {
      type: 'story',
      id: 'pages-settings--default',
      title: 'Pages/Settings',
      name: 'Default',
      importPath: './src/pages/Settings.stories.tsx',
      tags: ['story'],
    },
  },
};

const storybook = 'http://localhost:6006';

function input(overrides: Partial<TargetInput>): TargetInput {
  return {
    targets: [],
    stories: [],
    viewports: [],
    colorSchemes: [],
    cwd: '/',
    ...overrides,
  };
}

function requestUrl(request: string | URL | Request): string {
  return request instanceof Request ? request.url : request.toString();
}

function storybookAt(indexUrl: string): typeof fetch {
  return (request) =>
    Promise.resolve(
      requestUrl(request) === indexUrl
        ? Response.json(storyIndex)
        : new Response('Not Found', { status: 404 }),
    );
}

const runningStorybook = storybookAt('http://localhost:6006/index.json');

describe('resolveShots', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ui-compare-targets-'));
    await writeFile(join(dir, 'page.html'), '<p>page</p>');
    await writeFile(join(dir, 'my page.html'), '<p>page</p>');
    await mkdir(join(dir, 'pages'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('captures a URL at 1280x720 in light by default', async () => {
    expect(
      await resolveShots(input({ targets: ['http://localhost:5173'] })),
    ).toStrictEqual([
      {
        key: '001-localhost-5173-1280x720-light',
        target: { kind: 'url', url: 'http://localhost:5173/' },
        viewport: { width: 1280, height: 720 },
        colorScheme: 'light',
      },
    ]);
  });

  test('keeps a file:// URL as a URL even when the file does not exist', async () => {
    const shots = await resolveShots(
      input({ targets: ['file:///nowhere/page.html'] }),
    );

    expect(shots.map((shot) => shot.target)).toStrictEqual([
      { kind: 'url', url: 'file:///nowhere/page.html' },
    ]);
  });

  test.each([
    'file://dist/index.html',
    'file://./page.html',
    'file:///tmp/a%2Fb.html',
  ])('rejects %s, which names no local file', async (value) => {
    await expect(
      resolveShots(input({ targets: [value] })),
    ).rejects.toStrictEqual(
      new UsageError(
        `Not a valid file URL: ${value} (use file:///absolute/path or a plain path)`,
      ),
    );
  });

  test('rejects a malformed URL', async () => {
    await expect(
      resolveShots(input({ targets: ['http://'] })),
    ).rejects.toStrictEqual(new UsageError('Not a valid URL: http://'));
  });

  test('turns a path relative to cwd into a file URL', async () => {
    const shots = await resolveShots(
      input({ targets: ['my page.html'], cwd: dir }),
    );

    expect(shots.map((shot) => shot.target)).toStrictEqual([
      { kind: 'url', url: `file://${dir}/my%20page.html` },
    ]);
  });

  test('turns an absolute path into a file URL', async () => {
    const shots = await resolveShots(
      input({ targets: [join(dir, 'page.html')] }),
    );

    expect(shots.map((shot) => shot.target)).toStrictEqual([
      { kind: 'url', url: `file://${dir}/page.html` },
    ]);
  });

  test('rejects a path that does not exist', async () => {
    await expect(
      resolveShots(input({ targets: ['missing.html'], cwd: dir })),
    ).rejects.toStrictEqual(
      new UsageError('Not a URL or an existing file: missing.html'),
    );
  });

  test('rejects a path to a directory', async () => {
    await expect(
      resolveShots(input({ targets: ['pages'], cwd: dir })),
    ).rejects.toStrictEqual(
      new UsageError('Not a URL or an existing file: pages'),
    );
  });

  test('rejects a run with no targets and no Storybook', async () => {
    await expect(resolveShots(input({}))).rejects.toStrictEqual(
      new UsageError(
        'Nothing to capture: pass URLs, HTML files, or --storybook',
      ),
    );
  });

  test('rejects story patterns without a Storybook', async () => {
    await expect(
      resolveShots(
        input({
          targets: ['http://localhost:5173'],
          stories: ['button--primary'],
        }),
      ),
    ).rejects.toStrictEqual(
      new UsageError('Selecting stories requires --storybook <url>'),
    );
  });

  test('rejects an invalid color scheme', async () => {
    await expect(
      resolveShots(
        input({ targets: ['http://localhost:5173'], colorSchemes: ['auto'] }),
      ),
    ).rejects.toStrictEqual(
      new UsageError('Invalid color scheme: auto. Use light or dark'),
    );
  });

  test('rejects an invalid viewport', async () => {
    await expect(
      resolveShots(
        input({ targets: ['http://localhost:5173'], viewports: ['1280'] }),
      ),
    ).rejects.toStrictEqual(
      new UsageError(
        'Invalid viewport: 1280. Use <width>x<height> with integers from 1 to 10000, such as 1280x720',
      ),
    );
  });

  test('orders shots by target, then viewport, then color scheme', async () => {
    const shots = await resolveShots(
      input({
        targets: ['http://localhost:5173/a', 'http://localhost:5173/b'],
        viewports: ['1280x720', '375x667'],
        colorSchemes: ['light', 'dark'],
      }),
    );

    expect(shots.map((shot) => shot.key)).toStrictEqual([
      '001-localhost-5173-a-1280x720-light',
      '002-localhost-5173-a-1280x720-dark',
      '003-localhost-5173-a-375x667-light',
      '004-localhost-5173-a-375x667-dark',
      '005-localhost-5173-b-1280x720-light',
      '006-localhost-5173-b-1280x720-dark',
      '007-localhost-5173-b-375x667-light',
      '008-localhost-5173-b-375x667-dark',
    ]);
  });

  test('captures a URL given twice once', async () => {
    const shots = await resolveShots(
      input({ targets: ['http://localhost:5173', 'http://localhost:5173/'] }),
    );

    expect(shots.map((shot) => shot.key)).toStrictEqual([
      '001-localhost-5173-1280x720-light',
    ]);
  });

  test('captures a file given by relative and absolute path once', async () => {
    const shots = await resolveShots(
      input({ targets: ['page.html', join(dir, 'page.html')], cwd: dir }),
    );

    expect(shots.map((shot) => shot.key)).toStrictEqual([
      '001-page-html-1280x720-light',
    ]);
  });

  test('drops repeated viewports and color schemes', async () => {
    const shots = await resolveShots(
      input({
        targets: ['http://localhost:5173'],
        viewports: ['1280x720', '1280X720'],
        colorSchemes: ['dark', 'dark'],
      }),
    );

    expect(shots.map((shot) => shot.key)).toStrictEqual([
      '001-localhost-5173-1280x720-dark',
    ]);
  });

  test('captures every story of a Storybook when no pattern is given', async () => {
    const shots = await resolveShots(input({ storybook }), {
      fetch: runningStorybook,
    });

    expect(shots.map((shot) => shot.key)).toStrictEqual([
      '001-components-button-primary-1280x720-light',
      '002-components-button-secondary-1280x720-light',
      '003-pages-settings-default-1280x720-light',
    ]);
  });

  test('builds a story shot that points at the story iframe', async () => {
    const shots = await resolveShots(
      input({ storybook, stories: ['pages-settings--default'] }),
      {
        fetch: runningStorybook,
      },
    );

    expect(shots).toStrictEqual([
      {
        key: '001-pages-settings-default-1280x720-light',
        target: {
          kind: 'story',
          url: 'http://localhost:6006/iframe.html?id=pages-settings--default&viewMode=story',
          storyId: 'pages-settings--default',
          title: 'Pages/Settings',
          name: 'Default',
          importPath: './src/pages/Settings.stories.tsx',
        },
        viewport: { width: 1280, height: 720 },
        colorScheme: 'light',
      },
    ]);
  });

  test('captures positional targets before stories', async () => {
    const shots = await resolveShots(
      input({
        targets: ['http://localhost:5173/'],
        storybook,
        stories: ['pages-settings--default'],
      }),
      { fetch: runningStorybook },
    );

    expect(shots.map((shot) => shot.key)).toStrictEqual([
      '001-localhost-5173-1280x720-light',
      '002-pages-settings-default-1280x720-light',
    ]);
  });

  test.each([
    {
      base: 'http://localhost:6006',
      indexUrl: 'http://localhost:6006/index.json',
      storyUrl:
        'http://localhost:6006/iframe.html?id=pages-settings--default&viewMode=story',
    },
    {
      base: 'http://localhost:6006/',
      indexUrl: 'http://localhost:6006/index.json',
      storyUrl:
        'http://localhost:6006/iframe.html?id=pages-settings--default&viewMode=story',
    },
    {
      base: 'http://localhost:8080/storybook',
      indexUrl: 'http://localhost:8080/storybook/index.json',
      storyUrl:
        'http://localhost:8080/storybook/iframe.html?id=pages-settings--default&viewMode=story',
    },
    {
      base: 'http://localhost:6006/?path=/story/components-button--primary',
      indexUrl: 'http://localhost:6006/index.json',
      storyUrl:
        'http://localhost:6006/iframe.html?id=pages-settings--default&viewMode=story',
    },
  ])(
    'loads index.json from $indexUrl for --storybook $base',
    async ({ base, indexUrl, storyUrl }) => {
      const shots = await resolveShots(
        input({ storybook: base, stories: ['pages-settings--default'] }),
        {
          fetch: storybookAt(indexUrl),
        },
      );

      expect(shots.map((shot) => shot.target.url)).toStrictEqual([storyUrl]);
    },
  );

  test('rejects a Storybook URL without http(s)', async () => {
    await expect(
      resolveShots(input({ storybook: 'localhost:6006' }), {
        fetch: runningStorybook,
      }),
    ).rejects.toStrictEqual(
      new UsageError(
        '--storybook must be an http(s) URL such as http://localhost:6006, got: localhost:6006',
      ),
    );
  });

  test('reports an unreachable Storybook', async () => {
    const refused: typeof fetch = () =>
      Promise.reject(new TypeError('fetch failed'));

    await expect(
      resolveShots(input({ storybook }), { fetch: refused }),
    ).rejects.toStrictEqual(
      new UsageError(
        'Could not load index.json from http://localhost:6006/index.json (request failed). storybook dev must be running at the --storybook URL',
      ),
    );
  });

  test('reports a Storybook URL that answers with an error status', async () => {
    const notFound: typeof fetch = () =>
      Promise.resolve(new Response('Not Found', { status: 404 }));

    await expect(
      resolveShots(input({ storybook }), { fetch: notFound }),
    ).rejects.toStrictEqual(
      new UsageError(
        'Could not load index.json from http://localhost:6006/index.json (HTTP 404). storybook dev must be running at the --storybook URL',
      ),
    );
  });

  test('reports a Storybook URL that answers with something other than JSON', async () => {
    const spaFallback: typeof fetch = () =>
      Promise.resolve(new Response('<!doctype html><title>App</title>'));

    await expect(
      resolveShots(input({ storybook }), { fetch: spaFallback }),
    ).rejects.toStrictEqual(
      new UsageError(
        'Could not load index.json from http://localhost:6006/index.json (response is not JSON). storybook dev must be running at the --storybook URL',
      ),
    );
  });
});

describe('selectStories', () => {
  const ids = (patterns: string[]) =>
    selectStories(storyIndex, patterns, storybook).map(
      (story) => story.storyId,
    );

  test('selects a story by id', () => {
    expect(ids(['components-button--secondary'])).toStrictEqual([
      'components-button--secondary',
    ]);
  });

  test('selects stories whose file matches a glob', () => {
    expect(ids(['src/components/**'])).toStrictEqual([
      'components-button--primary',
      'components-button--secondary',
    ]);
  });

  test('accepts a glob that starts with ./', () => {
    expect(ids(['./src/pages/*.stories.tsx'])).toStrictEqual([
      'pages-settings--default',
    ]);
  });

  test.each([
    {
      pattern: 'src/app/[locale]/Header.stories.tsx',
      storyId: 'app-header--default',
    },
    {
      pattern: './src/app/[...slug]/Page.stories.tsx',
      storyId: 'app-page--default',
    },
  ])(
    'selects the stories of $pattern, a file under a bracketed route folder',
    ({ pattern, storyId }) => {
      const routeIndex = {
        v: 5,
        entries: {
          'app-header--default': {
            type: 'story',
            id: 'app-header--default',
            title: 'App/Header',
            name: 'Default',
            importPath: './src/app/[locale]/Header.stories.tsx',
          },
          'app-page--default': {
            type: 'story',
            id: 'app-page--default',
            title: 'App/Page',
            name: 'Default',
            importPath: './src/app/[...slug]/Page.stories.tsx',
          },
        },
      };

      expect(
        selectStories(routeIndex, [pattern], storybook).map(
          (story) => story.storyId,
        ),
      ).toStrictEqual([storyId]);
    },
  );

  test('selects every story but no docs entry when no pattern is given', () => {
    expect(ids([])).toStrictEqual([
      'components-button--primary',
      'components-button--secondary',
      'pages-settings--default',
    ]);
  });

  test('does not select a docs entry by its id', () => {
    expect(() => ids(['components-button--docs'])).toThrow(
      new UsageError(
        'No story matches components-button--docs. Pass a story id or a glob over story files, such as src/**/*.stories.tsx',
      ),
    );
  });

  test('rejects a pattern that selects no story', () => {
    expect(() => ids(['src/pages/**', 'src/missing/**'])).toThrow(
      new UsageError(
        'No story matches src/missing/**. Pass a story id or a glob over story files, such as src/**/*.stories.tsx',
      ),
    );
  });

  test('keeps index order and lists a story matched twice once', () => {
    expect(
      ids([
        'pages-settings--default',
        'src/**/*.stories.tsx',
        'components-button--primary',
      ]),
    ).toStrictEqual([
      'components-button--primary',
      'components-button--secondary',
      'pages-settings--default',
    ]);
  });

  test.each([
    { shape: 'null', index: null },
    { shape: 'a Storybook 6 stories.json', index: { v: 3, stories: {} } },
    { shape: 'entries as an array', index: { v: 5, entries: [] } },
    {
      shape: 'a story without importPath',
      index: {
        v: 5,
        entries: { a: { type: 'story', id: 'a', title: 'A', name: 'A' } },
      },
    },
  ])('rejects $shape as an unsupported index', ({ index }) => {
    expect(() => selectStories(index, [], storybook)).toThrow(
      new UsageError(
        'Unsupported index.json: Storybook 8.5 or later is required',
      ),
    );
  });
});

describe('parseViewport', () => {
  test.each([
    { value: '1280x720', viewport: { width: 1280, height: 720 } },
    { value: '390X844', viewport: { width: 390, height: 844 } },
    { value: '1x10000', viewport: { width: 1, height: 10_000 } },
  ])('parses $value', ({ value, viewport }) => {
    expect(parseViewport(value)).toStrictEqual(viewport);
  });

  test.each([
    '1280',
    '0x720',
    '1280x10001',
    '1280x720.5',
    ' 1280x720',
    '1280*720',
    '-1x720',
    '',
  ])('rejects "%s"', (value) => {
    expect(() => parseViewport(value)).toThrow(
      new UsageError(
        `Invalid viewport: ${value}. Use <width>x<height> with integers from 1 to 10000, such as 1280x720`,
      ),
    );
  });
});

describe('shotKey', () => {
  const desktop = { width: 1280, height: 720 };

  test('names an http URL after its host, path and query', () => {
    expect(
      shotKey(
        1,
        { kind: 'url', url: 'http://localhost:5173/settings/profile?tab=2' },
        desktop,
        'light',
      ),
    ).toBe('001-localhost-5173-settings-profile-tab-2-1280x720-light');
  });

  test('names a file URL after its file name', () => {
    expect(
      shotKey(
        2,
        { kind: 'url', url: 'file:///Users/me/proj/Settings%20Page.html' },
        { width: 375, height: 667 },
        'dark',
      ),
    ).toBe('002-settings-page-html-375x667-dark');
  });

  test('names a story after its id', () => {
    expect(
      shotKey(
        12,
        {
          kind: 'story',
          url: 'http://localhost:6006/iframe.html?id=components-button--primary&viewMode=story',
          storyId: 'components-button--primary',
          title: 'Components/Button',
          name: 'Primary',
          importPath: './src/components/Button.stories.tsx',
        },
        desktop,
        'light',
      ),
    ).toBe('012-components-button-primary-1280x720-light');
  });

  test('keeps only lowercase letters, digits and single hyphens', () => {
    expect(
      shotKey(
        1,
        { kind: 'url', url: 'https://Example.test/A_B/x|y*z.html?q=a:b&C=D' },
        desktop,
        'light',
      ),
    ).toBe('001-example-test-a-b-x-y-z-html-q-a-b-c-d-1280x720-light');
  });

  test('cuts the name at 60 characters without a trailing hyphen', () => {
    expect(
      shotKey(
        1,
        {
          kind: 'url',
          url: 'http://localhost/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/tail',
        },
        desktop,
        'light',
      ),
    ).toBe(
      '001-localhost-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-1280x720-light',
    );
  });

  test('falls back to page when nothing is left of the name', () => {
    expect(
      shotKey(
        1,
        { kind: 'url', url: 'file:///tmp/%E8%A8%AD%E5%AE%9A' },
        desktop,
        'light',
      ),
    ).toBe('001-page-1280x720-light');
  });

  test('pads the index to three digits', () => {
    expect(
      shotKey(
        7,
        { kind: 'url', url: 'http://localhost:3000/' },
        desktop,
        'dark',
      ),
    ).toBe('007-localhost-3000-1280x720-dark');
  });
});
