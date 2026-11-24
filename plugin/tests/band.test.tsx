import type { On } from 'claude-code';
import { expect, mock, test } from 'claude-code/testing';
import type { Engine } from 'claude-code/testing';

import { PIXEL, REVIEW, RUN } from './fixture';

type World = {
  runs: Array<{ id: string; mtimeMs: number }>;
  isPlaced?: boolean;
  language?: string;
  reviewVersion?: number;
};

const BAND = {
  plugin: 'ui-compare',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
} as const;

function world(on: On, state: World): { opens: string[]; toasts: string[] } {
  const seen = { opens: [] as string[], toasts: [] as string[] };
  on('session.start', (_, e) => ({ cwd: e.cwd }));
  on('command.register', (_, e) => ({ value: { command: e.name } }));
  on('settings.read', () => ({
    value: state.language === undefined ? {} : { language: state.language },
  }));
  on('session.surfaces', () => ({ value: ['desktop'] }));
  on('fs.write', () => ({ value: undefined }));
  on('fs.list', () => ({
    value: state.runs.map(({ id }) => ({
      name: id,
      kind: 'dir' as const,
      size: 0,
      mtimeMs: 0,
      isLink: false,
    })),
  }));
  on('fs.stat', (_, e) => {
    if (e.path.endsWith('/.ui-compare'))
      return { value: { kind: 'dir', isLink: false, size: 1, mtimeMs: 0 } };
    const run = state.runs.find(({ id }) =>
      e.path.endsWith(`/.ui-compare/${id}/review.json`),
    );
    return run === undefined
      ? { deny: 'ENOENT' }
      : {
          value: { kind: 'file', isLink: false, size: 1, mtimeMs: run.mtimeMs },
        };
  });
  on('fs.read', (_, e) => {
    if (e.as === 'bytes') return { value: { base64: PIXEL } };
    const id = e.path.split('/').at(-2) ?? '';
    return {
      value: JSON.stringify({
        ...REVIEW,
        id,
        version: state.reviewVersion ?? REVIEW.version,
      }),
    };
  });
  on('ui.open', (_, e) => {
    seen.opens.push(e.id);
    return {
      value:
        state.isPlaced === false
          ? { isPlaced: false, reason: 'below 144 columns' }
          : { isPlaced: true },
    };
  });
  on('ui.toast', (_, e) => {
    seen.toasts.push(e.text);
    return { value: undefined };
  });
  return seen;
}

async function startAndFinishRun($: Engine, on: On, state: World) {
  const clock = mock.clock(on, { now: 1_000 });
  const seen = world(on, state);
  await $.session.start({
    cwd: '/repo',
    surface: 'desktop',
    isInteractive: true,
  });
  await clock.advance(2_000);
  state.runs = [{ id: RUN, mtimeMs: 3_500 }];
  await clock.advance(2_000);
  return seen;
}

test('a new result puts a line above the prompt, even where the pane could not be placed', async ($, on) => {
  const seen = await startAndFinishRun($, on, { runs: [], isPlaced: false });
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' });

  expect((await band.find({ type: 'Text', text: /changed/ }))?.text).toBe(
    'Home, Button and Pricing page changed',
  );
  expect((await band.find({ key: 'open' }))?.text).toBe('Open');
  expect((await band.find({ key: 'dismiss' }))?.text).toBe('Dismiss');
  expect(seen.toasts).toEqual([]);
  await band.unmount();
});

test('Open in the line opens the pane and takes the line away', async ($, on) => {
  const seen = await startAndFinishRun($, on, { runs: [], isPlaced: false });
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' });

  await band.press({ key: 'open' });

  expect(seen.opens).toEqual(['ui-compare']);
  expect(await band.find({ key: 'open' })).toBeUndefined();
  await band.unmount();
});

test('Dismiss takes the line away without opening the pane', async ($, on) => {
  const seen = await startAndFinishRun($, on, { runs: [] });
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' });

  await band.press({ key: 'dismiss' });

  expect(seen.opens).toEqual([]);
  expect(await band.find({ key: 'open' })).toBeUndefined();
  await band.unmount();
});

test('/ui-compare-pane takes the line away', async ($, on) => {
  await startAndFinishRun($, on, { runs: [] });
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' });

  await $.command.run({
    command: 'ui-compare-pane',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 100 },
  });

  expect(await band.find({ key: 'open' })).toBeUndefined();
  await band.unmount();
});

test('the line is in Japanese when the language setting is Japanese', async ($, on) => {
  await startAndFinishRun($, on, { runs: [], language: 'japanese' });
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' });

  expect((await band.find({ type: 'Text', text: /変わりました/ }))?.text).toBe(
    '「Home」「Button」「Pricing page」の見た目が変わりました',
  );
  expect((await band.find({ key: 'open' }))?.text).toBe('開く');
  expect((await band.find({ key: 'dismiss' }))?.text).toBe('閉じる');
  await band.unmount();
});

test('the line says when a result could not be read', async ($, on) => {
  await startAndFinishRun($, on, { runs: [], reviewVersion: 2 });
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' });

  expect(
    (await band.find({ type: 'Text', text: /Could not read/ }))?.text,
  ).toContain('a different version of ui-compare wrote it');
  await band.unmount();
});

test('runs from before the session put no line above the prompt', async ($, on) => {
  const clock = mock.clock(on, { now: 10_000 });
  world(on, { runs: [{ id: RUN, mtimeMs: 5_000 }] });
  await $.session.start({
    cwd: '/repo',
    surface: 'desktop',
    isInteractive: true,
  });
  await clock.advance(2_000);
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' });

  expect(await band.find({ key: 'open' })).toBeUndefined();
  await band.unmount();
});
