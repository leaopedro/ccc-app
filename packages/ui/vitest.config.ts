import path from 'path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Mirrors apps/mobile/vitest.config.ts: lucide-react-native ESM
      // can't be transformed under jsdom; redirect to local stub.
      'lucide-react-native': path.resolve(__dirname, 'test-stubs/lucide-react-native.tsx'),
    },
  },
  // Same reason as mobile: tsconfig sets jsx="react-native" for Metro,
  // which esbuild treats as classic. Use the automatic runtime in tests.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: [],
  },
});
