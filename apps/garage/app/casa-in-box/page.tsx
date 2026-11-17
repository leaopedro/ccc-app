import { notFound } from 'next/navigation';

import { CasaInBoxCheckout } from '~/components/presale/CasaInBoxCheckout';
import { Faq } from '~/components/presale/Faq';
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
      <Faq campaign={campaign} />
    </main>
  );
}

// O FAQ (achado P1 do page-findings.md) vem DEPOIS de CasaInBoxCheckout, ou
// seja, depois do botão de pagar. Ele morava dentro do checkout, entre o
// consentimento e o seletor de meio de pagamento — uma interrupção
// editorial no meio do fluxo de compra. O fluxo agora corre de ponta a
// ponta (tiers -> recebimento -> dados -> consentimento -> pagamento ->
// botão de pagar) sem nada no meio; o FAQ fica fora, no fim da página.
