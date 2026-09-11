import { usePathname } from 'next/navigation';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...(rest as object)}>
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/configuracoes'),
}));

import { SettingsTabs } from './settings-tabs';

describe('SettingsTabs — admin role', () => {
  it('renders the Conquistas tab for admin', () => {
    vi.mocked(usePathname).mockReturnValue('/configuracoes');
    const html = renderToStaticMarkup(<SettingsTabs isAdmin={true} />);
    expect(html).toContain('href="/configuracoes/conquistas"');
    expect(html).toContain('Conquistas');
  });
});

describe('SettingsTabs — non-admin role', () => {
  it('does not render the Conquistas tab for organizer', () => {
    vi.mocked(usePathname).mockReturnValue('/configuracoes');
    const html = renderToStaticMarkup(<SettingsTabs isAdmin={false} />);
    expect(html).not.toContain('href="/configuracoes/conquistas"');
    expect(html).not.toContain('Conquistas');
  });

  it('still renders the Gerais and Home tabs', () => {
    vi.mocked(usePathname).mockReturnValue('/configuracoes');
    const html = renderToStaticMarkup(<SettingsTabs isAdmin={false} />);
    expect(html).toContain('href="/configuracoes"');
    expect(html).toContain('href="/configuracoes/home"');
  });
});
