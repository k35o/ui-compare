import { stat } from 'node:fs/promises';
import { matchesGlob, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { UsageError } from './errors.ts';
import type {
  ColorScheme,
  Shot,
  StoryTarget,
  Target,
  Viewport,
} from './types.ts';

export type TargetInput = {
  targets: string[];
  storybook?: string;
  stories: string[];
  viewports: string[];
  colorSchemes: string[];
  cwd: string;
};

type StoryEntry = {
  id: string;
  title: string;
  name: string;
  importPath: string;
};

const DEFAULT_VIEWPORT = '1280x720';
const DEFAULT_COLOR_SCHEME = 'light';
const MAX_VIEWPORT_SIDE = 10_000;
const MAX_SLUG_LENGTH = 60;

export async function resolveShots(
  input: TargetInput,
  deps: { fetch?: typeof fetch } = {},
): Promise<Shot[]> {
  if (input.stories.length > 0 && input.storybook === undefined) {
    throw new UsageError('Selecting stories requires --storybook <url>');
  }
  if (input.targets.length === 0 && input.storybook === undefined) {
    throw new UsageError(
      'Nothing to capture: pass URLs, HTML files, or --storybook',
    );
  }

  const viewports = uniqueBy(
    (input.viewports.length > 0 ? input.viewports : [DEFAULT_VIEWPORT]).map(
      parseViewport,
    ),
    (viewport) => `${viewport.width}x${viewport.height}`,
  );
  const colorSchemes = [
    ...new Set(
      (input.colorSchemes.length > 0
        ? input.colorSchemes
        : [DEFAULT_COLOR_SCHEME]
      ).map(parseColorScheme),
    ),
  ];

  const targets: Target[] = [];
  for (const value of input.targets) {
    targets.push(await resolveTarget(value, input.cwd));
  }
  if (input.storybook !== undefined) {
    const index = await loadStoryIndex(
      input.storybook,
      deps.fetch ?? globalThis.fetch,
    );
    targets.push(...selectStories(index, input.stories, input.storybook));
  }

  return uniqueBy(targets, (target) => target.url)
    .flatMap((target) =>
      viewports.flatMap((viewport) =>
        colorSchemes.map((colorScheme) => ({ target, viewport, colorScheme })),
      ),
    )
    .map(({ target, viewport, colorScheme }, i) => ({
      key: shotKey(i + 1, target, viewport, colorScheme),
      target,
      viewport,
      colorScheme,
    }));
}

export function parseViewport(value: string): Viewport {
  const match = /^(\d+)[xX](\d+)$/.exec(value);
  const width = Number(match?.[1]);
  const height = Number(match?.[2]);
  if (!isViewportSide(width) || !isViewportSide(height)) {
    throw new UsageError(
      `Invalid viewport: ${value}. Use <width>x<height> with integers from 1 to ${MAX_VIEWPORT_SIDE}, such as 1280x720`,
    );
  }
  return { width, height };
}

export function selectStories(
  index: unknown,
  patterns: string[],
  storybookUrl: string,
): StoryTarget[] {
  const stories = storyEntries(index);
  const base = storybookBase(storybookUrl);
  for (const pattern of patterns) {
    if (!stories.some((story) => matchesStory(story, pattern))) {
      throw new UsageError(
        `No story matches ${pattern}. Pass a story id or a glob over story files, such as src/**/*.stories.tsx`,
      );
    }
  }
  return stories
    .filter(
      (story) =>
        patterns.length === 0 ||
        patterns.some((pattern) => matchesStory(story, pattern)),
    )
    .map((story) => ({
      kind: 'story',
      url: new URL(
        `iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story`,
        base,
      ).href,
      storyId: story.id,
      title: story.title,
      name: story.name,
      importPath: story.importPath,
    }));
}

export function shotKey(
  index: number,
  target: Target,
  viewport: Viewport,
  colorScheme: ColorScheme,
): string {
  return [
    String(index).padStart(3, '0'),
    slugify(slugSource(target)),
    `${viewport.width}x${viewport.height}`,
    colorScheme,
  ].join('-');
}

async function resolveTarget(value: string, cwd: string): Promise<Target> {
  if (/^(?:https?|file):\/\//.test(value)) {
    const url = URL.parse(value);
    if (url === null) {
      throw new UsageError(`Not a valid URL: ${value}`);
    }
    if (url.protocol === 'file:') {
      try {
        fileURLToPath(url);
      } catch {
        throw new UsageError(
          `Not a valid file URL: ${value} (use file:///absolute/path or a plain path)`,
        );
      }
    }
    return { kind: 'url', url: url.href };
  }
  const path = resolve(cwd, value);
  const isFile = await stat(path).then(
    (stats) => stats.isFile(),
    () => false,
  );
  if (!isFile) {
    throw new UsageError(`Not a URL or an existing file: ${value}`);
  }
  return { kind: 'url', url: pathToFileURL(path).href };
}

async function loadStoryIndex(
  storybook: string,
  fetchIndex: typeof fetch,
): Promise<unknown> {
  const url = new URL('index.json', storybookBase(storybook)).href;
  const failure = (reason: string) =>
    new UsageError(
      `Could not load index.json from ${url} (${reason}). storybook dev must be running at the --storybook URL`,
    );
  const response = await fetchIndex(url).catch(() => {
    throw failure('request failed');
  });
  if (!response.ok) {
    throw failure(`HTTP ${response.status}`);
  }
  const index: unknown = await response.json().catch(() => {
    throw failure('response is not JSON');
  });
  return index;
}

function storybookBase(value: string): URL {
  const base = URL.parse(value);
  if (
    base === null ||
    (base.protocol !== 'http:' && base.protocol !== 'https:')
  ) {
    throw new UsageError(
      `--storybook must be an http(s) URL such as http://localhost:6006, got: ${value}`,
    );
  }
  if (!base.pathname.endsWith('/')) {
    base.pathname += '/';
  }
  return base;
}

function storyEntries(index: unknown): StoryEntry[] {
  if (
    !isRecord(index) ||
    typeof index.v !== 'number' ||
    !isRecord(index.entries)
  ) {
    throw unsupportedIndex();
  }
  const stories = Object.values(index.entries).filter(
    (entry) => isRecord(entry) && entry.type === 'story',
  );
  if (!stories.every(isStoryEntry)) {
    throw unsupportedIndex();
  }
  return stories;
}

function unsupportedIndex(): UsageError {
  return new UsageError(
    'Unsupported index.json: Storybook 8.5 or later is required',
  );
}

function isStoryEntry(entry: unknown): entry is StoryEntry {
  return (
    isRecord(entry) &&
    typeof entry.id === 'string' &&
    typeof entry.title === 'string' &&
    typeof entry.name === 'string' &&
    typeof entry.importPath === 'string'
  );
}

function matchesStory(story: StoryEntry, pattern: string): boolean {
  const importPath = withoutDotSlash(story.importPath);
  const path = withoutDotSlash(pattern);
  // Route folders such as [locale] or [...slug] read as character classes in
  // a glob, so the literal path of their story file would match nothing.
  return (
    story.id === pattern || importPath === path || matchesGlob(importPath, path)
  );
}

function withoutDotSlash(path: string): string {
  return path.replace(/^\.\//, '');
}

function slugSource(target: Target): string {
  if (target.kind === 'story') {
    return target.storyId;
  }
  const url = new URL(target.url);
  if (url.protocol === 'file:') {
    // Percent escapes stand for spaces or non-ASCII bytes, which the slug turns
    // into '-' anyway; decodeURIComponent would throw on a stray '%' typed in a
    // file:// URL.
    return url.pathname
      .slice(url.pathname.lastIndexOf('/') + 1)
      .replaceAll(/%[0-9a-f]{2}/gi, '-');
  }
  return url.host + url.pathname + url.search;
}

function slugify(source: string): string {
  const slug = source
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-$/, '');
  return slug === '' ? 'page' : slug;
}

function parseColorScheme(value: string): ColorScheme {
  if (value === 'light' || value === 'dark') {
    return value;
  }
  throw new UsageError(`Invalid color scheme: ${value}. Use light or dark`);
}

function isViewportSide(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_VIEWPORT_SIDE;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const item of items) {
    const itemKey = key(item);
    if (!byKey.has(itemKey)) {
      byKey.set(itemKey, item);
    }
  }
  return [...byKey.values()];
}
