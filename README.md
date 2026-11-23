# ui-compare

Capture pages and Storybook stories before and after a UI change, and compare them in one HTML report.

`ui-compare` is built for changes made by coding agents: the agent captures Before, edits the code, captures After, and hands you a report that shows every shot side by side with its pixel diff. It runs on your machine against the dev server or Storybook you already have running. Nothing is committed, and there is no baseline to maintain.

## Install

```sh
pnpm add -D ui-compare
pnpm exec playwright install chromium
```

Or run it without installing: `npx ui-compare ...`.

## Usage

```sh
# 1. Before editing: capture the targets and note the run id
ui-compare before http://localhost:5173/ http://localhost:5173/settings
# Captured Before for run 3k9x2a (2 shots)

# 2. Change the code

# 3. Capture again and compare (repeat after every round of edits)
ui-compare after 3k9x2a
# Compared run 3k9x2a: 1 changed, 1 unchanged, 0 errors, 0 skipped
#   changed    http://localhost:5173/  1280x720 light  0.28% at x=555 y=243 170x42  .ui-compare/3k9x2a/diff/...
# Report:  .ui-compare/3k9x2a/report.html
# Summary: .ui-compare/3k9x2a/summary.json
```

`after` always compares with the Before of its run, so the report covers the whole change, however many times you run it.

### Targets

| Target           | Example                                                   |
| ---------------- | --------------------------------------------------------- |
| URL              | `http://localhost:5173/settings`                          |
| Static HTML file | `./dist/index.html`, `file:///path/to/page.html`          |
| Storybook story  | `--storybook http://localhost:6006 --story "src/Button*"` |

Stories need Storybook 8.5 or later, which reports when a story has finished rendering, including its `play` function. `--story` takes a story id (`button--primary`), a story file path, or a glob over story file paths, and can be repeated. Without `--story`, every story in the Storybook is captured. Stories honour `parameters.vrt.skip`, `delay`, `mask` and `remove`, the same keys [storybook-addon-vrt](https://github.com/k35o/storybook-addon-vrt) reads.

### Options of `before`

| Option                    | Default    | Meaning                                                |
| ------------------------- | ---------- | ------------------------------------------------------ |
| `--viewport <WxH>`        | `1280x720` | Viewport size; repeatable                              |
| `--color-scheme <scheme>` | `light`    | `light` or `dark`; repeatable                          |
| `--mask <selector>`       |            | Paint over matching elements in every shot; repeatable |
| `--storybook <url>`       |            | Base URL of a running Storybook                        |
| `--story <pattern>`       | all        | Story id or glob over story files; repeatable          |

Every target is captured at every viewport × color scheme.

### Unstable pages

`before` loads every shot twice. When the two loads differ (a clock, random data, a carousel), the shot is reported as `unstable` together with the area that moved. Mask that area with `--mask` and run `before` again; differences inside an unstable area are marked as possible noise in the report.

### Exit codes

| Code | Meaning                                                              |
| ---- | -------------------------------------------------------------------- |
| `0`  | Every shot was captured, changed, unchanged or skipped               |
| `1`  | At least one shot could not be captured, or the tool crashed         |
| `2`  | Usage error: bad option, unknown run id, unreachable Storybook index |

Differences never fail the command.

## Output

Each run lives in `.ui-compare/<id>/` under the current directory. The folder carries its own `.gitignore`, so it is never committed by accident.

```
.ui-compare/<id>/
├── run.json       targets and Before results
├── before/        Before shots
├── unstable/      differences between the two Before loads
├── after/         After shots (replaced by every `after`)
├── diff/          pixel diffs of changed shots
├── summary.json   per-shot status, changed area and image paths
└── report.html    the report, with every image embedded
```

`summary.json` lists every shot with its `status` (`changed`, `unchanged`, `error`, `skipped`), the mismatch ratio and the bounding box of the changed pixels, so an agent can spot changes outside the area it meant to edit without reading the images.

## How shots are taken

- Every shot gets a fresh Chromium context with the requested viewport and color scheme, reduced motion, and CSS animations and the caret disabled.
- After `load`, the page gets up to 5 seconds to go network-idle, so data fetched on load is in the shot. Storybook stories are captured after Storybook reports `storyFinished`, that is after their `play` function.
- The full page is captured, then captured again until two consecutive frames are identical.
- A shot is an error, not a capture, when the page answers with an HTTP error, redirects (pages behind a login are not supported), fails to load one of its own scripts (the message of Vite's error overlay is reported when there is one), shows Storybook's error display, or stops responding.
- Vite shows its error overlay on every open page, including pages that do not use the broken module. Such a page is still captured, with a warning, and the overlay is hidden in its shot.

`ui-compare` never starts servers. Start your dev server or `storybook dev` first.

## Develop

```sh
pnpm install
pnpm exec playwright install chromium
pnpm check            # fmt + lint
pnpm typecheck
pnpm test
pnpm build            # vp pack -> dist/
```

## Release

Versioned and published with [pnpm's built-in release management](https://pnpm.io/versioning),
driven in CI by [k35o/pnpm-release-action](https://github.com/k35o/pnpm-release-action).

```sh
pnpm change   # describe the change (writes .changeset/<name>.md)
```

Merging to `main` lets the release workflow open a release PR and publish to npm.
