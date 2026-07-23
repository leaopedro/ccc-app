import { withSentryConfig } from '@sentry/nextjs';

const securityHeaders = [
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-XSS-Protection', value: '0' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=()',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
];

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  transpilePackages: ['@jdm/design', '@jdm/shared', '@jdm/ui'],
  env: {
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000',
  },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
  // Shared packages use NodeNext-style `./foo.js` imports in `.ts` source so the
  // API's NodeNext typecheck can resolve them. Teach webpack to fall back to
  // `.ts`/`.tsx` for those specifiers. Turbopack has no equivalent hook yet, so
  // `scripts.build` opts into `next build --webpack`.
  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      ...(webpackConfig.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return webpackConfig;
  },
};

export default withSentryConfig(config, {
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT_ADMIN,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  disableLogger: true,
});
