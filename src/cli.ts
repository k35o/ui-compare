#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cac } from 'cac';

import { runAfter, runBefore, shotsWithBefore } from './commands.ts';
import { UsageError } from './errors.ts';
import { screenOf } from './review.ts';
import type { Change, Review, Screen, Variant } from './review.ts';
import { REPORT_FILE, SUMMARY_FILE } from './store.ts';
import type {
  Box,
  RunFile,
  Shot,
  ShotResult,
  Summary,
  Unstable,
} from './types.ts';

type Options = Record<string, unknown>;

type Entry = { screen: Screen; variants: Variant[] };

type Row = Entry & { status: string; detail: string | undefined };

type Part = { stories: string[]; settings: string[]; warnings: string[] };

const BEFORE_STATUS_WIDTH = 'unstable'.length + 2;
const AFTER_STATUS_WIDTH = 'unchanged'.length + 2;
const LISTED_AREAS = 3;

const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

async function beforeCommand(
  targets: string[],
  options: Options,
): Promise<number> {
  const cwd = process.cwd();
  const storybook = single(options.storybook, 'storybook');
  const run = await runBefore({
    targets,
    ...(storybook === undefined ? {} : { storybook }),
    stories: list(options.story, 'story'),
    viewports: list(options.viewport, 'viewport'),
    colorSchemes: list(options.colorScheme, 'color-scheme'),
    masks: list(options.mask, 'mask'),
    cwd,
  });
  print(formatBefore(run, cwd));
  return run.before.some((shot) => shot.status === 'error') ? 1 : 0;
}

async function afterCommand(id: string): Promise<number> {
  const cwd = process.cwd();
  const { dir, summary, review, report } = await runAfter({ id, cwd });
  print(formatAfter(summary, review, report, relative(cwd, dir), cwd));
  return summary.counts.error > 0 ? 1 : 0;
}

function formatBefore(run: RunFile, cwd: string): string[] {
  const rows: Row[] = [];
  const groups = new Map<string, Row>();
  const screens = new Set<string>();
  for (const { shot, before } of shotsWithBefore(run)) {
    const screen = screenOf(shot.target);
    screens.add(screen.key);
    if (before.status === 'captured' && before.unstable) {
      rows.push({
        status: 'unstable',
        screen,
        variants: [variantOf(shot, before.warnings)],
        detail: `${describeUnstable(before.unstable)}; mask it with --mask and run before again`,
      });
    } else {
      const row: Row =
        before.status === 'captured'
          ? { status: 'ok', screen, variants: [], detail: undefined }
          : {
              status: before.status,
              screen,
              variants: [],
              detail:
                before.status === 'skipped' ? before.reason : before.message,
            };
      const key = JSON.stringify([screen.key, row.status, row.detail ?? null]);
      let group = groups.get(key);
      if (group === undefined) {
        group = row;
        groups.set(key, group);
        rows.push(group);
      }
      group.variants.push(
        variantOf(shot, before.status === 'captured' ? before.warnings : []),
      );
    }
  }
  return [
    `Captured Before for run ${run.id}: ${plural(screens.size, 'screen')}, ${plural(run.shots.length, 'shot')}`,
    ...rows.flatMap((row) => entryLines(BEFORE_STATUS_WIDTH, row, cwd)),
    `Next: make the change, then run: ui-compare after ${run.id}`,
  ];
}

function formatAfter(
  summary: Summary,
  review: Review,
  report: 'file' | 'pane',
  dir: string,
  cwd: string,
): string[] {
  const results = new Map(
    summary.shots.map((result) => [result.shot.key, result]),
  );
  const row = (status: string, entry: Entry, detail?: string) =>
    entryLines(AFTER_STATUS_WIDTH, { status, ...entry, detail }, cwd);
  return [
    `Compared run ${review.id}: ${plural(review.changed.length, 'screen')} changed, ${plural(summary.counts.error, 'error')}`,
    ...review.errors.flatMap(({ screen, variants, phase, message }) =>
      row('error', { screen, variants }, `${phase}: ${message}`),
    ),
    ...review.changed.flatMap(({ screen, changes }) => [
      `  ${'changed'.padEnd(AFTER_STATUS_WIDTH)}${screenName(screen, cwd)}${screen.kind === 'component' ? ' (Storybook)' : ''}`,
      ...changes.flatMap((change) => changeLines(change, results, dir)),
    ]),
    ...review.noise.flatMap((entry) =>
      row('noise', entry, 'changed only where it was unstable in Before'),
    ),
    ...review.unchanged.flatMap((entry) => row('unchanged', entry)),
    ...review.skipped.flatMap((entry) => row('skipped', entry, entry.reason)),
    report === 'pane'
      ? 'Report:  shown in the ui-compare pane in Claude Code'
      : `Report:  ${join(dir, REPORT_FILE)}`,
    `Summary: ${join(dir, SUMMARY_FILE)}`,
  ];
}

function entryLines(
  width: number,
  { status, screen, variants, detail }: Row,
  cwd: string,
): string[] {
  const lines: string[] = [];
  for (const { stories, settings, warnings } of partition(variants)) {
    const columns = [
      `  ${status.padEnd(width)}${screenName(screen, cwd)}${stories.length > 0 ? `: ${stories.join(', ')}` : ''}`,
      settings.join(', '),
    ];
    if (detail !== undefined) columns.push(detail);
    lines.push(columns.join('  '), ...warningLines(warnings, 4));
  }
  return lines;
}

function changeLines(
  { variants, crops, fullPage, dimensions }: Change,
  results: Map<string, ShotResult>,
  dir: string,
): string[] {
  const [first] = variants;
  const result = results.get(first?.shotKey ?? '');
  if (
    first === undefined ||
    result?.diff === undefined ||
    result.files.diff === undefined
  ) {
    throw new Error(`Changed shot ${first?.shotKey ?? ''} has no diff`);
  }
  const where = fullPage
    ? 'changed across the page'
    : describeAreas(crops.map(({ area }) => area));
  const pageSize =
    dimensions === undefined
      ? ''
      : `, page size ${dimensions.before.join('x')} -> ${dimensions.after.join('x')}`;
  const whose = variants.length > 1 ? ` (in ${conditions([first])})` : '';
  return [
    `    ${conditions(variants)}: ${where}${pageSize}${whose}  ${join(dir, result.files.diff)}`,
    ...warningLines(unique(variants.flatMap(({ warnings }) => warnings)), 6),
  ];
}

function conditions(variants: Variant[]): string {
  return partition(variants)
    .map(({ stories, settings }) =>
      [stories.join(', '), settings.join(', ')].filter(Boolean).join(' · '),
    )
    .join('; ');
}

// Stories that were captured at the same settings share one description, so
// a group never claims a setting that one of its stories was not seen at.
function partition(variants: Variant[]): Part[] {
  const byStory = new Map<string | undefined, Variant[]>();
  for (const variant of variants) {
    const ofStory = byStory.get(variant.story) ?? [];
    ofStory.push(variant);
    byStory.set(variant.story, ofStory);
  }
  const parts = new Map<string, Part>();
  for (const [story, ofStory] of byStory) {
    const settings = unique(ofStory.map(setting));
    const key = settings.join(', ');
    const part = parts.get(key) ?? { stories: [], settings, warnings: [] };
    parts.set(key, part);
    if (story !== undefined) part.stories.push(story);
    part.warnings = unique([
      ...part.warnings,
      ...ofStory.flatMap(({ warnings }) => warnings),
    ]);
  }
  return [...parts.values()];
}

function variantOf(
  { key, target, viewport, colorScheme }: Shot,
  warnings: string[],
): Variant {
  return target.kind === 'story'
    ? { shotKey: key, viewport, colorScheme, story: target.name, warnings }
    : { shotKey: key, viewport, colorScheme, warnings };
}

function screenName({ kind, label }: Screen, cwd: string): string {
  return kind === 'url' && label.startsWith('file:')
    ? relative(cwd, fileURLToPath(label))
    : label;
}

function setting({ viewport, colorScheme }: Variant): string {
  return `${viewport.width}x${viewport.height}${colorScheme === 'dark' ? ' dark' : ''}`;
}

function describeUnstable({ mismatchRatio, bbox }: Unstable): string {
  return `differs between two loads${bbox ? ` at ${describeBox(bbox)}` : ''} (${percent(mismatchRatio)})`;
}

function describeAreas(regions: Box[]): string {
  const listed = regions.slice(0, LISTED_AREAS).map(describeBox);
  const more = regions.length - listed.length;
  return `${plural(regions.length, 'area')} at ${[...listed, ...(more > 0 ? [`+${more} more`] : [])].join(', ')}`;
}

function describeBox({ x, y, width, height }: Box): string {
  return `x=${x} y=${y} ${width}x${height}`;
}

function percent(ratio: number): string {
  // A ratio that rounds to 0.00% still means some pixels changed.
  return ratio > 0 && ratio < 0.0001
    ? '<0.01%'
    : `${(ratio * 100).toFixed(2)}%`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function warningLines(warnings: string[], indent: number): string[] {
  return warnings.map((warning) => `${' '.repeat(indent)}warning: ${warning}`);
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

function print(lines: string[]): void {
  process.stdout.write(`${lines.join('\n')}\n`);
}

// cac hands over a string for one occurrence of an option, an array for
// several, and a number for a value that looks numeric.
function list(value: unknown, flag: string): string[] {
  if (value === undefined) return [];
  return [value].flat().map((item) => {
    if (typeof item === 'string') return item;
    if (typeof item === 'number') return String(item);
    throw new UsageError(`--${flag} needs a value`);
  });
}

function single(value: unknown, flag: string): string | undefined {
  const values = list(value, flag);
  if (values.length > 1) throw new UsageError(`Pass --${flag} only once`);
  return values[0];
}

async function main(argv: string[]): Promise<number> {
  const cli = cac('ui-compare');
  cli
    .command(
      'before [...targets]',
      'Capture the Before shots of URLs, HTML files and Storybook stories, and print the run id',
    )
    .option(
      '--storybook <url>',
      'Running Storybook to capture stories from, such as http://localhost:6006',
    )
    .option(
      '--story <pattern>',
      'Story id or glob over story files (repeatable; default: every story)',
    )
    .option('--viewport <WxH>', 'Viewport size (repeatable; default: 1280x720)')
    .option(
      '--color-scheme <scheme>',
      'light or dark (repeatable; default: light)',
    )
    .option(
      '--mask <selector>',
      'CSS selector to paint over in every shot (repeatable)',
    )
    .example(
      '  ui-compare before http://localhost:5173/ http://localhost:5173/settings',
    )
    .example(
      '  ui-compare before --storybook http://localhost:6006 --story "src/components/**"',
    )
    .action(beforeCommand);
  cli
    .command(
      'after <id>',
      'Capture the After shots of a run, compare them with Before, and write the report',
    )
    .action(afterCommand);
  cli.help();
  cli.version(version);

  cli.parse(argv, { run: false });
  if (cli.options.help === true) return 0;
  if (cli.options.version === true) {
    // cac prints the version only when no command is given and would
    // otherwise run the command.
    if (cli.matchedCommand) cli.outputVersion();
    return 0;
  }
  if (!cli.matchedCommand) {
    const [command] = cli.args;
    throw new UsageError(
      command === undefined
        ? 'Missing command: before or after. Run ui-compare --help'
        : `Unknown command ${command}: use before or after. Run ui-compare --help`,
    );
  }
  return (await cli.runMatchedCommand()) as number;
}

try {
  process.exitCode = await main(process.argv);
} catch (error) {
  // cac does not export its error class, so its argument errors (unknown
  // option, missing argument) are recognised by name.
  if (
    error instanceof UsageError ||
    (error instanceof Error && error.name === 'CACError')
  ) {
    process.stderr.write(`ui-compare: ${error.message}\n`);
    process.exitCode = 2;
  } else {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
