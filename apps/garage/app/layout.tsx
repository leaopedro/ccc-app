import type { Metadata } from 'next';
import { Inter, JetBrains_Mono, Jost } from 'next/font/google';

import './globals.css';

import { brand } from '~/brand';

/* The mobile app renders the garage in Jost 300 (the big XP number), Inter
   (body + bold labels) and JetBrains Mono (every uppercase micro-label).
   Without these the web fell back to the system sans + ui-monospace stack,
   which is the single biggest reason the page did not read as the app.
   Weights are pinned to the ones the RN styles actually ask for. */
const jost = Jost({ subsets: ['latin'], weight: ['300'], variable: '--font-jost' });
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  variable: '--font-inter',
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-jetbrains-mono',
});

export const metadata: Metadata = {
  title: brand.name,
  description: brand.tagline,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${jost.variable} ${inter.variable} ${jetbrainsMono.variable}`}>
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
