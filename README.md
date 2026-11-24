# ui-compare

Capture pages and Storybook stories before and after a UI change, and compare them in one HTML report.

`ui-compare` is built for changes made by coding agents: the agent captures Before, edits the code, captures After, and hands you a one-page report that shows, screen by screen, each changed area in Before and After side by side. It runs on your machine against the dev server or Storybook you already have running. Nothing is committed, and there is no baseline to maintain.

## Install

```sh
pnpm add -D ui-compare
pnpm exec playwright install chromium
```

Or run it without installing: `npx ui-compare ...`.

To let a coding agent drive it, install the bundled [agent skill](skills/ui-compare/SKILL.md):

```sh
gh skill install k35o/ui-compare
```

## Usage

```sh
# 1. Before editing: capture the targets and note the run id
ui-compare before http://localhost:5173/ http://localhost:5173/settings --viewport 1280x720 --viewport 375x812
# Captured Before for run 3k9x2a: 2 screens, 4 shots
#   ok        http://localhost:5173/  1280x720, 375x812
#   ok        http://localhost:5173/settings  1280x720, 375x812
# Next: make the change, then run: ui-compare after 3k9x2a

# 2. Change the code

# 3. Capture again and compare (repeat after every round of edits)
ui-compare after 3k9x2a
# Compared run 3k9x2a: 1 screen changed, 0 errors
#   changed    http://localhost:5173/
#     1280x720, 375x812: 1 area at x=555 y=243 170x42 (in 1280x720)  .ui-compare/3k9x2a/diff/001-localhost-5173-1280x720-light.png
#   unchanged  http://localhost:5173/settings  1280x720, 375x812
# Report:  .ui-compare/3k9x2a/report.html
# Summary: .ui-compare/3k9x2a/summary.json
```

`after` always compares with the Before of its run, so the report covers the whole change, however many times you run it.

The output is grouped by screen: a page, or a Storybook component with all its stories. Each line under a changed screen is one change: where it was seen, its areas (three at most, then a count of the rest) and a diff image. A change with five or more areas, or areas that cover more than half of the page, reads `changed across the page` instead. A change seen at several viewports, color schemes or stories is listed once with all of them; its areas and diff image are those of the one named in parentheses, such as `(in 1280x720)` or `(in Primary · 1280x720)`, because the same change can sit at other coordinates at another viewport. When the page grew or shrank, the line also gives both page sizes, such as `page size 1280x720 -> 1280x1600`. Errors come first; `noise`, `unchanged` and `skipped` screens get one line each at the end. The color scheme is named only when it is `dark`.

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

Every target is captured at every viewport × color scheme. Passing `--viewport` or `--color-scheme` replaces its default rather than adding to it.

### Unstable pages

`before` loads every shot twice. When the two loads differ (a clock, random data, a carousel), the shot is reported as `unstable` together with the area that moved. Mask that area with `--mask` and run `before` again. A shot that later changes only in or right next to those areas is reported as `noise`, not as a change.

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
├── summary.json   per-shot status, changed areas and image paths
└── report.html    the report, with its images embedded
```

`summary.json` lists every shot with its `status` (`changed`, `unchanged`, `error`, `skipped`), the mismatch ratio, the bounding box of the changed pixels, each separate changed area (`regions`) and, when the page size changed, the Before and After sizes (`dimensions`), so an agent can spot changes outside the area it meant to edit without reading the images. Shots reported as `noise` have the status `changed` here.

### The report

`report.html` is a single page per run, read from top to bottom like the before/after section of a pull request:

- The headline counts changed screens: pages, and Storybook components with all their stories.
- Capture errors come first, with the screen and the reason.
- Each changed screen gets a card. Every changed area is cropped with some margin and shown at its natural size, Before next to After, with the area outlined. With five or more areas, or areas that cover more than half of the page, the full page is shown instead. The same change at several viewports, color schemes or stories is shown once, with the conditions listed. **View full page** shows the whole page side by side, with a slider, or as the pixel diff.
- At the end, one line each for screens that changed only where they were unstable in Before, unchanged screens and skipped screens. Open a noise or unchanged line to see its images.

The page is in Japanese when the browser language is Japanese, and in English otherwise.

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
pnpm skill:validate   # validate skills/ui-compare against agentskills.io
```

## Release

Versioned and published with [pnpm's built-in release management](https://pnpm.io/versioning),
driven in CI by [k35o/pnpm-release-action](https://github.com/k35o/pnpm-release-action).

```sh
pnpm change   # describe the change (writes .changeset/<name>.md)
```

Merging to `main` lets the release workflow open a release PR and publish to npm.
