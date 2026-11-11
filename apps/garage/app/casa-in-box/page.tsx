import { notFound } from 'next/navigation';

import { CasaInBoxCheckout } from '~/components/presale/CasaInBoxCheckout';
import { Hero } from '~/components/presale/Hero';
import { Steps } from '~/components/presale/Steps';
import { fetchPresaleCampaign, fetchPresaleProducts } from '~/lib/presale-api';

// Fora do route group (garage): aquele grupo fixa uma coluna de 430px
// (app/(garage)/layout.tsx) pensada para o perfil de garagem portado do app.
// Esta é a página que vende a pré-venda — precisa da largura cheia do
// viewport, que é o motivo de a Task 12 ter criado o grupo (garage) em
// primeiro lugar (ver task-12-report.md). Mesma razão de app/not-found.tsx e
// das páginas (legal).
export default async function CasaInBoxPage() {
  const campaign = await fetchPresaleCampaign();
  if (!campaign.enabled) notFound();

  const { items: products } = await fetchPresaleProducts();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-16 px-6 py-12">
      <Hero campaign={campaign} />
      <Steps />
      <CasaInBoxCheckout campaign={campaign} products={products} />
    </main>
  );
}

// O FAQ (item 6 do brief) é renderizado dentro de CasaInBoxCheckout, entre o
// formulário de recebimento (item 5, com o checkbox de consentimento) e o
// botão de pagar (item 7) — essa é a ordem pedida pelo brief amendado.
