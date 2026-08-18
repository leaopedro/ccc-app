const { getDefaultConfig } = require('expo/metro-config');
const { getSentryExpoConfig } = require('@sentry/react-native/metro');
const { withNativeWind } = require('nativewind/metro');
const path = require('node:path');
const fs = require('node:fs');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getSentryExpoConfig(projectRoot, { getDefaultConfig });
// Watch only the workspace dirs Mobile actually consumes. Pointing watchFolders
// at the full repo root makes metro-file-map crawl every `.claude/worktrees/*`
// node_modules tree and overflow the JS max string length on machines with many
// active worktrees (`RangeError: Invalid string length`). CI has no worktrees,
// so the symptom is local-only — but the narrower list is correct everywhere.
config.watchFolders = [
  path.resolve(workspaceRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'packages'),
];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Force a single physical react / react-dom across the bundle. With pnpm,
// the install can surface react at more than one absolute path (hoisted root
// copy plus a `.pnpm/...react...` peer-resolved copy). Metro keys modules by
// absolute path, so the same react@19.1.0 gets bundled twice on Vercel. The
// second copy never has a render dispatcher set, so any hook destructured at
// module init (e.g. `var useRef = React.useRef` inside use-sync-external-
// store) throws `Cannot read properties of null (reading 'useRef')` from
// inside @react-navigation/elements `Screen` → `useFrameSize`. Verified by
// counting `react.production` markers in the deployed (2) vs local (1) bundle.
const singletonRoots = {
  react: path.resolve(workspaceRoot, 'node_modules/react'),
  'react-dom': path.resolve(workspaceRoot, 'node_modules/react-dom'),
};

// Shared packages use NodeNext-style `.js` imports in `.ts` source. Strip the
// extension so Metro resolves the TypeScript file.
const defaultResolve = config.resolver.resolveRequest;
const stripeWebStub = path.resolve(projectRoot, 'src/stripe/web-stub.tsx');
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Stripe RN is native-only. On web, alias every path under the package to
  // a stub so the bundle doesn't try to import codegenNativeCommands. Payment
  // hooks return a graceful error on web; the rest of the app renders normally.
  if (
    platform === 'web' &&
    (moduleName === '@stripe/stripe-react-native' ||
      moduleName.startsWith('@stripe/stripe-react-native/'))
  ) {
    return { type: 'sourceFile', filePath: stripeWebStub };
  }
  for (const [pkg, root] of Object.entries(singletonRoots)) {
    if (moduleName === pkg || moduleName.startsWith(pkg + '/')) {
      const fakeOrigin = path.join(root, '__resolve__.js');
      const fakeContext = { ...context, originModulePath: fakeOrigin };
      return defaultResolve
        ? defaultResolve(fakeContext, moduleName, platform)
        : context.resolveRequest(fakeContext, moduleName, platform);
    }
  }
  // @ccc/shared subpath exports point to dist/*.js, which is gitignored and
  // must be built before Metro starts. Fall back to the src TypeScript file
  // when the dist artifact is absent so local dev works without a pre-build.
  if (moduleName.startsWith('@ccc/shared/')) {
    const subpath = moduleName.slice('@ccc/shared/'.length);
    const distFile = path.join(workspaceRoot, 'packages/shared/dist', subpath + '.js');
    const srcFile = path.join(workspaceRoot, 'packages/shared/src', subpath + '.ts');
    if (!fs.existsSync(distFile) && fs.existsSync(srcFile)) {
      return { type: 'sourceFile', filePath: srcFile };
    }
  }
  // Strip only when the `.js` path itself does not resolve. Stripping first also
  // rewrote genuine relative `.js` imports inside node_modules, and web
  // sourceExts try `.mjs` before `.js`: `merge-options/index.mjs` importing
  // `./index.js` resolved back to index.mjs, i.e. itself. That circular
  // self-import left the default export undefined, so async-storage's web path
  // threw `Cannot read properties of undefined (reading 'bind')`.
  if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    const inner = (ctx, name, plat) =>
      defaultResolve ? defaultResolve(ctx, name, plat) : ctx.resolveRequest(ctx, name, plat);
    try {
      return inner(context, moduleName, platform);
    } catch {
      return inner(context, moduleName.slice(0, -3), platform);
    }
  }
  return defaultResolve
    ? defaultResolve(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, {
  input: './global.css',
  configPath: './tailwind.config.js',
});
