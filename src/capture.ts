import { setTimeout as sleep } from 'node:timers/promises';

import { chromium, errors } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';

import type { CaptureOutcome, Shot, Target } from './types.ts';

export type CaptureOptions = { masks: string[] };

export type Capturer = {
  capture: (shot: Shot, options: CaptureOptions) => Promise<CaptureOutcome>;
  close: () => Promise<void>;
};

type Limits = { attemptTimeoutMs: number; storyTimeoutMs: number };

const ATTEMPT_TIMEOUT_MS = 120_000;
const NAVIGATION_TIMEOUT_MS = 30_000;
const NETWORK_IDLE_TIMEOUT_MS = 5000;
const STORY_TIMEOUT_MS = 30_000;
const STABILITY_RETRIES = 5;
const STABILITY_INTERVAL_MS = 100;
const MAX_PAGE_ERRORS = 3;
const MASK_COLOR = '#FF00FF';
const STORY_STATE_KEY = '__UI_COMPARE_STORY__';
const HIDE_VITE_OVERLAY = 'vite-error-overlay { display: none !important; }';

type StoryState = {
  done: boolean;
  rendered: boolean;
  error: string | null;
  warning: string | null;
};

type StoryChannel = {
  on: (eventName: string, listener: (payload: unknown) => void) => void;
};

type VrtParameters = {
  skip: boolean;
  delay: number;
  mask: string[];
  remove: string[];
};

type ShownErrors = { overlay: string | null; storybook: string | null };

class PageProblem extends Error {}

// The limits are parameters so that tests can reach them without waiting for
// minutes.
export async function launchCapturer({
  attemptTimeoutMs = ATTEMPT_TIMEOUT_MS,
  storyTimeoutMs = STORY_TIMEOUT_MS,
}: Partial<Limits> = {}): Promise<Capturer> {
  let browser: Browser;
  try {
    browser = await chromium.launch();
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("Executable doesn't exist")
    ) {
      throw new Error(
        "Chromium is not installed. Run 'npx playwright install chromium' and try again.",
        { cause: error },
      );
    }
    throw error;
  }
  const limits = { attemptTimeoutMs, storyTimeoutMs };
  return {
    capture: (shot, options) =>
      captureWithRetry(browser, shot, options, limits),
    close: () => browser.close(),
  };
}

async function captureWithRetry(
  browser: Browser,
  shot: Shot,
  options: CaptureOptions,
  limits: Limits,
): Promise<CaptureOutcome> {
  try {
    return await captureOnce(browser, shot, options, limits);
  } catch (error) {
    if (error instanceof PageProblem)
      return { status: 'error', message: error.message };
  }
  try {
    return await captureOnce(browser, shot, options, limits);
  } catch (error) {
    return { status: 'error', message: firstLine(error) };
  }
}

async function captureOnce(
  browser: Browser,
  shot: Shot,
  options: CaptureOptions,
  limits: Limits,
): Promise<CaptureOutcome> {
  const context = await browser.newContext({
    viewport: shot.viewport,
    colorScheme: shot.colorScheme,
    reducedMotion: 'reduce',
    deviceScaleFactor: 1,
  });
  const deadline = startDeadline(limits.attemptTimeoutMs);
  try {
    return await Promise.race([
      capturePage(context, shot, options, limits, deadline.extend),
      deadline.expired,
    ]);
  } finally {
    deadline.clear();
    // A page whose main thread is blocked never answers; closing the context
    // is what rejects the calls still waiting for it.
    await context.close();
  }
}

async function capturePage(
  context: BrowserContext,
  { target }: Shot,
  { masks }: CaptureOptions,
  { storyTimeoutMs }: Limits,
  extendDeadline: (ms: number) => void,
): Promise<CaptureOutcome> {
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => {
    if (pageErrors.length < MAX_PAGE_ERRORS)
      pageErrors.push(`Page error: ${error.message}`);
  });
  const failedScripts: string[] = [];
  page.on('response', (response) => {
    if (
      response.status() >= 400 &&
      response.request().resourceType() === 'script' &&
      new URL(response.url()).origin === new URL(target.url).origin
    )
      failedScripts.push(`${response.url()} (HTTP ${response.status()})`);
  });
  let documents = 0;
  let documentRequested = false;
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame())
      documentRequested = true;
  });
  // history.replaceState also navigates the main frame, but keeps the
  // document, so only a navigation that requested a new document starts over.
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame() || !documentRequested) return;
    documentRequested = false;
    documents++;
    failedScripts.length = 0;
  });
  if (target.kind === 'story') {
    await page.addInitScript(recordStoryLifecycle, {
      storyId: target.storyId,
      stateKey: STORY_STATE_KEY,
    });
  }

  await load(page, target.url);
  const loadedDocuments = documents;
  let storyWarning = await waitUntilSettled(
    page,
    target,
    failedScripts,
    storyTimeoutMs,
  );

  const warnings: string[] = [];
  let parameters: VrtParameters = {
    skip: false,
    delay: 0,
    mask: [],
    remove: [],
  };
  if (target.kind === 'story') {
    try {
      parameters = parseVrtParameters(
        await readVrtParameters(page, target.storyId),
      );
    } catch (error) {
      warnings.push(`Could not read the story parameters: ${firstLine(error)}`);
    }
    if (parameters.skip)
      return { status: 'skipped', reason: 'parameters.vrt.skip' };
    if (parameters.delay > 0) {
      extendDeadline(parameters.delay);
      await sleep(parameters.delay);
    }
  }
  // Vite answers a request for an outdated optimized dependency with 504 and
  // then reloads the page, so the document to capture can be a later one.
  if (documents !== loadedDocuments) {
    await page.waitForLoadState('load', { timeout: NAVIGATION_TIMEOUT_MS });
    storyWarning = await waitUntilSettled(
      page,
      target,
      failedScripts,
      storyTimeoutMs,
    );
  }
  if (storyWarning !== null) warnings.push(storyWarning);

  await checkPageHealth(page, failedScripts, warnings);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  // Client-side routers redirect after `load`, typically to a login page.
  assertNotRedirected(page, target.url);
  await assertValidSelectors(page, {
    '--mask': masks,
    'parameters.vrt.mask': parameters.mask,
    'parameters.vrt.remove': parameters.remove,
  });

  const maskLocators = [...masks, ...parameters.mask].map((selector) =>
    page.locator(selector),
  );
  const style = [
    HIDE_VITE_OVERLAY,
    ...parameters.remove.map(
      (selector) => `${selector} { display: none !important; }`,
    ),
  ].join('\n');
  const { png, settled } = await takeStableScreenshot(() =>
    page.screenshot({
      fullPage: true,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      mask: maskLocators,
      maskColor: MASK_COLOR,
      style,
    }),
  );
  // Vite reports a module that failed to compile over its websocket, so the
  // overlay can appear only while the screenshots are being taken.
  await checkPageHealth(page, failedScripts, warnings);
  if (!settled)
    warnings.push('The page did not settle; captured the last frame');
  const title = target.kind === 'url' ? (await page.title()).trim() : '';
  return {
    status: 'captured',
    png,
    warnings: [...warnings, ...pageErrors],
    ...(title === '' ? {} : { title }),
  };
}

function startDeadline(timeoutMs: number): {
  expired: Promise<never>;
  extend: (ms: number) => void;
  clear: () => void;
} {
  const startedAt = performance.now();
  let allowedMs = timeoutMs;
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    const check = () => {
      const leftMs = allowedMs - (performance.now() - startedAt);
      if (leftMs > 0) {
        timer = setTimeout(check, leftMs);
        return;
      }
      reject(
        new PageProblem(
          `The page stopped responding within ${allowedMs / 1000} s`,
        ),
      );
    };
    check();
  });
  return {
    expired,
    extend: (ms) => {
      allowedMs += ms;
    },
    clear: () => {
      clearTimeout(timer);
    },
  };
}

async function load(page: Page, url: string): Promise<void> {
  let response;
  try {
    response = await page.goto(url, {
      waitUntil: 'load',
      timeout: NAVIGATION_TIMEOUT_MS,
    });
  } catch (error) {
    const reason = firstLine(error)
      .replace(/^page\.goto: /, '')
      .replace(/ at \S+$/, '')
      .replace(/\.$/, '');
    const hint = /^https?:/i.test(url)
      ? '. Make sure the dev server is running'
      : '';
    throw new PageProblem(`Could not load ${url}: ${reason}${hint}`);
  }
  if (response && response.status() >= 400) {
    throw new PageProblem(`HTTP ${response.status()} from ${url}`);
  }
  assertNotRedirected(page, url);
}

async function waitUntilSettled(
  page: Page,
  target: Target,
  failedScripts: string[],
  storyTimeoutMs: number,
): Promise<string | null> {
  // Data fetched after `load` would otherwise be captured in its loading
  // state: with animations disabled, the stability loop alone cannot tell a
  // frozen spinner from the final page.
  await page
    .waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS })
    .catch(ignoreTimeout);
  return target.kind === 'story'
    ? waitForStory(page, target.storyId, failedScripts, storyTimeoutMs)
    : null;
}

function assertNotRedirected(page: Page, url: string): void {
  const finalUrl = page.url();
  const hashRouted = /^#!?\//.test(new URL(url).hash);
  if (
    documentAddress(finalUrl, hashRouted) !== documentAddress(url, hashRouted)
  ) {
    throw new PageProblem(
      `Redirected to ${finalUrl} (pages behind a login are not supported)`,
    );
  }
}

function documentAddress(url: string, hashRouted: boolean): string {
  const { origin, pathname, hash } = new URL(url);
  const route = hashRouted ? hash.replace(/\/$/, '') : '';
  return origin + pathname.replace(/\/$/, '') + route;
}

function recordStoryLifecycle({
  storyId,
  stateKey,
}: {
  storyId: string;
  stateKey: string;
}): void {
  const state: StoryState = {
    done: false,
    rendered: false,
    error: null,
    warning: null,
  };
  (globalThis as unknown as Record<string, StoryState>)[stateKey] = state;
  const settle = (error: string | null, warning: string | null = null) => {
    if (state.done) return;
    state.done = true;
    state.error = error;
    state.warning = warning;
  };
  const describe = (error: unknown) => {
    const { name = 'Error', message = '' } = (error ?? {}) as {
      name?: string;
      message?: string;
    };
    return `${name}: ${message}`;
  };

  // Storybook assigns its channel to this global (more than once while it
  // boots) and never exposes a hook that runs earlier, so the assignment
  // itself is trapped to subscribe before the first lifecycle event.
  const subscribed = new WeakSet<object>();
  let channel: unknown;
  Object.defineProperty(globalThis, '__STORYBOOK_ADDONS_CHANNEL__', {
    configurable: true,
    get: () => channel,
    set: (next: unknown) => {
      channel = next;
      if (typeof next !== 'object' || next === null || subscribed.has(next))
        return;
      if (typeof (next as Partial<StoryChannel>).on !== 'function') return;
      subscribed.add(next);
      const events = next as StoryChannel;
      events.on('storyRendered', () => {
        state.rendered = true;
      });
      events.on('storyFinished', (payload) => {
        const { status, reporters = [] } = (payload ?? {}) as {
          status?: string;
          reporters?: Array<{ type?: string; status?: string }>;
        };
        if (status !== 'error') {
          settle(null);
          return;
        }
        // Storybook also finishes with 'error' when a reporter such as a11y
        // fails; the story itself rendered, so it is still worth capturing.
        const failed = reporters
          .filter((report) => report.status === 'failed')
          .map((report) => report.type ?? 'unknown');
        settle(
          failed.length > 0
            ? null
            : `Storybook reported an error while rendering ${storyId}`,
          failed.length > 0
            ? `Storybook reported failing ${failed.join(', ')} checks for ${storyId}`
            : null,
        );
      });
      events.on('configError', (error) => {
        settle(`Storybook could not start: ${describe(error)}`);
      });
      events.on('unhandledErrorsWhilePlaying', (thrown) => {
        const list = Array.isArray(thrown) ? thrown : [thrown];
        settle(
          `The play function of ${storyId} left unhandled errors: ${list.map(describe).join('; ')}`,
        );
      });
      events.on('storyErrored', (payload) => {
        const { title = '', description = '' } = (payload ?? {}) as {
          title?: string;
          description?: string;
        };
        settle(
          `Story ${storyId} errored: ${[title, description].filter(Boolean).join(': ')}`,
        );
      });
      events.on('storyThrewException', (error) => {
        settle(`Story ${storyId} threw ${describe(error)}`);
      });
      events.on('playFunctionThrewException', (error) => {
        settle(`The play function of ${storyId} threw ${describe(error)}`);
      });
      events.on('storyMissing', () => {
        // When the story file fails to load, Storybook shows why on its error
        // display right before reporting the story missing; that message is
        // the one worth reporting.
        if (document.querySelector('body.sb-show-errordisplay') === null)
          settle(`Storybook has no story ${storyId}`);
      });
    },
  });
}

async function waitForStory(
  page: Page,
  storyId: string,
  failedScripts: string[],
  timeoutMs: number,
): Promise<string | null> {
  await page
    .waitForFunction(
      (key) =>
        (globalThis as unknown as Record<string, StoryState | undefined>)[key]
          ?.done === true ||
        document.querySelector('body.sb-show-errordisplay') !== null,
      STORY_STATE_KEY,
      { timeout: timeoutMs },
    )
    .catch(ignoreTimeout);
  const state = await page.evaluate(
    (key) =>
      (globalThis as unknown as Record<string, StoryState | undefined>)[key],
    STORY_STATE_KEY,
  );
  if (state?.done && state.error === null) return state.warning;
  const shown = await readShownErrors(page);
  // A component that fails to compile surfaces as a missing or unfinished
  // story; the script that failed to load names the real cause.
  throw new PageProblem(
    ownScriptError(failedScripts, shown) ??
      state?.error ??
      storybookError(shown) ??
      (state?.rendered
        ? `Storybook rendered ${storyId} but never reported storyFinished; ui-compare needs Storybook 8.5 or later`
        : `Storybook did not finish rendering ${storyId} within ${timeoutMs / 1000} s`),
  );
}

async function readVrtParameters(
  page: Page,
  storyId: string,
): Promise<unknown> {
  return page.evaluate(async (id) => {
    type Preview = {
      loadStory?: (input: {
        storyId: string;
      }) => Promise<{ parameters?: { vrt?: unknown } } | undefined>;
    };
    const preview = (
      globalThis as unknown as { __STORYBOOK_PREVIEW__?: Preview }
    ).__STORYBOOK_PREVIEW__;
    const story = await preview?.loadStory?.({ storyId: id });
    return story?.parameters?.vrt;
  }, storyId);
}

function parseVrtParameters(value: unknown): VrtParameters {
  const vrt = (typeof value === 'object' && value !== null ? value : {}) as {
    skip?: unknown;
    delay?: unknown;
    mask?: unknown;
    remove?: unknown;
  };
  return {
    skip: vrt.skip === true,
    delay: typeof vrt.delay === 'number' ? vrt.delay : 0,
    mask: selectorList(vrt.mask),
    remove: selectorList(vrt.remove),
  };
}

function selectorList(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

async function assertValidSelectors(
  page: Page,
  selectorsBySource: Record<string, string[]>,
): Promise<void> {
  const invalid = await page.evaluate((groups) => {
    for (const [source, selectors] of Object.entries(groups)) {
      for (const selector of selectors) {
        try {
          document.querySelector(selector);
        } catch {
          return `${source}: ${selector}`;
        }
        // querySelector closes brackets left open at the end, as in
        // '[data-x', which in a style sheet swallow every rule after them.
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(`${selector} {}`);
        if (
          sheet.cssRules.length !== 1 ||
          !(sheet.cssRules[0] instanceof CSSStyleRule)
        )
          return `${source}: ${selector}`;
      }
    }
    return null;
  }, selectorsBySource);
  if (invalid !== null)
    throw new PageProblem(`Invalid CSS selector in ${invalid}`);
}

async function readShownErrors(page: Page): Promise<ShownErrors> {
  return page.evaluate(() => {
    const overlay = document.querySelector('vite-error-overlay');
    const storybookShowsError =
      document.querySelector('body.sb-show-errordisplay') !== null;
    return {
      overlay:
        overlay === null
          ? null
          : (
              overlay.shadowRoot?.querySelector('.message')?.textContent ??
              overlay.textContent
            ).trim(),
      storybook: storybookShowsError
        ? (document.querySelector('#error-message')?.textContent ?? '').trim()
        : null,
    };
  });
}

// Vite broadcasts its error overlay to every page it serves, so the overlay
// only breaks a page whose own script failed to load.
function ownScriptError(
  failedScripts: string[],
  { overlay }: ShownErrors,
): string | null {
  const [failed] = failedScripts;
  if (failed === undefined) return null;
  return overlay === null
    ? `Failed to load ${failed}`
    : `Vite error overlay: ${overlay.slice(0, 500)}`;
}

function storybookError({ storybook }: ShownErrors): string | null {
  return storybook === null
    ? null
    : `Storybook error: ${storybook.slice(0, 500)}`;
}

async function checkPageHealth(
  page: Page,
  failedScripts: string[],
  warnings: string[],
): Promise<void> {
  const shown = await readShownErrors(page);
  const error = ownScriptError(failedScripts, shown) ?? storybookError(shown);
  if (error !== null) throw new PageProblem(error);
  if (shown.overlay === null) return;
  const warning = `Vite reported an error in another module: ${firstLine(shown.overlay)}`;
  if (!warnings.includes(warning)) warnings.push(warning);
}

async function takeStableScreenshot(
  takeShot: () => Promise<Buffer>,
): Promise<{ png: Buffer; settled: boolean }> {
  let previous = await takeShot();
  for (let attempt = 1; attempt < STABILITY_RETRIES; attempt++) {
    await sleep(STABILITY_INTERVAL_MS);
    const shot = await takeShot();
    if (shot.equals(previous)) return { png: shot, settled: true };
    previous = shot;
  }
  return { png: previous, settled: false };
}

function ignoreTimeout(error: unknown): void {
  if (!(error instanceof errors.TimeoutError)) throw error;
}

function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split('\n', 1)[0] ?? message;
}
