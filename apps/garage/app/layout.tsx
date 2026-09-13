import type { Metadata } from 'next';

import './globals.css';

import { brand } from '~/brand';

export const metadata: Metadata = {
  title: brand.name,
  description: brand.tagline,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        {/* Fixed mobile-width column. The page is a phone screen ported to the
            web: the cover bleeds edge to edge and the identity card sits on a
            4-unit margin, both of which stretch into nonsense on a desktop
            viewport. Constraining here rather than inside PublicGarageView
            also catches not-found.tsx, and keeps the cover bleeding to the
            column edge instead of the window edge. Below 430px the column is
            simply full width, so phones are unaffected. */}
        <div className="mx-auto w-full max-w-[430px] min-h-screen bg-bg shadow-2xl">{children}</div>
      </body>
    </html>
  );
}
