import { expect, test } from 'vite-plus/test';

import { hello } from '../src/index.ts';

test('hello greets by name', () => {
  expect(hello('world')).toBe('Hello, world!');
});
