// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const noStripeOnIos = require('./eslint-rules/no-stripe-on-ios.cjs');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'scripts/*', '.expo/*', 'app.config.ts', 'tailwind.config.js'],
  },
  // Canon §F8.16 — iOS bundle isolation: forbid Stripe tokens in mobile source.
  // Scope covers `src/**` AND the Expo Router `app/**` tree so the rule can
  // catch Stripe refs in screens + the root layout. The fixture test
  // (`ios-stripe-isolation.test.ts`) intentionally embeds the forbidden
  // tokens as test inputs — exempt the test file itself so the rule can be
  // exercised. Runtime fixtures written to src/.lint-fixtures/ during the
  // test ARE linted (that's the whole point of the test).
  {
    files: ['src/**/*.ts', 'src/**/*.tsx', 'app/**/*.ts', 'app/**/*.tsx'],
    ignores: ['**/ios-stripe-isolation.test.ts'],
    plugins: { 'jdm-mobile': { rules: { 'no-stripe-on-ios': noStripeOnIos } } },
    rules: { 'jdm-mobile/no-stripe-on-ios': 'error' },
  },
]);
