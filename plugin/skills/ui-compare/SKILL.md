---
name: ui-compare
description: Show the user what a UI change looks like before and after, with pixel diffs. Use whenever you are about to change how something renders — components, styles, layout, theming, copy on a page or a Storybook story — and the project has a dev server or Storybook you can reach, or when the user asks to see a before/after or a visual diff.
license: MIT
---

# ui-compare

`ui-compare before` screenshots pages and Storybook stories and prints a run id. `ui-compare after <id>` screenshots the same targets again, compares them with the Before shots, and writes a self-contained `report.html` for the user (or, in Claude Code with the ui-compare plugin, shows the report in a pane) plus `summary.json` (per shot, with the changed areas in `regions`) for you. Before must be captured **before you edit anything**: once the code has changed, the old rendering cannot be captured anymore.

## Workflow

### 1. Decide what to capture, then capture Before

Pick the pages and stories your change will touch, plus the ones that share the code you will edit (a shared component, a global stylesheet). The targets are fixed now; `after` captures exactly these.

The tool never starts servers. Start the dev server or `storybook dev` yourself if it is not running, then:

```bash
npx ui-compare before "Home=http://localhost:5173/" "Settings page=http://localhost:5173/settings"
npx ui-compare before --storybook http://localhost:6006 --story "Button=src/components/Button.stories.tsx" --story "Card=card--default"
npx ui-compare before "Landing page=./dist/index.html"
```

- Name every URL and file target and every `--story` pattern as `name=target`. The user reads these names in the report and the pane instead of URLs, so write them in the user's language, the way the user would call the page or component: `"料金ページ=http://localhost:5173/pricing"` for a user who writes in Japanese, `"Pricing page=http://localhost:5173/pricing"` for one who writes in English. Give each name to one thing only.
- A named `--story` pattern must match the stories of one component (one Storybook title); a pattern that matches several is a usage error. Give each component its own named pattern, such as `--story "ボタン=src/components/Button.stories.tsx" --story "カード=src/components/Card.stories.tsx"`.
- `--story` takes a story id, a story file path, or a glob over story file paths; quote globs. Without `--story`, every story is captured. Storybook 8.5 or later is required.
- Add `--viewport 1280x720 --viewport 375x812` when the change can affect small screens and `--color-scheme light --color-scheme dark` when it touches colors. Passing either option replaces its default (`1280x720`, `light`) rather than adding to it. Each target is captured at every viewport × color scheme.
- Remember the printed run id for the rest of the task.

Read the Before output and fix problems **before editing**. Lines are grouped by screen (a page, or a Storybook component with its stories) and start with its name; shots of a screen with the same status and reason share a line:

```text
Captured Before for run 3k9x2a: 3 screens, 6 shots
  ok        Home  1280x720, 375x812
  ok        Settings page  1280x720, 375x812
  unstable  Clock page  1280x720  differs between two loads at x=1100 y=16 120x24 (0.31%); mask it with --mask and run before again
  ok        Clock page  375x812
Next: make the change, then run: ui-compare after 3k9x2a
```

A target you did not name is listed under its page title, under its path when it has none or shares it with another unnamed page, and a component under the last segment of its title. When that is also how another target is listed, it gets a longer label, such as `a.test/settings`, `dist/index.html` or `Example/Button`.

- `unstable` means the page differed between two loads (clocks, random data, carousels). Run `before` again with `--mask "<selector>"` covering that area, and use the new id. If a thin strip stays unstable, the masked element changes size with its text; mask a fixed-size container around it instead.
- `error` means the shot could not be captured (server not running, HTTP error, redirect to a login page, compile error). Fix the cause or drop the target, then run `before` again.

### 2. Make the change

### 3. Capture After and compare

```bash
npx ui-compare after <id>
```

Run it after every round of edits, always with the **same id**: each run compares against the original Before, so the report shows the whole change of the task, not just the last step. Do not run `before` again in the middle of a task.

Then check the output (or `.ui-compare/<id>/summary.json`):

```text
Compared run 3k9x2a: 1 screen changed, 0 errors
  changed    Button (Storybook)
    Primary, Secondary · 1280x720, 375x812: 1 area at x=16 y=16 106x40 (in Primary · 1280x720)  .ui-compare/3k9x2a/diff/005-button-primary-1280x720-light.png
  noise      Clock page  1280x720, 375x812  changed only where it was unstable in Before
  unchanged  Settings page  1280x720, 375x812
```

- Each line under a `changed` screen is one distinct change: where it was seen (stories, viewports, `dark`), its areas (`at x=… y=… W×H`, or `changed across the page`), and a diff image. A changed screen you did not intend to change, or an area outside what you edited, is likely a regression. Look at the diff image before deciding.
- When a line lists several stories, viewports or color schemes, its areas and diff image belong to the one in parentheses (`(in Primary · 1280x720)`). At another viewport the same change can sit at other coordinates; read `summary.json` for those.
- `page size 1280x720 -> 1280x1100` on a line means the page grew or shrank. The strip it grew or shrank by counts as changed, and so does anything that moved with it.
- `error` lines come first. In After they usually mean the page is broken now (compile error, failed script, Storybook error). Fix it and run `after` again.
- `noise` changed only where the page already differed between two Before loads, so it is most likely not your change. If you edited that area, check its images in the report.

### 4. Show the result to the user

Say what changed, what did not, and anything unexpected, and point the user to the report:

- If the output says `Report:  shown in the ui-compare pane in Claude Code`, the report is in the ui-compare pane beside the conversation in Claude Code, and no `report.html` was written. Tell the user to look at the pane instead of giving a path; `/ui-compare-pane` opens the pane if it is not open.
- Otherwise, give the user the path of `.ui-compare/<id>/report.html`.

The report is one page per run, written for the user in the names you gave at `before`: a headline that names what changed (or what could not be captured), a sentence that counts the rest, then what could not be captured, then a card per changed page or component with each changed spot cropped from Before and After side by side, headed by where it was seen (widths, dark mode, stories), then one line each for what changed only where it changes on every load, what is unchanged and what was left out. It follows the browser language (Japanese or English) and is a single file with its images embedded, so it can be opened directly or attached. The pane shows the same content.

Each change in the pane has a **Not intended** button. It drafts a message into the user's prompt that names the run id, what changed (its name and its full URL or component title), where it was seen, its changed areas, and the paths of its diff and After images; the user adds their own words and sends it. Such a message asks you to undo or fix exactly that change and nothing else: look at the images it names, change the code, then run `after` with the same id again.

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
