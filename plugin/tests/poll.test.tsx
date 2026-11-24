import type { On, RenderSurface } from 'claude-code';
import { expect, mock, test } from 'claude-code/testing';
import type { Engine } from 'claude-code/testing';

import type { ReviewFile } from '../hooks/review-file';
import { PANE, PIXEL, REVIEW, RUN } from './fixture';

type Entry = { kind: 'file' | 'dir' | 'other'; isLink: boolean };

type World = {
  store?: Entry | null;
  alive?: Entry | null;
  surfaces?: RenderSurface[];
  runs?: Array<{ id: string; mtimeMs: number }>;
  isPlaced?: boolean;
  isShown?: boolean;
  language?: string;
  registerRefusal?: string;
  reviewVersion?: number;
  reviews?: Record<string, Partial<ReviewFile>>;
  isStateLost?: boolean;
  isOpenHanging?: boolean;
};

type Seen = {
  commands: string[];
  opens: string[];
  toasts: string[];
  writes: string[];
  logs: string[];
};

const DIR: Entry = { kind: 'dir', isLink: false };
const FILE: Entry = { kind: 'file', isLink: false };

function world(on: On, state: World): Seen {
  const seen: Seen = {
    commands: [],
    opens: [],
    toasts: [],
    writes: [],
    logs: [],
  };
  const stat = (entry: Entry | null, mtimeMs = 0) =>
    entry === null
      ? { deny: 'ENOENT' }
      : { value: { ...entry, size: 1, mtimeMs } };
  on('session.start', (_, e) => ({ cwd: e.cwd }));
  on('command.register', (_, e) => {
    if (state.registerRefusal !== undefined)
      return { deny: state.registerRefusal };
    seen.commands.push(e.name);
    return { value: { command: e.name } };
  });
  on('settings.read', () => ({
    value: state.language === undefined ? {} : { language: state.language },
  }));
  on('session.surfaces', () => ({ value: state.surfaces ?? ['desktop'] }));
  on('fs.write', (_, e) => {
    seen.writes.push(e.path);
    return { value: undefined };
  });
  on('fs.list', () => ({
    value: (state.runs ?? []).map(({ id }) => ({
      name: id,
      kind: 'dir' as const,
      size: 0,
      mtimeMs: 0,
      isLink: false,
    })),
  }));
  on('fs.stat', (_, e) => {
    if (e.path.endsWith('/.ui-compare'))
      return stat(state.store === undefined ? DIR : state.store);
    if (e.path.endsWith('/.ui-compare/pane-alive'))
      return stat(state.alive ?? null);
    const run = (state.runs ?? []).find(({ id }) =>
      e.path.endsWith(`/.ui-compare/${id}/review.json`),
    );
    return run === undefined ? stat(null) : stat(FILE, run.mtimeMs);
  });
  on('fs.read', (_, e) => {
    if (e.as === 'bytes') return { value: { base64: PIXEL } };
    const id = e.path.split('/').at(-2) ?? '';
    return {
      value: JSON.stringify({
        ...REVIEW,
        ...state.reviews?.[id],
        id,
        version: state.reviewVersion ?? REVIEW.version,
      }),
    };
  });
  on('state.get', (_, e, next) =>
    state.isStateLost === true && e.key === 'since'
      ? { value: { value: undefined, version: 0 } }
      : next(e),
  );
  on('ui.open', (_, e) => {
    seen.opens.push(e.id);
    if (state.isOpenHanging === true) return new Promise(() => undefined);
    return {
      value:
        state.isPlaced === false
          ? { isPlaced: false, reason: 'below 144 columns' }
          : { isPlaced: true },
    };
  });
  on('ui.panes', () => ({
    value: [
      {
        id: 'ui-compare',
        title: 'ui-compare',
        isShown: state.isPlaced !== false && state.isShown !== false,
        isFocused: false,
        isPlaced: state.isPlaced !== false,
      },
    ],
  }));
  on('ui.toast', (_, e) => {
    seen.toasts.push(e.text);
    return { value: undefined };
  });
  on('ui.log', (_, e) => {
    seen.logs.push(e.text);
    return { value: undefined };
  });
  return seen;
}

async function start($: Engine): Promise<void> {
  await $.session.start({
    cwd: '/repo',
    surface: 'desktop',
    isInteractive: true,
  });
}

async function runCommand($: Engine) {
  return $.command.run({
    command: 'ui-compare-pane',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 100 },
  });
}

const ALIVE = expect.stringMatching(/\/\.ui-compare\/pane-alive$/);

test('the session registers /ui-compare-pane', async ($, on) => {
  mock.clock(on, { now: 1_000 });
  const seen = world(on, {});
  await start($);

  expect(seen.commands).toEqual(['ui-compare-pane']);
});

test('a review written during the session is shown without opening the pane by itself', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 });
  const state: World = { runs: [] };
  const seen = world(on, state);
  await start($);
  await clock.advance(2_000);

  state.runs = [{ id: RUN, mtimeMs: 2_500 }];
  await clock.advance(2_000);

  expect(seen.opens).toEqual([]);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  expect(
    (await ui.findAll({ type: 'Text' })).some(({ text }) =>
      text.startsWith('Home, Button and Pricing page'),
    ),
  ).toBe(true);
  await ui.unmount();
});

test('polling goes on after a new review, writing pane-alive and opening nothing', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 });
  const seen = world(on, { runs: [{ id: RUN, mtimeMs: 2_500 }] });
  await start($);

  await clock.advance(2_000);
  const writesAfterTheReview = seen.writes.length;
  await clock.advance(2_000);
  await clock.advance(2_000);

  expect(seen.writes.length).toBe(writesAfterTheReview + 2);
  expect(seen.opens).toEqual([]);
});

test('the pane follows a newer review of another run, then a newer review of the same run', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 });
  const state: World = { runs: [{ id: RUN, mtimeMs: 2_500 }] };
  const seen = world(on, state);
  await start($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  const headline = async () =>
    (await ui.findAll({ type: 'Text' }))
      .filter(({ props }) => props.size === 'title')
      .map(({ text }) => text);

  await clock.advance(2_000);
  expect(await headline()).toEqual(['Home, Button and Pricing page changed']);

  state.runs = [...(state.runs ?? []), { id: 'def456', mtimeMs: 4_500 }];
  state.reviews = { def456: { changed: REVIEW.changed.slice(1) } };
  await clock.advance(2_000);
  expect(await headline()).toEqual(['Button and Pricing page changed']);

  state.runs = [
    { id: RUN, mtimeMs: 2_500 },
    { id: 'def456', mtimeMs: 6_500 },
  ];
  state.reviews = { def456: { changed: REVIEW.changed.slice(2) } };
  await clock.advance(2_000);
  expect(await headline()).toEqual(['Pricing page changed']);
  expect(seen.opens).toEqual([]);
  await ui.unmount();
});

test('a review written before the session state was cleared is not opened unasked', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 });
  const state: World = { runs: [{ id: RUN, mtimeMs: 2_500 }] };
  const seen = world(on, state);
  await start($);

  state.isStateLost = true;
  await clock.advance(2_000);
  await clock.advance(2_000);

  expect(seen.opens).toEqual([]);
});

test('runs that were there before the session started are not opened unasked', async ($, on) => {
  const clock = mock.clock(on, { now: 10_000 });
  const seen = world(on, { runs: [{ id: RUN, mtimeMs: 5_000 }] });
  await start($);

  await clock.advance(2_000);
  await clock.advance(2_000);

  expect(seen.opens).toEqual([]);
});

test('a refused /ui-compare-pane leaves the polling and pane-alive running', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 });
  const seen = world(on, {
    runs: [{ id: RUN, mtimeMs: 2_500 }],
    registerRefusal: 'the name is taken',
  });
  await start($);

  await clock.advance(2_000);

  expect(seen.writes).toEqual([ALIVE]);
  expect(seen.opens).toEqual([]);
  expect(seen.logs).toEqual([
    expect.stringContaining('/ui-compare-pane is unavailable'),
  ]);
});

test('/ui-compare-pane opens the pane on the latest run, old or new, without naming it', async ($, on) => {
  const seen = world(on, {
    runs: [
      { id: 'old111', mtimeMs: 1_000 },
      { id: RUN, mtimeMs: 5_000 },
    ],
    reviews: { old111: { changed: [] } },
  });

  const answer = await runCommand($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  const shown = (await ui.findAll({ type: 'Text' })).map(({ text }) => text);

  expect(answer.text).toBe('Showing the latest ui-compare result in the pane.');
  expect(seen.opens).toEqual(['ui-compare']);
  expect(shown).toContain('Home, Button and Pricing page changed');
  await ui.unmount();
});

test('/ui-compare-pane answers in Japanese when the language setting is Japanese', async ($, on) => {
  world(on, { runs: [{ id: RUN, mtimeMs: 5_000 }], language: 'ja' });

  const answer = await runCommand($);

  expect(answer.text).toBe('最新の ui-compare の結果をペインに表示しました。');
});

test('/ui-compare-pane without a run answers as the empty pane does and opens nothing', async ($, on) => {
  const seen = world(on, { runs: [] });

  const answer = await runCommand($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  const shown = (await ui.findAll({ type: 'Text' })).map(({ text }) => text);

  expect(answer.text).toBe('No ui-compare result to show yet.');
  expect(shown).toEqual([answer.text]);
  expect(seen.opens).toEqual([]);
  await ui.unmount();
});

test('/ui-compare-pane without a run answers in Japanese as the empty pane does', async ($, on) => {
  world(on, { runs: [], language: 'ja' });

  const answer = await runCommand($);

  expect(answer.text).toBe('表示できる ui-compare の結果はまだありません。');
});

test('folders that are not run ids are not runs', async ($, on) => {
  const seen = world(on, { runs: [{ id: '..', mtimeMs: 5_000 }] });

  const answer = await runCommand($);

  expect(answer.text).toBe('No ui-compare result to show yet.');
  expect(seen.opens).toEqual([]);
});

test('pane-alive is rewritten on every poll while a desktop surface is attached', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 });
  const seen = world(on, { surfaces: ['terminal', 'desktop'] });
  await start($);

  await clock.advance(2_000);
  await clock.advance(2_000);

  expect(seen.writes).toEqual([ALIVE, ALIVE]);
});

test('pane-alive is rewritten when it is a regular file', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 });
  const seen = world(on, { alive: FILE });
  await start($);

  await clock.advance(2_000);

  expect(seen.writes).toEqual([ALIVE]);
});

test('pane-alive is not written without a desktop surface', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 });
  const seen = world(on, { surfaces: ['terminal'] });
  await start($);

  await clock.advance(2_000);

  expect(seen.writes).toEqual([]);
});

test('pane-alive is not written where there is no .ui-compare folder', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 });
  const seen = world(on, { store: null });
  await start($);

  await clock.advance(2_000);

  expect(seen.writes).toEqual([]);
});

test('pane-alive is not written when .ui-compare is a symbolic link', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 });
  const seen = world(on, { store: { kind: 'dir', isLink: true } });
  await start($);

  await clock.advance(2_000);

  expect(seen.writes).toEqual([]);
});

test('pane-alive is not written through a symbolic link', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 });
  const seen = world(on, { alive: { kind: 'file', isLink: true } });
  await start($);

  await clock.advance(2_000);

  expect(seen.writes).toEqual([]);
});
