#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cac } from 'cac';

import { runAfter, runBefore, shotsWithBefore } from './commands.ts';
import { UsageError } from './errors.ts';
import { REPORT_FILE, runDir, SUMMARY_FILE } from './store.ts';
import type {
  Box,
  RunFile,
  Shot,
  ShotDiff,
  Summary,
  Target,
  Unstable,
} from './types.ts';

type Options = Record<string, unknown>;

const BEFORE_STATUS_WIDTH = 'unstable'.length + 2;
const AFTER_STATUS_WIDTH = 'unchanged'.length + 2;

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
  const summary = await runAfter({ id, cwd });
  print(formatAfter(summary, cwd));
  return summary.counts.error > 0 ? 1 : 0;
}

function formatBefore(run: RunFile, cwd: string): string[] {
  const lines = [
    `Captured Before for run ${run.id} (${plural(run.shots.length, 'shot')})`,
  ];
  for (const { shot, before } of shotsWithBefore(run)) {
    if (before.status === 'captured') {
      lines.push(
        before.unstable
          ? shotLine('unstable', BEFORE_STATUS_WIDTH, shot, cwd, [
              `${describeUnstable(before.unstable)}; mask it with --mask and run before again`,
            ])
          : shotLine('ok', BEFORE_STATUS_WIDTH, shot, cwd, []),
        ...warningLines(before.warnings),
      );
    } else if (before.status === 'skipped') {
      lines.push(
        shotLine('skipped', BEFORE_STATUS_WIDTH, shot, cwd, [before.reason]),
      );
    } else {
      lines.push(
        shotLine('error', BEFORE_STATUS_WIDTH, shot, cwd, [before.message]),
      );
    }
  }
  lines.push(`Next: make the change, then run: ui-compare after ${run.id}`);
  return lines;
}

function formatAfter(summary: Summary, cwd: string): string[] {
  const { id, counts } = summary;
  const dir = relative(cwd, runDir(cwd, id));
  const lines = [
    `Compared run ${id}: ${counts.changed} changed, ${counts.unchanged} unchanged, ${plural(counts.error, 'error')}, ${counts.skipped} skipped`,
  ];
  for (const result of summary.shots) {
    const details: string[] = [];
    if (result.diff) details.push(describeDiff(result.diff));
    if (result.files.diff) details.push(join(dir, result.files.diff));
    if (result.error) {
      details.push(`${result.error.phase}: ${result.error.message}`);
    }
    if (result.skipReason !== undefined) details.push(result.skipReason);
    lines.push(
      shotLine(result.status, AFTER_STATUS_WIDTH, result.shot, cwd, details),
    );
    if (result.unstable) {
      lines.push(
        `    unstable in Before: ${describeUnstable(result.unstable)}`,
      );
    }
    lines.push(...warningLines(result.warnings));
  }
  lines.push(
    `Report:  ${join(dir, REPORT_FILE)}`,
    `Summary: ${join(dir, SUMMARY_FILE)}`,
  );
  return lines;
}

function shotLine(
  status: string,
  width: number,
  shot: Shot,
  cwd: string,
  details: string[],
): string {
  const { target, viewport, colorScheme } = shot;
  return [
    `  ${status.padEnd(width)}${describeTarget(target, cwd)}`,
    `${viewport.width}x${viewport.height} ${colorScheme}`,
    ...details,
  ].join('  ');
}

function describeTarget(target: Target, cwd: string): string {
  if (target.kind === 'story') return `${target.title} / ${target.name}`;
  return target.url.startsWith('file:')
    ? relative(cwd, fileURLToPath(target.url))
    : target.url;
}

function describeUnstable({ mismatchRatio, bbox }: Unstable): string {
  return `differs between two loads${bbox ? ` at ${describeBox(bbox)}` : ''} (${percent(mismatchRatio)})`;
}

function describeDiff({ mismatchRatio, bbox, dimensions }: ShotDiff): string {
  const where = bbox ? ` at ${describeBox(bbox)}` : '';
  const size = dimensions
    ? `, size ${dimensions.before.join('x')} -> ${dimensions.after.join('x')}`
    : '';
  return `${percent(mismatchRatio)}${where}${size}`;
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

function warningLines(warnings: string[]): string[] {
  return warnings.map((warning) => `    warning: ${warning}`);
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
