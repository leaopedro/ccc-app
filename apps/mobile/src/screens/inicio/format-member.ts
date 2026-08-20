// MEMBRO DESDE <MES> <ANO>, derivado de user.createdAt.
//
// O handoff pede MEMBRO #0001, mas nao existe campo de numero de membro no
// banco. Decisao de produto registrada no spec: usar a data de entrada, que
// comunica pertencimento sem inventar coluna nem expor o tamanho da base.

const MONTHS_PT = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
] as const;

/**
 * Recebe um ISO 8601 e devolve `mes ano` em PT-BR abreviado, por exemplo
 * `mar 2026`. Devolve string vazia para entrada invalida, para a tela poder
 * esconder a linha em vez de mostrar `Invalid Date`.
 */
export const formatMemberSince = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${MONTHS_PT[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
};
