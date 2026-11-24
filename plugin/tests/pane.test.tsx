import type { On } from 'claude-code';
import { expect, test } from 'claude-code/testing';
import type { Engine } from 'claude-code/testing';

import type { ReviewFile, ReviewPage } from '../hooks/review-file';
import { image, PANE, PIXEL, REVIEW, RUN } from './fixture';

type World = {
  language?: string;
  base64Of?: (path: string) => string | undefined;
  review?: { mtimeMs: number };
  text?: string;
};

type Seen = { reads: string[]; toasts: string[] };

type Drawn = {
  props: Record<string, unknown>;
  hover?: Record<string, unknown>;
};

function world(
  on: On,
  {
    language,
    base64Of,
    review = { mtimeMs: 5000 },
    text = JSON.stringify(REVIEW),
  }: World = {},
): Seen {
  const seen: Seen = { reads: [], toasts: [] };
  on('settings.read', () => ({
    value: language === undefined ? {} : { language },
  }));
  on('fs.list', () => ({
    value: [{ name: RUN, kind: 'dir', size: 0, mtimeMs: 0, isLink: false }],
  }));
  on('fs.stat', () => ({
    value: { kind: 'file', size: 1, mtimeMs: review.mtimeMs, isLink: false },
  }));
  on('fs.read', (_, e) => {
    seen.reads.push(e.path);
    return e.as === 'bytes'
      ? { value: { base64: base64Of?.(e.path) ?? PIXEL } }
      : { value: text };
  });
  on('ui.open', () => ({ value: { isPlaced: true } }));
  on('ui.toast', (_, e) => {
    seen.toasts.push(e.text);
    return { value: undefined };
  });
  return seen;
}

async function showLatestRun($: Engine): Promise<void> {
  await $.command.run({
    command: 'ui-compare-pane',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 200 },
  });
}

type Found = { props: Record<string, unknown> };

async function layers(
  ui: { findAll: (query: { type: string }) => Promise<Found[]> },
  label: string,
) {
  const svgs = await ui.findAll({ type: 'Svg' });
  const sourcesOf = (kind: string) =>
    svgs
      .filter(({ props }) => props.alt === `${kind}: ${label}, full page`)
      .map(({ props }) => String(props.source));
  return { before: sourcesOf('Before'), after: sourcesOf('After') };
}

function frame(sources: readonly string[]) {
  const sizes = sources.map((source) => {
    const [, width, height] =
      /^<svg [^>]*?width="([^"]+)" height="([^"]+)"/.exec(source) ?? [];
    return { width: Number(width), height: Number(height) };
  });
  return {
    widths: [...new Set(sizes.map(({ width }) => width))],
    height: sizes.reduce((sum, { height }) => sum + height, 0),
  };
}

function withHomePage(page: ReviewPage): ReviewFile {
  return {
    ...REVIEW,
    changed: REVIEW.changed.map((screen, index) =>
      index === 0
        ? {
            ...screen,
            changes: screen.changes.map((change) => ({ ...change, page })),
          }
        : screen,
    ),
  };
}

async function texts(ui: {
  findAll: (query: { type: string }) => Promise<Array<{ text: string }>>;
}) {
  return (await ui.findAll({ type: 'Text' })).map(({ text }) => text);
}

test('the header counts screens and lists the other counts', async ($, on) => {
  world(on);
  await showLatestRun($);

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });

  expect(await texts(ui)).toEqual(
    expect.arrayContaining([
      'ui-compare · abc123',
      '3 screens changed',
      '1 screen could not be captured, 1 screen changed only where Before was unstable, 1 screen unchanged, and 1 screen skipped.',
    ]),
  );
  await ui.unmount();
});

test('capture errors come before the changed screens', async ($, on) => {
  world(on);
  await showLatestRun($);

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  const shown = await texts(ui);

  expect(shown.indexOf('Could not capture')).toBeLessThan(
    shown.indexOf('http://localhost:5173/'),
  );
  expect(shown).toContain('net::ERR_CONNECTION_REFUSED');
  expect(shown).toContain('1280×720 · Failed while capturing After');
  await ui.unmount();
});

test('a crop shows Before above After, each outlined in red around the changed area', async ($, on) => {
  world(on);
  await showLatestRun($);

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  const [before, after] = await ui.findAll({ type: 'Svg' });

  expect(before?.props.alt).toBe('Before: http://localhost:5173/');
  expect(after?.props.alt).toBe('After: http://localhost:5173/');
  for (const svg of [before, after]) {
    expect(String(svg?.props.source)).toContain(
      `href="data:image/png;base64,${PIXEL}"`,
    );
    expect(String(svg?.props.source)).toContain(
      '<rect x="44" y="56" width="128" height="48" rx="2" fill="none" stroke="#e5484d" stroke-width="2"/>',
    );
  }
  await ui.unmount();
});

test('a change with several areas labels each and notes its variants', async ($, on) => {
  world(on);
  await showLatestRun($);

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });

  expect(await texts(ui)).toEqual(
    expect.arrayContaining([
      'Storybook',
      'Primary · 1280×720 and 1280×720 dark',
      'The same change appears in each of these.',
      'Warning: Fonts were still loading',
      'Area 1 of 2',
      'Area 2 of 2',
    ]),
  );
  await ui.unmount();
});

test('a full-page change shows the page and its size change without a toggle', async ($, on) => {
  world(on);
  await showLatestRun($);

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  const pages = (await ui.findAll({ type: 'Svg' })).filter(
    ({ props }) =>
      props.alt === 'After: http://localhost:5173/pricing, full page',
  );

  expect(pages).toHaveLength(2);
  expect(await texts(ui)).toContain('Page size 1280×720 → 1280×1100');
  expect(await ui.find({ key: 'page:change:2:0' })).toBeUndefined();
  await ui.unmount();
});

test('the other results list noise, unchanged and skipped screens last', async ($, on) => {
  world(on);
  await showLatestRun($);

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  const shown = await texts(ui);

  expect(shown.indexOf('Other results')).toBeGreaterThan(
    shown.indexOf('http://localhost:5173/pricing'),
  );
  expect(shown).toEqual(
    expect.arrayContaining([
      'Likely noise',
      'Changed only where the page already differed between two loads in Before.',
      'Unchanged',
      'Skipped',
      'Redirected to a login page',
    ]),
  );
  expect((await ui.find({ key: 'page:noise:0' }))?.props.label).toBe(
    'Show page',
  );
  expect(await ui.find({ key: 'page:skipped:0' })).toBeUndefined();
  await ui.unmount();
});

test('View full page shows the After page, with Before under the pointer', async ($, on) => {
  world(on);
  await showLatestRun($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });

  await ui.press({ key: 'page:change:0:0' });
  const swap = await ui.find({ key: 'swap:change:0:0' });
  const overlay = (swap?.children as Drawn[] | undefined)?.find(
    ({ props }) => props.position === 'absolute',
  );

  expect(swap?.props.position).toBe('relative');
  expect(overlay).toMatchObject({
    props: { top: 0, left: 0, display: 'none' },
    hover: { display: 'flex' },
  });
  expect(
    (await ui.findAll({ type: 'Svg' }))
      .filter(({ props }) =>
        String(props.alt).endsWith('http://localhost:5173/, full page'),
      )
      .map(({ props }) => props.alt),
  ).toEqual([
    'After: http://localhost:5173/, full page',
    'After: http://localhost:5173/, full page',
    'Before: http://localhost:5173/, full page',
  ]);
  expect((await ui.find({ key: 'page:change:0:0' }))?.props.label).toBe(
    'Hide full page',
  );
  await ui.unmount();
});

test('pressing View full page again hides the page', async ($, on) => {
  world(on);
  await showLatestRun($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });

  await ui.press({ key: 'page:change:0:0' });
  await ui.press({ key: 'page:change:0:0' });

  expect(await ui.find({ key: 'swap:change:0:0' })).toBeUndefined();
  expect((await ui.find({ key: 'page:change:0:0' }))?.props.label).toBe(
    'View full page',
  );
  await ui.unmount();
});

test('Not intended appends a draft naming the run, areas and images to the prompt', async ($, on) => {
  world(on);
  const fills: Array<{ text: string; mode: string }> = [];
  on('prompt.read', () => ({
    value: { text: 'Also check the footer', cursor: 21 },
  }));
  on('prompt.fill', (_, e) => {
    fills.push({ text: e.text, mode: e.mode });
    return { isFilled: true, text: e.text, cursor: e.text.length };
  });
  await showLatestRun($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });

  await ui.press({ key: 'draft:change:0:0' });

  expect(fills).toEqual([
    {
      mode: 'append',
      text: [
        '',
        '',
        'ui-compare run abc123 shows a change I did not intend.',
        'Screen: http://localhost:5173/',
        'Conditions: 1280×720',
        'Changed areas (page coordinates): x=100 y=200 120×40',
        'Diff image: .ui-compare/abc123/diff/home.png',
        'After image: .ui-compare/abc123/review/home-crop-after-0.png',
        'Find what caused it and fix it.',
        '',
      ].join('\n'),
    },
  ]);
  await ui.unmount();
});

test('Not intended turns into a note once the draft is in the prompt', async ($, on) => {
  world(on);
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }));
  on('prompt.fill', (_, e) => ({
    isFilled: true,
    text: e.text,
    cursor: e.text.length,
  }));
  await showLatestRun($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });

  await ui.press({ key: 'draft:change:0:0' });

  expect(await ui.find({ key: 'draft:change:0:0' })).toBeUndefined();
  expect(await texts(ui)).toContain('Added to your prompt');
  expect(await ui.find({ key: 'draft:change:1:0' })).toBeDefined();
  await ui.unmount();
});

test('a newer review of the run starts with nothing added or opened', async ($, on) => {
  const review = { mtimeMs: 5000 };
  world(on, { review });
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }));
  on('prompt.fill', (_, e) => ({
    isFilled: true,
    text: e.text,
    cursor: e.text.length,
  }));
  await showLatestRun($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  await ui.press({ key: 'draft:change:0:0' });
  await ui.press({ key: 'page:change:0:0' });

  review.mtimeMs = 9000;
  await showLatestRun($);

  expect((await ui.find({ key: 'draft:change:0:0' }))?.props.label).toBe(
    'Not intended',
  );
  expect((await ui.find({ key: 'page:change:0:0' }))?.props.label).toBe(
    'View full page',
  );
  await ui.unmount();
});

test('a full-page change drafts its page areas and the After strip that holds them', async ($, on) => {
  world(on);
  const fills: string[] = [];
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }));
  on('prompt.fill', (_, e) => {
    fills.push(e.text);
    return { isFilled: true, text: e.text, cursor: e.text.length };
  });
  await showLatestRun($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });

  await ui.press({ key: 'draft:change:2:0' });

  expect(fills[0]).toContain(
    'Changed areas (page coordinates): x=0 y=700 1280×400\n',
  );
  expect(fills[0]).toContain('Page size: 1280×720 → 1280×1100\n');
  expect(fills[0]).toContain(
    'After image: .ui-compare/abc123/review/pricing-after-1.png\n',
  );
  await ui.unmount();
});

test('the pane speaks Japanese when the language setting is Japanese', async ($, on) => {
  world(on, { language: 'japanese' });
  await showLatestRun($);

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });

  expect(await texts(ui)).toEqual(
    expect.arrayContaining([
      '3 画面が変わりました',
      '撮影できなかった画面 1、変更前の時点で不安定だった箇所だけが変わった画面 1、変わらなかった画面 1、スキップした画面 1',
      '撮影できなかった画面',
      '変更前',
      '変更後',
      '変化した箇所 1/2',
      'そのほかの結果',
      'ノイズの可能性',
    ]),
  );
  expect((await ui.find({ key: 'page:change:0:0' }))?.props.label).toBe(
    'ページ全体を見る',
  );
  expect((await ui.find({ key: 'draft:change:0:0' }))?.props.label).toBe(
    '意図していない',
  );
  await ui.unmount();
});

test('the terminal, VS Code and mobile get a text summary without pictures', async ($, on) => {
  world(on);
  await showLatestRun($);

  for (const surface of ['terminal', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface });

    expect(await ui.findAll({ type: 'Svg' })).toEqual([]);
    expect(await texts(ui)).toEqual(
      expect.arrayContaining([
        '3 screens changed',
        '  http://localhost:5173/broken · 1280×720 · Failed while capturing After: net::ERR_CONNECTION_REFUSED',
        '  1280×720: x=100 y=200 120×40',
        'Components/Button (Storybook)',
        '  Primary · 1280×720 and 1280×720 dark: Area 1 of 2 x=10 y=10 30×20; Area 2 of 2 x=600 y=400 50×20',
        '  1280×720: full page; x=0 y=700 1280×400',
        'Pictures are shown in Claude Code Desktop.',
      ]),
    );
    await ui.unmount();
  }
});

test('a picture too large for one Svg is named in text instead', async ($, on) => {
  world(on, {
    base64Of: (path) =>
      path.endsWith('home-crop-after-0.png') ? 'A'.repeat(131_072) : undefined,
  });
  await showLatestRun($);

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  const sources = (await ui.findAll({ type: 'Svg' })).map(({ props }) =>
    String(props.source),
  );

  expect(await texts(ui)).toContain(
    'Too large to draw here: .ui-compare/abc123/review/home-crop-after-0.png',
  );
  expect(sources.every((source) => source.length <= 131_072)).toBe(true);
  expect(sources.some((source) => source.includes('AAAAAAAA'))).toBe(false);
  await ui.unmount();
});

test('the pane says so while no run has been shown', async ($, on) => {
  world(on);

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });

  expect(await texts(ui)).toEqual(['No ui-compare run to show yet.']);
  await ui.unmount();
});

test('a shorter Before is drawn as tall as After, so pointing at the page hides After entirely', async ($, on) => {
  world(on);
  await showLatestRun($);

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  const { before, after } = await layers(ui, 'http://localhost:5173/pricing');

  expect(before).toHaveLength(1);
  expect(after).toHaveLength(2);
  expect(frame(before)).toEqual(frame(after));
  expect(before[0]).toMatch(
    /<rect width="1280" height="1100" fill="#[0-9a-f]{6}"\/>/,
  );
  await ui.unmount();
});

test('a taller, wider Before does not spill out of the frame After sets', async ($, on) => {
  world(on, {
    text: JSON.stringify(
      withHomePage({
        before: image('home-before', 1280, [800, 700]),
        after: image('home-after', 1000, [600, 400]),
        marks: [],
      }),
    ),
  });
  await showLatestRun($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });

  await ui.press({ key: 'page:change:0:0' });
  const { before, after } = await layers(ui, 'http://localhost:5173/');

  expect(frame(after)).toEqual(frame(before));
  expect(frame(after).widths).toHaveLength(1);
  expect(after[0]).toMatch(
    /<rect width="1280" height="600" fill="#[0-9a-f]{6}"\/>/,
  );
  expect(after[1]).toMatch(
    /<rect width="1280" height="900" fill="#[0-9a-f]{6}"\/>/,
  );
  await ui.unmount();
});

test('Not intended stays when the prompt refuses the draft, and a toast says so', async ($, on) => {
  const seen = world(on);
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }));
  on('prompt.fill', () => ({ isFilled: false }));
  await showLatestRun($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });

  await ui.press({ key: 'draft:change:0:0' });

  expect(seen.toasts).toEqual(['Could not add to your prompt']);
  expect((await ui.find({ key: 'draft:change:0:0' }))?.props.label).toBe(
    'Not intended',
  );
  expect(await texts(ui)).not.toContain('Added to your prompt');
  await ui.unmount();
});

const UNREADABLE = 'The review of run abc123 could not be read.';

test('a review with a path out of its run folder is not read from', async ($, on) => {
  const seen = world(on, {
    text: JSON.stringify(REVIEW).replace(
      'review/home-crop-before-0.png',
      'review/../../../.ssh/id_rsa.png',
    ),
  });
  await showLatestRun($);

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });

  expect(await texts(ui)).toEqual([UNREADABLE]);
  expect(await ui.findAll({ type: 'Svg' })).toEqual([]);
  expect(seen.reads).toEqual([
    expect.stringMatching(/\/\.ui-compare\/abc123\/review\.json$/),
  ]);
  await ui.unmount();
});

test('a review whose diff leaves its folder is unreadable', async ($, on) => {
  world(on, {
    text: JSON.stringify(REVIEW).replace('diff/home.png', '../diff.png'),
  });
  await showLatestRun($);

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });

  expect(await texts(ui)).toEqual([UNREADABLE]);
  await ui.unmount();
});

test('a review naming another run is unreadable', async ($, on) => {
  world(on, { text: JSON.stringify({ ...REVIEW, id: 'zzz999' }) });
  await showLatestRun($);

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });

  expect(await texts(ui)).toEqual([UNREADABLE]);
  await ui.unmount();
});

test('a review with a height that is not a number is unreadable', async ($, on) => {
  world(on, {
    text: JSON.stringify(REVIEW).replace('"height":160', '"height":"160"'),
  });
  await showLatestRun($);

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });

  expect(await texts(ui)).toEqual([UNREADABLE]);
  expect(await ui.findAll({ type: 'Svg' })).toEqual([]);
  await ui.unmount();
});

test('a review from another version of ui-compare asks for an update', async ($, on) => {
  world(on, { text: JSON.stringify({ ...REVIEW, version: 2 }) });
  await showLatestRun($);

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });

  expect(await texts(ui)).toEqual([
    'The review of run abc123 could not be read: a different version of ui-compare wrote it. Update the ui-compare plugin or CLI so they match.',
  ]);
  await ui.unmount();
});
