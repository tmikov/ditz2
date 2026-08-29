/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Vitest transpiles with esbuild rather than tsc, so the JSX settings in
  // tsconfig.json do not reach it and have to be repeated here.
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'node',
    // Above the pty() helper's own 20s timeout in tests/e2e.test.ts, so a
    // real hang is reported as that helper's `timedOut: true` — a readable
    // assertion diff — instead of vitest's own generic 5s timeout firing
    // first and hiding it.
    testTimeout: 25_000,
  },
});
