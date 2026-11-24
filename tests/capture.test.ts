import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test';

import { launchCapturer } from '../src/capture.ts';
import type { Capturer } from '../src/capture.ts';
import type { CaptureOutcome, Shot } from '../src/types.ts';

type Route = {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
};

const VIEWPORT = { width: 400, height: 300 };
const STORY_ID = 'example--story';

const FONT_SAMPLE = `
  <p style="margin: 8px; font: 16px monospace">monospace 0123 The quick brown fox</p>
  <p style="margin: 8px; font: 16px serif">serif 0123 The quick brown fox</p>`;

function html(body: string, head = ''): string {
  return `<!doctype html><html><head><style>body { margin: 0; background: #fff; }</style>${head}</head><body>${body}</body></html>`;
}

const VITE_OVERLAY = `<script>
  customElements.define('vite-error-overlay', class extends HTMLElement {
    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = '<style>:host { position: fixed; inset: 0; background: #f00; }</style>' +
        '<div class="window"><pre class="message"><span class="plugin"></span><span class="message-body"></span></pre></div>';
      root.querySelector('.plugin').textContent = '[plugin:vite:esbuild] ';
      root.querySelector('.message-body').textContent =
        ${JSON.stringify('Transform failed with 1 error:\n/src/main.ts:1:0: ERROR: Unexpected token')};
    }
  });
  document.body.append(document.createElement('vite-error-overlay'));
</script>`;

const RED_BLOCK = '<div style="height: 300px; background: #f00"></div>';
const BLUE_BLOCK = '<div style="height: 300px; background: #00f"></div>';

const FAKE_CHANNEL = `
  const listeners = new Map();
  const channel = {
    on: (eventName, listener) => listeners.set(eventName, [...(listeners.get(eventName) ?? []), listener]),
    emit: (eventName, value) => (listeners.get(eventName) ?? []).forEach((listener) => listener(value)),
  };
  globalThis.__STORYBOOK_ADDONS_CHANNEL__ = channel;`;

function fakePreview(vrt: unknown): string {
  return `globalThis.__STORYBOOK_PREVIEW__ = {
    loadStory: async ({ storyId }) => ({ id: storyId, parameters: { vrt: ${JSON.stringify(vrt)} } }),
  };`;
}

function fakeStorybook({
  story,
  event,
  payload,
  renderDelay,
  vrt,
  bodyClass = '',
  afterEvent = '',
}: {
  story: string;
  event: string;
  payload: unknown;
  renderDelay: number;
  vrt?: unknown;
  bodyClass?: string;
  afterEvent?: string;
}): string {
  return html(
    `<div id="root"></div>
    <script>
      ${vrt === undefined ? '' : fakePreview(vrt)}
      setTimeout(() => {
        ${FAKE_CHANNEL}
        setTimeout(() => {
          document.getElementById('root').innerHTML = ${JSON.stringify(story)};
          document.body.className = ${JSON.stringify(bodyClass)};
          channel.emit(${JSON.stringify(event)}, ${JSON.stringify(payload)});
          ${afterEvent}
        }, ${renderDelay});
      }, 100);
    </script>`,
  );
}

const routes: Record<string, Route> = {
  '/short': { body: html(FONT_SAMPLE) },
  '/tall': {
    body: html(
      `${FONT_SAMPLE}<div style="height: 2000px"></div><p>end of the page</p>`,
    ),
  },
  '/viewport-high': {
    body: html(
      '<div style="height: 100vh; background: #00f"></div><div style="height: 1000px"></div>',
    ),
  },
  '/color-scheme': {
    body: html(
      '<p>scheme</p>',
      '<style>@media (prefers-color-scheme: dark) { body { background: #000; } }</style>',
    ),
  },
  '/missing': { status: 404, body: html('<p>not found</p>') },
  '/private': { status: 302, headers: { location: '/login' } },
  '/login': { body: html('<p>log in</p>') },
  '/client-redirect': {
    body: html(`<p>dashboard</p><script>
      addEventListener('load', () => setTimeout(() => {
        history.replaceState(null, '', '/login');
        document.body.innerHTML = '<p>log in</p>';
      }, 50));
    </script>`),
  },
  '/hash-login': {
    body: html(`<p>settings</p><script>
      addEventListener('load', () => setTimeout(() => {
        history.replaceState(null, '', '#/login');
      }, 50));
    </script>`),
  },
  '/hash-trailing-slash': {
    body: html(`<p>settings</p><script>
      addEventListener('load', () => setTimeout(() => {
        history.replaceState(null, '', location.hash.replace(/\\/$/, ''));
      }, 50));
    </script>`),
  },
  '/vite-error': {
    body: html(
      `<p>app</p><script type="module" src="/main.js"></script>${VITE_OVERLAY}`,
    ),
  },
  '/vite-error-elsewhere': { body: html(`<p>app</p>${VITE_OVERLAY}`) },
  '/broken-module': {
    body: html('<p>app</p><script type="module" src="/main.js"></script>'),
  },
  '/broken-module-replace-state': {
    body: html(`<p>app</p><script type="module" src="/main.js"></script><script>
      addEventListener('load', () => history.replaceState(null, '', location.href));
    </script>`),
  },
  '/main.js': { status: 500, body: 'Transform failed' },
  '/outdated-dep': {
    body: html(`<p>app</p><script>
      const reloaded = sessionStorage.getItem('reloaded') === 'yes';
      const script = document.createElement('script');
      script.type = 'module';
      script.src = reloaded ? '/dep.js?v=new' : '/dep.js?v=old';
      document.head.append(script);
      if (!reloaded) {
        addEventListener('load', () => setTimeout(() => {
          sessionStorage.setItem('reloaded', 'yes');
          location.reload();
        }, 50));
      }
    </script>`),
  },
  '/dep.js?v=old': { status: 504, body: 'Outdated Optimize Dep' },
  '/dep.js?v=new': {
    headers: { 'content-type': 'text/javascript' },
    body: "document.body.style.background = '#00f';",
  },
  '/blocked': {
    body: html(`<p>busy</p><script>
      addEventListener('load', () => setTimeout(() => { while (true) {} }, 50));
    </script>`),
  },
  '/secret': {
    body: html(
      '<div id="secret" style="width: 50px; height: 50px; background: #0f0"></div>',
    ),
  },
  '/spinner': {
    body: html(
      `<div class="spinner" style="width: 40px; height: 40px; border-top: 4px solid #00f"></div>
      <div class="slider" style="width: 40px; height: 40px; background: #f00"></div>`,
      `<style>
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes slide { to { transform: translateX(300px); } }
        .spinner { animation: spin 1s linear infinite; }
        .slider { animation: slide 700ms ease-in-out infinite alternate; }
      </style>`,
    ),
  },
  '/page-error': {
    body: html('<p>broken</p><script>throw new Error("boom")</script>'),
  },
  '/titled': {
    body: html(
      '<p>pricing</p>',
      '<meta charset="utf-8"><title>  料金 | Example  </title>',
    ),
  },
  '/titled-by-script': {
    body: html(
      '<p>pricing</p>',
      `<title>Loading</title><script>
        addEventListener('load', () => setTimeout(() => {
          document.title = 'Pricing';
        }, 50));
      </script>`,
    ),
  },
  '/blank-title': { body: html('<p>pricing</p>', '<title>   </title>') },
  '/story/success': {
    body: fakeStorybook({
      story: '<div style="height: 300px; background: #00f"></div>',
      event: 'storyFinished',
      payload: { storyId: STORY_ID, status: 'success' },
      renderDelay: 1500,
    }),
  },
  '/story/error': {
    body: fakeStorybook({
      story: '<p>failed</p>',
      event: 'storyFinished',
      payload: { storyId: STORY_ID, status: 'error' },
      renderDelay: 50,
    }),
  },
  '/story/failed-check': {
    body: fakeStorybook({
      story: '<div style="height: 300px; background: #00f"></div>',
      event: 'storyFinished',
      payload: {
        storyId: STORY_ID,
        status: 'error',
        reporters: [{ type: 'a11y', status: 'failed' }],
      },
      renderDelay: 50,
    }),
  },
  '/story/unhandled': {
    body: fakeStorybook({
      story: '<p>played</p>',
      event: 'unhandledErrorsWhilePlaying',
      payload: [{ name: 'TypeError', message: 'user is undefined' }],
      renderDelay: 50,
    }),
  },
  '/story/compile-error': {
    body: fakeStorybook({
      story:
        '<div id="error-message">Failed to fetch dynamically imported module: /src/button.stories.tsx</div>',
      bodyClass: 'sb-show-errordisplay',
      event: 'storyMissing',
      payload: STORY_ID,
      renderDelay: 50,
    }),
  },
  '/story/missing': {
    body: fakeStorybook({
      story: '<p>missing</p>',
      event: 'storyMissing',
      payload: STORY_ID,
      renderDelay: 50,
    }),
  },
  '/story/skip': {
    body: fakeStorybook({
      story: '<p>skipped</p>',
      event: 'storyFinished',
      payload: { storyId: STORY_ID, status: 'success' },
      renderDelay: 50,
      vrt: { skip: true },
    }),
  },
  '/story/mask': {
    body: fakeStorybook({
      story:
        '<div class="clock" style="width: 50px; height: 50px; background: #0f0"></div>',
      event: 'storyFinished',
      payload: { storyId: STORY_ID, status: 'success' },
      renderDelay: 50,
      vrt: { mask: '.clock' },
    }),
  },
  '/story/remove': {
    body: fakeStorybook({
      story:
        '<div class="banner" style="height: 50px; background: #f00"></div><div style="height: 50px; background: #00f"></div>',
      event: 'storyFinished',
      payload: { storyId: STORY_ID, status: 'success' },
      renderDelay: 50,
      vrt: { remove: ['.banner'] },
    }),
  },
  '/story/invalid-remove': {
    body: fakeStorybook({
      story: '<div class="banner"></div>',
      event: 'storyFinished',
      payload: { storyId: STORY_ID, status: 'success' },
      renderDelay: 50,
      vrt: { remove: ['[data-x', '.banner'] },
    }),
  },
  '/story/delay': {
    body: fakeStorybook({
      story: RED_BLOCK,
      event: 'storyFinished',
      payload: { storyId: STORY_ID, status: 'success' },
      renderDelay: 1000,
      vrt: { delay: 1500 },
      afterEvent: `setTimeout(() => {
        document.getElementById('root').innerHTML = ${JSON.stringify(BLUE_BLOCK)};
      }, 600);`,
    }),
  },
  '/story/reload': {
    body: html(`<div id="root"></div><script>
      const reloaded = sessionStorage.getItem('reloaded') === 'yes';
      ${fakePreview({ delay: 2000 })}
      setTimeout(() => {
        ${FAKE_CHANNEL}
        setTimeout(() => {
          document.getElementById('root').innerHTML = reloaded ? ${JSON.stringify(BLUE_BLOCK)} : ${JSON.stringify(RED_BLOCK)};
          channel.emit('storyFinished', { storyId: ${JSON.stringify(STORY_ID)}, status: 'success' });
          if (!reloaded) {
            setTimeout(() => {
              sessionStorage.setItem('reloaded', 'yes');
              location.reload();
            }, 700);
          }
        }, reloaded ? 2500 : 50);
      }, 100);
    </script>`),
  },
  '/story/config-error': {
    body: fakeStorybook({
      story: '<div id="error-message">preview.ts exploded</div>',
      bodyClass: 'sb-show-errordisplay',
      event: 'configError',
      payload: { name: 'Error', message: 'preview.ts exploded' },
      renderDelay: 50,
    }),
  },
  '/story/error-display': {
    // The error display goes away later, so a capture that waited for the
    // story timeout instead of stopping at the display reports another error.
    body: fakeStorybook({
      story: '<div id="error-message">Error fetching `/index.json`:</div>',
      bodyClass: 'sb-show-errordisplay',
      event: 'storyIndexInvalidated',
      payload: null,
      renderDelay: 50,
      afterEvent: `setTimeout(() => {
        document.body.className = '';
      }, 5000);`,
    }),
  },
  '/story/rendered-only': {
    body: fakeStorybook({
      story: BLUE_BLOCK,
      event: 'storyRendered',
      payload: STORY_ID,
      renderDelay: 50,
    }),
  },
};

let server: Server;
let baseUrl: string;
let capturer: Capturer;

beforeAll(async () => {
  server = createServer((request, response) => {
    const { pathname, search } = new URL(
      request.url ?? '/',
      'http://localhost',
    );
    const route = routes[pathname + search] ?? routes[pathname];
    if (!route) {
      response.writeHead(404).end();
      return;
    }
    response
      .writeHead(route.status ?? 200, {
        'content-type': 'text/html',
        ...route.headers,
      })
      .end(route.body ?? '');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  capturer = await launchCapturer();
});

afterAll(async () => {
  await capturer.close();
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

function urlShot(
  path: string,
  overrides: Partial<Pick<Shot, 'colorScheme'>> = {},
): Shot {
  return {
    key: path,
    target: { kind: 'url', url: `${baseUrl}${path}` },
    viewport: VIEWPORT,
    colorScheme: 'light',
    ...overrides,
  };
}

function storyShot(path: string): Shot {
  return {
    key: path,
    target: {
      kind: 'story',
      url: `${baseUrl}${path}?id=${STORY_ID}&viewMode=story`,
      storyId: STORY_ID,
      title: 'Example',
      name: 'Story',
      importPath: './src/Example.stories.tsx',
    },
    viewport: VIEWPORT,
    colorScheme: 'light',
  };
}

function capturedPng(outcome: CaptureOutcome): Buffer {
  if (outcome.status !== 'captured')
    throw new Error(`Not captured: ${JSON.stringify(outcome)}`);
  return outcome.png;
}

function image(outcome: CaptureOutcome): PNG {
  return PNG.sync.read(capturedPng(outcome));
}

function pixel(png: PNG, x: number, y: number): number[] {
  const offset = (y * png.width + x) * 4;
  return [...png.data.subarray(offset, offset + 4)];
}

function rowsWithColorAt(png: PNG, x: number, color: number[]): number {
  let rows = 0;
  for (let y = 0; y < png.height; y++) {
    if (pixel(png, x, y).every((channel, index) => channel === color[index]))
      rows++;
  }
  return rows;
}

function differentPixelsInTopRows(a: PNG, b: PNG, rows: number): number {
  let different = 0;
  for (let offset = 0; offset < a.width * rows * 4; offset += 4) {
    if (a.data.readUInt32BE(offset) !== b.data.readUInt32BE(offset))
      different++;
  }
  return different;
}

const BLUE = [0, 0, 255, 255];
const WHITE = [255, 255, 255, 255];

describe('capture', () => {
  test('renders generic font families the same on a short page and a tall page', async () => {
    const short = image(
      await capturer.capture(urlShot('/short'), { masks: [] }),
    );
    const tall = image(await capturer.capture(urlShot('/tall'), { masks: [] }));

    expect(differentPixelsInTopRows(short, tall, 100)).toBe(0);
  });

  test('captures the same tall page byte-identically twice', async () => {
    const first = capturedPng(
      await capturer.capture(urlShot('/tall'), { masks: [] }),
    );
    const second = capturedPng(
      await capturer.capture(urlShot('/tall'), { masks: [] }),
    );

    expect(first.equals(second)).toBe(true);
  });

  test('captures four shots at once the same as one at a time', async () => {
    const alone = capturedPng(
      await capturer.capture(urlShot('/tall'), { masks: [] }),
    );
    const together = await Promise.all(
      [1, 2, 3, 4].map(async () =>
        capturedPng(await capturer.capture(urlShot('/tall'), { masks: [] })),
      ),
    );

    expect(together.map((png) => png.equals(alone))).toStrictEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  test('keeps a 100vh block as tall as the viewport in a full-page image', async () => {
    const png = image(
      await capturer.capture(urlShot('/viewport-high'), { masks: [] }),
    );

    expect(rowsWithColorAt(png, 10, BLUE)).toBe(300);
  });

  test('captures the whole document height', async () => {
    const png = image(
      await capturer.capture(urlShot('/viewport-high'), { masks: [] }),
    );

    expect(png.height).toBe(1300);
  });

  test('makes the image as wide as the viewport', async () => {
    const png = image(await capturer.capture(urlShot('/short'), { masks: [] }));

    expect(png.width).toBe(400);
  });

  test('passes the dark color scheme to prefers-color-scheme', async () => {
    const png = image(
      await capturer.capture(
        urlShot('/color-scheme', { colorScheme: 'dark' }),
        { masks: [] },
      ),
    );

    expect(pixel(png, 5, 5)).toStrictEqual([0, 0, 0, 255]);
  });

  test('reports an HTTP error status as an error', async () => {
    const outcome = await capturer.capture(urlShot('/missing'), { masks: [] });

    expect(outcome).toStrictEqual({
      status: 'error',
      message: expect.stringContaining('HTTP 404'),
    });
  });

  test('reports a redirect to a login page as an error', async () => {
    const outcome = await capturer.capture(urlShot('/private'), { masks: [] });

    expect(outcome).toStrictEqual({
      status: 'error',
      message: expect.stringContaining('/login'),
    });
  });

  test('reports a client-side redirect after load as an error', async () => {
    const outcome = await capturer.capture(urlShot('/client-redirect'), {
      masks: [],
    });

    expect(outcome).toStrictEqual({
      status: 'error',
      message: expect.stringContaining('Redirected to'),
    });
  });

  test('reports a redirect between hash routes as an error', async () => {
    const outcome = await capturer.capture(urlShot('/hash-login#/settings'), {
      masks: [],
    });

    expect(outcome).toStrictEqual({
      status: 'error',
      message: `Redirected to ${baseUrl}/hash-login#/login (pages behind a login are not supported)`,
    });
  });

  test('ignores a trailing slash dropped from a hash route', async () => {
    const outcome = await capturer.capture(
      urlShot('/hash-trailing-slash#/settings/'),
      { masks: [] },
    );

    expect(outcome).toMatchObject({ status: 'captured', warnings: [] });
  });

  test('reports a server that is not running as an error', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) =>
      closed.listen(0, '127.0.0.1', resolve),
    );
    const { port } = closed.address() as AddressInfo;
    await new Promise<void>((resolve) => closed.close(() => resolve()));

    const outcome = await capturer.capture(
      {
        ...urlShot('/'),
        target: { kind: 'url', url: `http://127.0.0.1:${port}/` },
      },
      { masks: [] },
    );

    expect(outcome).toStrictEqual({
      status: 'error',
      message: expect.stringContaining(
        `Could not load http://127.0.0.1:${port}/`,
      ),
    });
  });

  test('reports a same-origin script that failed to load as an error', async () => {
    const outcome = await capturer.capture(urlShot('/broken-module'), {
      masks: [],
    });

    expect(outcome).toStrictEqual({
      status: 'error',
      message: `Failed to load ${baseUrl}/main.js (HTTP 500)`,
    });
  });

  test('keeps a failed script reported after history.replaceState', async () => {
    const outcome = await capturer.capture(
      urlShot('/broken-module-replace-state'),
      { masks: [] },
    );

    expect(outcome).toStrictEqual({
      status: 'error',
      message: `Failed to load ${baseUrl}/main.js (HTTP 500)`,
    });
  });

  test('captures the page Vite reloads after an outdated optimized dependency', async () => {
    const png = image(
      await capturer.capture(urlShot('/outdated-dep'), { masks: [] }),
    );

    expect(pixel(png, 10, 10)).toStrictEqual(BLUE);
  });

  test('reports the Vite error overlay of a page whose own script failed', async () => {
    const outcome = await capturer.capture(urlShot('/vite-error'), {
      masks: [],
    });

    expect(outcome).toStrictEqual({
      status: 'error',
      message:
        'Vite error overlay: [plugin:vite:esbuild] Transform failed with 1 error:\n/src/main.ts:1:0: ERROR: Unexpected token',
    });
  });

  test('captures a page that shows the Vite error overlay of another module, with a warning', async () => {
    const outcome = await capturer.capture(urlShot('/vite-error-elsewhere'), {
      masks: [],
    });

    expect(outcome).toMatchObject({
      status: 'captured',
      warnings: [
        'Vite reported an error in another module: [plugin:vite:esbuild] Transform failed with 1 error:',
      ],
    });
  });

  test('hides the Vite error overlay of another module in the image', async () => {
    const png = image(
      await capturer.capture(urlShot('/vite-error-elsewhere'), { masks: [] }),
    );

    expect(pixel(png, 10, 10)).toStrictEqual(WHITE);
  });

  test('covers masked elements with magenta', async () => {
    const png = image(
      await capturer.capture(urlShot('/secret'), { masks: ['#secret'] }),
    );

    expect(pixel(png, 25, 25)).toStrictEqual([255, 0, 255, 255]);
  });

  test('reports an invalid --mask selector as an error', async () => {
    const outcome = await capturer.capture(urlShot('/secret'), {
      masks: ['[data-x'],
    });

    expect(outcome).toStrictEqual({
      status: 'error',
      message: 'Invalid CSS selector in --mask: [data-x',
    });
  });

  test('freezes infinite CSS animations so two captures are byte-identical', async () => {
    const first = await capturer.capture(urlShot('/spinner'), { masks: [] });
    const second = await capturer.capture(urlShot('/spinner'), { masks: [] });

    expect(first).toMatchObject({ status: 'captured', warnings: [] });
    expect(capturedPng(first).equals(capturedPng(second))).toBe(true);
  });

  test('reads the title of the page, trimmed', async () => {
    const outcome = await capturer.capture(urlShot('/titled'), { masks: [] });

    expect(outcome).toMatchObject({
      status: 'captured',
      title: '料金 | Example',
    });
  });

  test('reads the title a script of the page sets after load', async () => {
    const outcome = await capturer.capture(urlShot('/titled-by-script'), {
      masks: [],
    });

    expect(outcome).toMatchObject({ status: 'captured', title: 'Pricing' });
  });

  test.each(['/short', '/blank-title'])(
    'leaves out the empty title of %s',
    async (path) => {
      const outcome = await capturer.capture(urlShot(path), { masks: [] });

      expect(outcome).not.toHaveProperty('title');
    },
  );

  test('reports uncaught page errors as warnings', async () => {
    const outcome = await capturer.capture(urlShot('/page-error'), {
      masks: [],
    });

    expect(outcome).toMatchObject({
      status: 'captured',
      warnings: ['Page error: boom'],
    });
  });
});

describe('capture of a Storybook story', () => {
  test('waits for storyFinished before capturing', async () => {
    const png = image(
      await capturer.capture(storyShot('/story/success'), { masks: [] }),
    );

    expect(pixel(png, 10, 10)).toStrictEqual(BLUE);
  });

  test('reports a story that finished with status error as an error', async () => {
    const outcome = await capturer.capture(storyShot('/story/error'), {
      masks: [],
    });

    expect(outcome).toStrictEqual({
      status: 'error',
      message: 'Storybook reported an error while rendering example--story',
    });
  });

  test('waits for parameters.vrt.delay after storyFinished', async () => {
    const png = image(
      await capturer.capture(storyShot('/story/delay'), { masks: [] }),
    );

    expect(pixel(png, 10, 10)).toStrictEqual(BLUE);
  });

  test('waits for a story page that reloads after storyFinished to finish again', async () => {
    const png = image(
      await capturer.capture(storyShot('/story/reload'), { masks: [] }),
    );

    expect(pixel(png, 10, 10)).toStrictEqual(BLUE);
  });

  test('reports a Storybook that could not start as an error', async () => {
    const outcome = await capturer.capture(storyShot('/story/config-error'), {
      masks: [],
    });

    expect(outcome).toStrictEqual({
      status: 'error',
      message: 'Storybook could not start: Error: preview.ts exploded',
    });
  });

  test('reports the error display of Storybook as soon as it is shown', async () => {
    const outcome = await capturer.capture(storyShot('/story/error-display'), {
      masks: [],
    });

    expect(outcome).toStrictEqual({
      status: 'error',
      message: 'Storybook error: Error fetching `/index.json`:',
    });
  });

  test('captures a story whose only failure is a reporter, with a warning', async () => {
    const outcome = await capturer.capture(storyShot('/story/failed-check'), {
      masks: [],
    });

    expect(outcome).toMatchObject({
      status: 'captured',
      warnings: [`Storybook reported failing a11y checks for ${STORY_ID}`],
    });
  });

  test('reports unhandled errors of the play function as an error', async () => {
    const outcome = await capturer.capture(storyShot('/story/unhandled'), {
      masks: [],
    });

    expect(outcome).toStrictEqual({
      status: 'error',
      message: expect.stringContaining('TypeError: user is undefined'),
    });
  });

  test('reports the error Storybook shows instead of the story it could not load', async () => {
    const outcome = await capturer.capture(storyShot('/story/compile-error'), {
      masks: [],
    });

    expect(outcome).toStrictEqual({
      status: 'error',
      message:
        'Storybook error: Failed to fetch dynamically imported module: /src/button.stories.tsx',
    });
  });

  test('reports a missing story as an error', async () => {
    const outcome = await capturer.capture(storyShot('/story/missing'), {
      masks: [],
    });

    expect(outcome).toStrictEqual({
      status: 'error',
      message: 'Storybook has no story example--story',
    });
  });

  test('skips a story whose parameters.vrt.skip is true', async () => {
    const outcome = await capturer.capture(storyShot('/story/skip'), {
      masks: [],
    });

    expect(outcome).toStrictEqual({
      status: 'skipped',
      reason: 'parameters.vrt.skip',
    });
  });

  test('masks the selectors in parameters.vrt.mask', async () => {
    const png = image(
      await capturer.capture(storyShot('/story/mask'), { masks: [] }),
    );

    expect(pixel(png, 25, 25)).toStrictEqual([255, 0, 255, 255]);
  });

  test('hides the selectors in parameters.vrt.remove', async () => {
    const png = image(
      await capturer.capture(storyShot('/story/remove'), { masks: [] }),
    );

    expect(pixel(png, 10, 10)).toStrictEqual(BLUE);
  });

  test('reports an invalid parameters.vrt.remove selector as an error', async () => {
    const outcome = await capturer.capture(storyShot('/story/invalid-remove'), {
      masks: [],
    });

    expect(outcome).toStrictEqual({
      status: 'error',
      message: 'Invalid CSS selector in parameters.vrt.remove: [data-x',
    });
  });
});

describe('capture with short limits', () => {
  let limited: Capturer;

  beforeAll(async () => {
    limited = await launchCapturer({
      attemptTimeoutMs: 4000,
      storyTimeoutMs: 1000,
    });
  });

  afterAll(async () => {
    await limited.close();
  });

  test('reports a page that stops responding as an error', async () => {
    const outcome = await limited.capture(urlShot('/blocked'), { masks: [] });

    expect(outcome).toStrictEqual({
      status: 'error',
      message: 'The page stopped responding within 4 s',
    });
  });

  test('captures the next shot after a page stopped responding', async () => {
    await limited.capture(urlShot('/blocked'), { masks: [] });

    const next = await limited.capture(urlShot('/short'), { masks: [] });

    expect(next).toMatchObject({ status: 'captured', warnings: [] });
  });

  test('reports a story that rendered but never finished as needing Storybook 8.5', async () => {
    const outcome = await limited.capture(storyShot('/story/rendered-only'), {
      masks: [],
    });

    expect(outcome).toStrictEqual({
      status: 'error',
      message:
        'Storybook rendered example--story but never reported storyFinished; ui-compare needs Storybook 8.5 or later',
    });
  });
});
