import { presaleCopy } from '~/copy/presale';

/** Seção 2 da página (Task 14): os passos explicando a compra. */
export function Steps() {
  const copy = presaleCopy.steps;

  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold text-fg">{copy.title}</h2>
      <ol className="grid gap-4 sm:grid-cols-3">
        {copy.items.map((item, index) => (
          <li
            key={item.title}
            className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4"
          >
            <span className="font-mono text-xs text-accent">
              {String(index + 1).padStart(2, '0')}
            </span>
            <h3 className="text-sm font-semibold text-fg">{item.title}</h3>
            <p className="text-sm text-fg-secondary">{item.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
