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
      <body>{children}</body>
    </html>
  );
}
