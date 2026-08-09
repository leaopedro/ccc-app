import { describe, expect, it, vi } from 'vitest';

/**
 * Esta rota so existe para nao quebrar link salvo ou favorito de
 * /financeiro/membros. O que importa e o destino: /assinaturas com os mesmos
 * filtros. Perder a query aqui joga o admin numa lista sem filtro nenhum.
 *
 * redirect() lanca NEXT_REDIRECT no Next, entao o mock tambem lanca — a page
 * nunca retorna normalmente.
 */
const redirectMock = vi.fn<(url: string) => never>((url) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock('next/navigation', () => ({ redirect: redirectMock }));

const Page = (await import('../page')).default;

const destinoDe = async (
  searchParams: Record<string, string | string[] | undefined>,
): Promise<string> => {
  redirectMock.mockClear();
  await expect(Page({ searchParams: Promise.resolve(searchParams) })).rejects.toThrow(
    'NEXT_REDIRECT',
  );
  expect(redirectMock).toHaveBeenCalledTimes(1);
  return redirectMock.mock.calls[0]![0];
};

describe('/financeiro/membros redireciona para /assinaturas', () => {
  it('sem filtro, vai para a lista limpa', async () => {
    expect(await destinoDe({})).toBe('/assinaturas');
  });

  it('preserva o filtro que estava no link antigo', async () => {
    expect(await destinoDe({ status: 'active' })).toBe('/assinaturas?status=active');
  });

  it('preserva varios filtros de uma vez', async () => {
    expect(await destinoDe({ status: 'active', tier: 'gold', q: 'ana' })).toBe(
      '/assinaturas?status=active&tier=gold&q=ana',
    );
  });

  it('escapa valor com caractere especial', async () => {
    expect(await destinoDe({ q: 'ana silva' })).toBe('/assinaturas?q=ana+silva');
  });

  it('descarta valor vazio e valor repetido, caindo na lista limpa', async () => {
    expect(await destinoDe({ status: '', tier: ['gold', 'silver'] })).toBe('/assinaturas');
  });
});
