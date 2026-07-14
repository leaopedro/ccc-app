import { brand } from '~/brand';
import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: `${brand.name} · Admin`,
  description: `Organizer console for ${brand.name}`,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
