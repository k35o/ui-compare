import { fmt, test, TEST_GLOBS, typescript } from '@k8o/oxc-config';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  fmt: {
    ...fmt,
    // pnpm's release management owns CHANGELOG.md and .changeset/ (ledger.yaml
    // etc.), so the repo's formatting rules must not touch them
    ignorePatterns: ['CHANGELOG.md', '.changeset'],
  },
  lint: {
    extends: [typescript],
    ignorePatterns: ['CHANGELOG.md', '.changeset'],
    options: {
      typeAware: true,
    },
    overrides: [{ files: [...TEST_GLOBS], ...test }],
  },
  pack: {
    entry: ['src/cli.ts'],
    format: 'esm',
    dts: false,
    outDir: 'dist',
    unbundle: true,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    // Most suites drive a real Chromium.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
  staged: {
    '*.{js,ts,cjs,mjs,jsx,tsx,json,jsonc}': 'vp check --fix',
  },
});
