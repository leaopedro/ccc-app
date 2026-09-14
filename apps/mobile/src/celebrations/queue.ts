import type { BadgeCatalogEntry, GarageBadgePublic } from '@ccc/shared/badges';
import type { BadgeCelebrationEntry } from '@ccc/ui';

export type BundledCopy = Record<string, { title: string; description: string } | undefined>;

export type ResolveResult = {
  /** O que vai animar, na ordem em que veio do servidor. */
  entries: BadgeCelebrationEntry[];
  /** Códigos a carimbar SEM animar. Só sai não vazio com catálogo carregado. */
  ackOnly: string[];
  /** `false` quando o catálogo não deu para carregar. Nada pode ser acked. */
  resolvable: boolean;
};

/**
 * Junta a fila pendente com o catálogo e com a copy do bundle.
 *
 * A regra load-bearing é a de `resolvable`. Uma versão anterior do desenho
 * dizia "se não resolve o código, faz ack e não anima", justificada por
 * "código removido do catálogo". Esse estado é impossível: a FK de
 * `GarageBadge.badgeCode` é `onDelete: Restrict` e a migration de prune se
 * recusa a apagar `Badge` com dono. O único jeito real de um código não
 * resolver é o fetch do catálogo falhar, ou o killswitch virar entre as duas
 * chamadas. Fazer ack nesse caso queima a fila inteira, para sempre, por causa
 * de uma requisição ruim.
 */
export const resolveEntries = (
  pending: GarageBadgePublic[],
  catalog: BadgeCatalogEntry[] | null,
  bundled: BundledCopy,
): ResolveResult => {
  // Catálogo ausente ou vazio: dá para não animar, mas NUNCA para fazer ack.
  if (catalog === null || catalog.length === 0) {
    return { entries: [], ackOnly: [], resolvable: false };
  }

  const byCode = new Map(catalog.map((c) => [c.code, c]));
  const entries: BadgeCelebrationEntry[] = [];
  const ackOnly: string[] = [];

  for (const p of pending) {
    const cat = byCode.get(p.code);
    if (!cat) {
      // Ausente de um catálogo que carregou. Único caso em que o ack sem
      // animação é correto, e existe só para a fila não travar no topo dos 10.
      ackOnly.push(p.code);
      continue;
    }
    // `title`/`description` são opcionais no wire de propósito
    // (`packages/shared/src/badges.ts:23-31`): app novo contra API velha não
    // recebe os campos e usa a copy embutida em vez de estourar no parse.
    const fallback = bundled[p.code];
    const title = cat.title ?? fallback?.title;
    const description = cat.description ?? fallback?.description;
    if (!title) {
      ackOnly.push(p.code);
      continue;
    }
    entries.push({
      code: p.code,
      title,
      description: description ?? '',
      rarity: cat.rarity,
      icon: cat.icon,
    });
  }

  return { entries, ackOnly, resolvable: true };
};
