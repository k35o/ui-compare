import { atom, read, update } from 'claude-code';
import type { FsStat, Register } from 'claude-code';

import type { UiCompareRun, UiCompareView } from '../types';
import type { ReviewFile } from './review-file';
import { newestRun, parseReview, REVIEW_FILE } from './runs';
import { languageOf, STRINGS } from './strings';
import { draftText, overview, runPath, STORE, summaryLines } from './summary';
import { desktopPane, headerOf, plainPane, shownFiles } from './view';

const PANE = 'ui-compare';
const POLL_MS = 2000;
const ALIVE_FILE = `${STORE}/pane-alive`;

const view = atom(
  { plugin: 'ui-compare', key: 'view' } as const,
  { run: null, open: [], drafted: [] },
  { shape: 'view-1' },
);
const since = atom({ plugin: 'ui-compare', key: 'since' } as const, 0);

const isReal = (stat: FsStat, kind: FsStat['kind']) =>
  stat.kind === kind && !stat.isLink;

const isSameRun = (a: UiCompareRun | null, b: UiCompareRun | null) =>
  a !== null && b !== null && a.id === b.id && a.mtimeMs === b.mtimeMs;

const showing = (run: UiCompareRun) => (current: UiCompareView) =>
  isSameRun(current.run, run) ? current : { run, open: [], drafted: [] };

let loaded:
  | { key: string; review: ReviewFile; strips: Map<string, string> }
  | undefined;

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    const now = await $.clock.now();
    await update($, since, (value) => (value === 0 ? now : value));

    const beat = async (time: number) => {
      const alive = await $.fs.stat(ALIVE_FILE).catch(() => null);
      if (alive === null || isReal(alive, 'file'))
        await $.fs.write(ALIVE_FILE, `${time}\n`);
    };

    let isPolling = false;
    const poll = async () => {
      const store = await $.fs.stat(STORE).catch(() => null);
      if (store === null) return;
      const [surfaces, time] = await Promise.all([
        $.session.surfaces(),
        $.clock.now(),
      ]);
      if (surfaces.includes('desktop') && isReal(store, 'dir'))
        await beat(time);

      const newest = await newestRun({
        list: (path) => $.fs.list(path),
        stat: (path) => $.fs.stat(path),
      });
      if (newest === undefined) return;
      const [start, current] = await Promise.all([
        read($, since),
        read($, view),
      ]);
      // /clear ends the session without a new session.start, and the next
      // session's state starts empty, so runs from before it must not open.
      if (start === 0) {
        await update($, since, (value) => (value === 0 ? time : value));
        return;
      }
      if (
        newest.mtimeMs <= start ||
        newest.mtimeMs <= (current.run?.mtimeMs ?? 0)
      )
        return;

      await update($, view, showing(newest));
      const opened = await $.ui.open({ id: PANE, title: PANE });
      if (
        opened.isPlaced &&
        (await $.ui.panes()).some(({ id, isShown }) => id === PANE && isShown)
      )
        return;
      const t = STRINGS[languageOf(await $.settings.read({ key: 'language' }))];
      const parsed = parseReview(
        await $.fs.read(runPath(newest.id, REVIEW_FILE)),
        newest.id,
      );
      $.ui.toast(
        t.toast(
          'review' in parsed
            ? overview(parsed.review, t).headline
            : t.reviewProblem[parsed.problem](newest.id).replace(/[.。]$/u, ''),
        ),
      );
    };
    $.clock.every(POLL_MS, () => {
      if (isPolling) return;
      isPolling = true;
      poll()
        .catch((error: unknown) => {
          $.ui.log(`ui-compare: polling failed: ${String(error)}`, {
            to: 'debug',
          });
        })
        .finally(() => {
          isPolling = false;
        });
    });

    await $.command
      .register({
        name: 'ui-compare-pane',
        description: 'Show the latest ui-compare run in a pane',
      })
      .catch((error: unknown) => {
        $.ui.log(
          `ui-compare: /ui-compare-pane is unavailable: ${String(error)}`,
        );
      });
    return next(e);
  });

  on('command.run', { command: 'ui-compare-pane' }, async ($) => {
    const t = STRINGS[languageOf(await $.settings.read({ key: 'language' }))];
    const newest = await newestRun({
      list: (path) => $.fs.list(path),
      stat: (path) => $.fs.stat(path),
    });
    if (newest === undefined) return { text: t.commandNoRun };
    await update($, view, showing(newest));
    await $.ui.open({ id: PANE, title: PANE });
    return { text: t.commandShown(newest.id) };
  });

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = STRINGS[languageOf(await $.settings.read({ key: 'language' }))];
    const { run, open, drafted } = await read($, view);
    const { Box, Text } = $.ui.resolve(e);
    if (run === null) return <Text dimColor>{t.noRun}</Text>;

    const key = `${run.id}@${run.mtimeMs}`;
    if (loaded?.key !== key) {
      const text = await $.fs
        .read(runPath(run.id, REVIEW_FILE))
        .catch(() => '');
      const parsed = parseReview(text, run.id);
      if ('problem' in parsed)
        return <Text dimColor>{t.reviewProblem[parsed.problem](run.id)}</Text>;
      loaded = { key, review: parsed.review, strips: new Map() };
    }
    const { review, strips } = loaded;

    if (e.surface !== 'desktop') {
      return plainPane({ Box, Text }, [
        ...summaryLines(review, t),
        '',
        t.picturesOnDesktop,
      ]);
    }
    const elements = $.ui.resolve(e);
    if (e.props.placement === 'widget') return headerOf(elements, review, t);

    const openKeys = new Set(open);
    const missing = shownFiles(review, openKeys).filter(
      (file) => !strips.has(file),
    );
    await Promise.all(
      missing.map(async (file) => {
        const bytes = await $.fs
          .read(runPath(run.id, file), { as: 'bytes' })
          .catch(() => undefined);
        if (bytes !== undefined) strips.set(file, bytes.base64);
      }),
    );

    return desktopPane(elements, {
      review,
      t,
      open: openKeys,
      drafted: new Set(drafted),
      base64Of: (file) => strips.get(file),
      toggle: (pageKey) =>
        update($, view, (current) =>
          isSameRun(current.run, run)
            ? {
                ...current,
                open: current.open.includes(pageKey)
                  ? current.open.filter((one) => one !== pageKey)
                  : [...current.open, pageKey],
              }
            : current,
        ),
      draft: async (screen, change, changeKey) => {
        const box = await $.prompt.read();
        const separator =
          box.text === '' ? '' : box.text.endsWith('\n') ? '\n' : '\n\n';
        const filled = await $.prompt.fill({
          text: `${separator}${draftText(review.id, screen, change, t)}\n`,
          mode: 'append',
        });
        if (!filled.isFilled && filled.refusal !== 'unanswered') {
          $.ui.toast(t.notAdded);
          return;
        }
        await update($, view, (current) =>
          isSameRun(current.run, run) && !current.drafted.includes(changeKey)
            ? { ...current, drafted: [...current.drafted, changeKey] }
            : current,
        );
      },
    });
  });
};
