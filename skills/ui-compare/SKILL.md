---
name: ui-compare
description: Show the user what a UI change looks like before and after, with pixel diffs. Use whenever you are about to change how something renders — components, styles, layout, theming, copy on a page or a Storybook story — and the project has a dev server or Storybook you can reach, or when the user asks to see a before/after or a visual diff.
license: MIT
---

# ui-compare

`ui-compare before` screenshots pages and Storybook stories and prints a run id. `ui-compare after <id>` screenshots the same targets again, compares them with the Before shots, and writes a self-contained `report.html` for the user plus `summary.json` for you. Before must be captured **before you edit anything**: once the code has changed, the old rendering cannot be captured anymore.

## Workflow

### 1. Decide what to capture, then capture Before

Pick the pages and stories your change will touch, plus the ones that share the code you will edit (a shared component, a global stylesheet). The targets are fixed now; `after` captures exactly these.

The tool never starts servers. Start the dev server or `storybook dev` yourself if it is not running, then:

```bash
npx ui-compare before http://localhost:5173/ http://localhost:5173/settings
npx ui-compare before --storybook http://localhost:6006 --story "src/components/Button*" --story card--default
npx ui-compare before ./dist/index.html
```

- `--story` takes a story id, a story file path, or a glob over story file paths; quote globs. Without `--story`, every story is captured. Storybook 8.5 or later is required.
- Add `--viewport 375x812` when the change can affect small screens and `--color-scheme dark` when it touches colors. Each target is captured at every viewport × color scheme.
- Remember the printed run id for the rest of the task.

Read the Before output and fix problems **before editing**:

- `unstable` means the page differed between two loads (clocks, random data, carousels). Run `before` again with `--mask "<selector>"` covering that area, and use the new id. If a thin strip stays unstable, the masked element changes size with its text; mask a fixed-size container around it instead.
- `error` means the shot could not be captured (server not running, HTTP error, redirect to a login page, compile error). Fix the cause or drop the target, then run `before` again.

### 2. Make the change

### 3. Capture After and compare

```bash
npx ui-compare after <id>
```

Run it after every round of edits, always with the **same id**: each run compares against the original Before, so the report shows the whole change of the task, not just the last step. Do not run `before` again in the middle of a task.

Then check the output (or `.ui-compare/<id>/summary.json`):

- `changed` shots you did not intend to change, or a changed area (`at x=… y=… W×H`) outside what you edited, are likely regressions. Look at the diff image path printed on that line before deciding.
- `error` in After usually means the page is broken now (compile error, failed script, Storybook error). Fix it and run `after` again.
- A shot marked `unstable in Before` may show noise inside the reported area.

### 4. Show the result to the user

Give the user the path of `.ui-compare/<id>/report.html` and say what changed, what did not, and anything unexpected. The report is a single file with the images embedded, so it can be opened directly or attached.

## Exit codes

- `0`: every shot was captured, changed, unchanged or skipped. Differences never fail the command.
- `1`: at least one shot is an error (details on its line), or the tool crashed.
- `2`: usage error (bad option, unknown run id, unreachable Storybook index). The message says what to fix.

## Gotchas

- Never use `git stash` or a checkout to recreate the Before state; the stash is shared across worktrees. If you forgot `before`, tell the user instead of faking a baseline.
- `.ui-compare/` contains its own `.gitignore`; do not commit it and do not delete other runs.
- Chromium must be installed for Playwright. If the tool says it is missing, run `npx playwright install chromium`.
- Pages that need a login are not supported; they are reported as redirects.
- An error such as `Failed to load .../node_modules/.vite/deps/...(HTTP 504)` right after you added a dependency means Vite was re-optimizing its dependencies. Run the same command again.
- Storybook stories honour `parameters.vrt` (`skip`, `delay`, `mask`, `remove`), the same keys storybook-addon-vrt uses.
