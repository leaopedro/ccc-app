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

vi.mock('./logout-button', () => ({
  LogoutButton: () => <button type="submit">Sair</button>,
}));

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/events'),
}));

import { AuthedNav } from './authed-nav';

describe('AuthedNav — organizer role', () => {
  it('renders top-level organizer nav links (groups excluded)', () => {
    vi.mocked(usePathname).mockReturnValue('/events');
    const html = renderToStaticMarkup(<AuthedNav isStaff={false} />);
    expect(html).toContain('href="/events"');
    expect(html).toContain('href="/loja"');
    expect(html).toContain('href="/users"');
    expect(html).toContain('href="/financeiro"');
    expect(html).toContain('href="/broadcasts"');
    expect(html).toContain('href="/support"');
    expect(html).toContain('href="/check-in"');
  });

  it('does not render /groups as a top-level nav item', () => {
    vi.mocked(usePathname).mockReturnValue('/events');
    const html = renderToStaticMarkup(<AuthedNav isStaff={false} />);
    expect(html).not.toContain('href="/groups"');
  });

  it('brand link points to /events', () => {
    vi.mocked(usePathname).mockReturnValue('/events');
    const html = renderToStaticMarkup(<AuthedNav isStaff={false} />);
    expect(html.indexOf('href="/events"')).toBeGreaterThan(-1);
  });

  it('mostra o link de Assinaturas para organizer', () => {
    const html = renderToStaticMarkup(<AuthedNav isStaff={false} />);
    expect(html).toContain('href="/assinaturas"');
    expect(html).toContain('Assinaturas');
  });

  it('nao mostra o link de Assinaturas para staff', () => {
    const html = renderToStaticMarkup(<AuthedNav isStaff={true} />);
    expect(html).not.toContain('href="/assinaturas"');
  });
});

describe('AuthedNav — staff role', () => {
  it('renders only check-in link', () => {
    vi.mocked(usePathname).mockReturnValue('/check-in');
    const html = renderToStaticMarkup(<AuthedNav isStaff={true} />);
    expect(html).toContain('href="/check-in"');
    expect(html).not.toContain('href="/events"');
    expect(html).not.toContain('href="/loja"');
    expect(html).not.toContain('href="/users"');
    expect(html).not.toContain('href="/financeiro"');
    expect(html).not.toContain('href="/broadcasts"');
    expect(html).not.toContain('href="/support"');
  });

  it('brand link points to /check-in', () => {
    vi.mocked(usePathname).mockReturnValue('/check-in');
    const html = renderToStaticMarkup(<AuthedNav isStaff={true} />);
    expect(html).toContain('href="/check-in"');
  });
});

describe('AuthedNav — hamburger button', () => {
  it('renders hamburger with aria attributes', () => {
    vi.mocked(usePathname).mockReturnValue('/events');
    const html = renderToStaticMarkup(<AuthedNav isStaff={false} />);
    expect(html).toContain('aria-label=');
    expect(html).toContain('aria-expanded="false"');
  });

  it('mobile dropdown not visible on initial server render', () => {
    vi.mocked(usePathname).mockReturnValue('/events');
    const html = renderToStaticMarkup(<AuthedNav isStaff={false} />);
    expect(html.match(/md:hidden/g) ?? []).toHaveLength(1);
  });
});

describe('AuthedNav — users sub-nav', () => {
  it('renders sub-nav when on /users path', () => {
    vi.mocked(usePathname).mockReturnValue('/users');
    const html = renderToStaticMarkup(<AuthedNav isStaff={false} />);
    expect(html).toContain('data-testid="users-subnav"');
    expect(html).toContain('href="/groups"');
  });

  it('renders sub-nav when on /users/:id path', () => {
    vi.mocked(usePathname).mockReturnValue('/users/abc123');
    const html = renderToStaticMarkup(<AuthedNav isStaff={false} />);
    expect(html).toContain('data-testid="users-subnav"');
    expect(html).toContain('href="/groups"');
  });

  it('renders sub-nav when on /groups path', () => {
    vi.mocked(usePathname).mockReturnValue('/groups');
    const html = renderToStaticMarkup(<AuthedNav isStaff={false} />);
    expect(html).toContain('data-testid="users-subnav"');
    expect(html).toContain('href="/users"');
  });

  it('renders sub-nav when on /groups/:id path', () => {
    vi.mocked(usePathname).mockReturnValue('/groups/abc123');
    const html = renderToStaticMarkup(<AuthedNav isStaff={false} />);
    expect(html).toContain('data-testid="users-subnav"');
  });

  it('does not render sub-nav when on /events path', () => {
    vi.mocked(usePathname).mockReturnValue('/events');
    const html = renderToStaticMarkup(<AuthedNav isStaff={false} />);
    expect(html).not.toContain('data-testid="users-subnav"');
  });

  it('does not render sub-nav for staff even on /users path', () => {
    vi.mocked(usePathname).mockReturnValue('/users');
    const html = renderToStaticMarkup(<AuthedNav isStaff={true} />);
    expect(html).not.toContain('data-testid="users-subnav"');
  });
});
