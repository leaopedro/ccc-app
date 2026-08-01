import { brand } from '~/brand';

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <main>{children}</main>
      <footer className="border-t border-[color:var(--color-border)] py-6 text-center text-xs text-[color:var(--color-muted)]">
        {brand.name} · Encarregado de Dados:{' '}
        <a
          href={`mailto:${brand.contact.privacyEmail}`}
          className="underline hover:text-[color:var(--color-foreground)]"
        >
          {brand.contact.privacyEmail}
        </a>{' '}
        ·{' '}
        <a href="/privacidade" className="underline hover:text-[color:var(--color-foreground)]">
          Política de privacidade
        </a>
      </footer>
    </div>
  );
}
