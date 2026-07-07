import path from 'path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '~': path.resolve(__dirname, './src'),
      '@jdm/shared/legal': path.resolve(__dirname, '../../packages/shared/src/legal.ts'),
    },
  },
  // Match Next.js so component files that omit `import React` still compile in
  // vitest. Without this, esbuild emits classic `React.createElement` calls and
  // any source file that doesn't import React explicitly blows up at render.
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    globals: false,
    environment: 'node',
    passWithNoTests: true,
  },
});
