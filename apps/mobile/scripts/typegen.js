#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const requireContext =
  require('expo-router/build/testing-library/require-context-ponyfill').default;
const { getTypedRoutesDeclarationFile } = require('expo-router/build/typed-routes/generate');

const appDir = path.resolve(__dirname, '..', 'app');
const outDir = path.resolve(__dirname, '..', '.expo', 'types');
const outFile = path.join(outDir, 'router.d.ts');

const ctx = requireContext(appDir, true, /\.[tj]sx?$/);

const content = getTypedRoutesDeclarationFile(ctx);

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, content);

console.log(`Wrote typed routes to ${outFile}`);
