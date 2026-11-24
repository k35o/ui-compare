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
const notice = atom({ plugin: 'ui-compare', key: 'notice' } as const, null, {
  shape: 'notice-1',
});
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

async function reviewOf(
  run: UiCompareRun,
  readText: (path: string) => Promise<string>,
): Promise<
  | { review: ReviewFile; strips: Map<string, string> }
  | { problem: 'unreadable' | 'version' }
> {
  const key = `${run.id}@${run.mtimeMs}`;
  if (loaded?.key === key) return loaded;
  const text = await readText(runPath(run.id, REVIEW_FILE)).catch(() => '');
  const parsed = parseReview(text, run.id);
  if ('problem' in parsed) return parsed;
  loaded = { key, review: parsed.review, strips: new Map() };
  return loaded;
}

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

      // A new result only raises the line above the prompt. An open the person
      // did not ask for never settles while the desktop cannot draw the pane
      // (its sidebar closed), and every later call of the plugin waits behind
      // it, the heartbeat included.
      await update($, view, showing(newest));
      await update($, notice, () => newest);
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
        description: 'Show the latest ui-compare result in a pane',
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
    if (newest === undefined) return { text: t.noRun };
    await update($, view, showing(newest));
    await update($, notice, () => null);
    void $.ui.open({ id: PANE, title: PANE }).catch(() => undefined);
    return { text: t.commandShown };
  });

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const shown = await read($, notice);
    if (shown === null || e.props.hasSurvey) return next(e);
    const t = STRINGS[languageOf(await $.settings.read({ key: 'language' }))];
    const result = await reviewOf(shown, (path) => $.fs.read(path));
    const { Box, Button, Text } = $.ui.resolve(e);
    return (
      <Box gap={1}>
        <Text>
          {'review' in result
            ? overview(result.review, t).headline
            : t.resultProblem[result.problem]}
        </Text>
        <Button
          key="open"
          label={t.openPane}
          variant="primary"
          onPress={async () => {
            await update($, view, showing(shown));
            await update($, notice, () => null);
            void $.ui.open({ id: PANE, title: PANE }).catch(() => undefined);
          }}
        />
        <Button
          key="dismiss"
          label={t.dismiss}
          role="dismiss"
          onPress={() => update($, notice, () => null)}
        />
      </Box>
    );
  });

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = STRINGS[languageOf(await $.settings.read({ key: 'language' }))];
    const { run, open, drafted } = await read($, view);
    const { Box, Text } = $.ui.resolve(e);
    if (run === null) return <Text dimColor>{t.noRun}</Text>;

    const result = await reviewOf(run, (path) => $.fs.read(path));
    if ('problem' in result)
      return <Text dimColor>{t.resultProblem[result.problem]}</Text>;
    const { review, strips } = result;

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
