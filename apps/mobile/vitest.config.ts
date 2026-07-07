import path from 'path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '~': path.resolve(__dirname, 'src'),
      // `lucide-react-native` ships ESM that vitest can't transform under
      // jsdom. Once `BadgeGlyph` joined `@jdm/ui`'s barrel export, every
      // mobile test that pulls anything from `@jdm/ui` started loading
      // lucide transitively. The stub returns a Proxy-of-forwardRef so
      // the catalog can grow without revisiting this alias.
      'lucide-react-native': path.resolve(__dirname, 'test-stubs/lucide-react-native.tsx'),
    },
  },
  // Test-only override: tsconfig sets jsx="react-native" for the Metro build,
  // which esbuild treats as classic and requires React in scope. We do not
  // import React in component files. Use the automatic runtime for vitest so
  // JSX compiles without a React import. Expo runtime is unaffected (babel).
  esbuild: { jsx: 'automatic' },
  test: {
    deps: {
      external: ['expo-media-library', 'react-native-view-shot'],
    },
  },
});
