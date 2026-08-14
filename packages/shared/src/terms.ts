import type { PolicySection } from './legal.js';

/**
 * Version stamped on User.termsAcceptedVersion when someone accepts. Bump it
 * whenever the text below changes materially, so the DB records WHICH text each
 * person agreed to. Without that, the signup checkbox is decorative.
 */
export const TERMS_VERSION = 'terms-2026-08-13' as const;

/**
 * Termos de uso vigentes. Revisados juridicamente antes da publicação
 * (confirmado pelo fundador em 2026-08-14).
 *
 * Cobre assinatura, ingresso de evento e loja, porque os três vendem por
 * canais diferentes com regras de cancelamento diferentes. A política de
 * reembolso vive aqui dentro, em seção própria, em vez de documento separado:
 * link separado dobra manutenção e some da vista no fechamento da compra.
 *
 * Este arquivo é a fonte canônica. A tela `app/(auth)/termos.tsx`, a página
 * pública em `apps/admin/app/(public)/termos` e o site consomem daqui, então
 * qualquer mudança de cláusula passa por revisão jurídica e sobe TERMS_VERSION,
 * que é o que fica gravado em User.termsVersion no aceite.
 */
export const termsSections: PolicySection[] = [
  {
    id: 'aceite',
    title: '1. Aceite destes termos',
    body: `Ao criar uma conta no Casa Car Club, você declara ter lido e aceito estes Termos de Uso.

Registramos a data do aceite e a versão do texto vigente naquele momento. Se mudarmos algo relevante, avisamos e pedimos novo aceite; você continua vinculado à versão que aceitou até então.

Se não concordar com algum ponto, não crie conta. Se já tiver conta e deixar de concordar, você pode encerrá-la a qualquer momento pelo próprio app, em Perfil e Privacidade.`,
  },
  {
    id: 'quem-somos',
    title: '2. Quem somos',
    body: `A **Casa Car Club** organiza eventos automotivos e mantém um clubhouse privado em Curitiba.

- **Razão social:** a ser publicado antes do lançamento em produção
- **CNPJ:** a ser publicado antes do lançamento em produção
- **Endereço:** a ser publicado antes do lançamento em produção
- **E-mail:** contato@casacar.club

Estes termos são regidos pela lei brasileira.`,
  },
  {
    id: 'quem-pode-usar',
    title: '3. Quem pode usar',
    body: `Você precisa ter 18 anos ou mais. Declaramos isso no cadastro e você confirma no aceite.

A conta é pessoal e não transferível. Você responde pelo que acontece nela, então não compartilhe sua senha.`,
  },
  {
    id: 'o-que-vendemos',
    title: '4. O que vendemos',
    body: `Três coisas distintas, com regras próprias:

- **Ingresso de evento.** Acesso a um evento presencial, em data e local determinados.
- **Produtos da loja.** Itens físicos, enviados ou retirados presencialmente.
- **Assinatura do clube.** Plano mensal recorrente que inclui benefícios físicos, como caixa mensal enviada ao membro e serviços prestados por fornecedores parceiros, além de acesso ao espaço e a eventos.

Os preços exibidos no app são finais para o consumidor, em reais.`,
  },
  {
    id: 'pagamento',
    title: '5. Pagamento',
    body: `Aceitamos cartão, processado pela **Stripe**, e Pix, processado pela **AbacatePay**. Não armazenamos dados de cartão.

Sua compra só é confirmada quando o provedor de pagamento nos confirma o pagamento. Até isso acontecer, o pedido fica pendente e a reserva pode expirar.

A assinatura é cobrada automaticamente a cada ciclo, no mesmo meio de pagamento, até que você cancele.`,
  },
  {
    id: 'arrependimento',
    title: '6. Direito de arrependimento — 7 dias',
    body: `Como a compra é feita fora de loja física, você tem **7 dias corridos**, contados da compra ou do recebimento do produto, para desistir sem precisar justificar. É o direito previsto no Art. 49 do Código de Defesa do Consumidor.

Para exercer, fale com a gente em contato@casacar.club dentro do prazo. Devolvemos o valor pago integralmente, pelo mesmo meio de pagamento.

Uma ressalva importante e específica de ingresso: se você **já usou** o ingresso, entrando no evento, o serviço foi prestado e o arrependimento não se aplica àquele ingresso.`,
  },
  {
    id: 'reembolso',
    title: '7. Cancelamento e reembolso',
    body: `**Ingresso de evento.** Dentro dos 7 dias de arrependimento, reembolso integral. Depois disso, e até 48 horas antes do início do evento, reembolsamos integralmente mediante pedido. Nas 48 horas finais não há reembolso, porque a operação do evento já está fechada com fornecedores. Se **nós** cancelarmos ou adiarmos o evento, você recebe o valor integral de volta, independente de prazo.

**Produtos da loja.** Dentro dos 7 dias, reembolso integral; se o item já foi enviado, ele precisa voltar em condições de revenda. Produto com defeito segue as regras de vício do CDC, com prazo de 30 dias para bem não durável e 90 dias para durável.

**Assinatura.** Você cancela quando quiser, pelo app ou pelo portal de cobrança. O cancelamento vale para o fim do ciclo já pago: você mantém os benefícios até lá e não é cobrado no ciclo seguinte. Não fazemos reembolso proporcional de ciclo em andamento, exceto nos 7 dias de arrependimento do primeiro pagamento.

Um ponto sobre a caixa mensal: se a caixa do ciclo já foi enviada, o valor dela não é reembolsado no cancelamento, porque o bem já foi entregue.

Reembolso aparece na sua fatura conforme o prazo do seu banco ou emissor, normalmente até duas faturas.`,
  },
  {
    id: 'assinatura-detalhes',
    title: '8. Detalhes da assinatura',
    body: `A cobrança é mensal e automática. Avisamos antes de qualquer aumento de preço, e você pode cancelar antes que ele valha.

Se um pagamento falhar, tentamos novamente. Enquanto estiver em atraso, benefícios podem ficar suspensos. Se não regularizar, a assinatura expira.

Benefícios que dependem de agenda, como serviços de fornecedores e acesso ao espaço, seguem horários e disponibilidade divulgados no app. Não garantimos disponibilidade imediata em qualquer data.`,
  },
  {
    id: 'conteudo',
    title: '9. Conteúdo que você publica',
    body: `Você pode publicar fotos, textos e comentários. O conteúdo continua seu, e você nos dá permissão para exibi-lo no app e nas páginas públicas do clube.

Você é responsável pelo que publica. Não é permitido conteúdo ilegal, que ofenda ou assedie alguém, que exponha dados de terceiros sem consentimento, ou que não seja seu.

Qualquer pessoa pode denunciar conteúdo pelo próprio app, e qualquer pessoa pode bloquear outra. Conteúdo denunciado por várias pessoas fica oculto automaticamente até revisão humana. Podemos remover conteúdo e suspender contas que violem estas regras, e agimos em até 24 horas sobre denúncias de conteúdo ofensivo.`,
  },
  {
    id: 'regras-do-espaco',
    title: '10. Regras do espaço e dos eventos',
    body: `No clubhouse e nos eventos valem as regras de convivência e segurança divulgadas no local. Podemos recusar entrada ou pedir que alguém se retire em caso de risco à segurança, embriaguez, direção perigosa ou desrespeito a outras pessoas.

Você é responsável pelo seu veículo e pelos seus pertences. Não somos depositários deles.`,
  },
  {
    id: 'responsabilidade',
    title: '11. Limites de responsabilidade',
    body: `Fazemos o possível para manter o app disponível, mas ele pode ficar fora do ar por manutenção ou falha de terceiros.

Não respondemos por serviços prestados por fornecedores parceiros além do que a lei nos atribui como intermediários, nem por prejuízo indireto. Nada aqui afasta direitos que o Código de Defesa do Consumidor garante a você.`,
  },
  {
    id: 'privacidade',
    title: '12. Privacidade',
    body: `O tratamento dos seus dados pessoais está descrito na nossa Política de Privacidade, que faz parte destes termos.`,
  },
  {
    id: 'mudancas',
    title: '13. Mudanças nestes termos',
    body: `Podemos atualizar estes termos. Mudança relevante é avisada no app e pede novo aceite. A versão vigente e sua data ficam sempre publicadas aqui.

**Versão atual:** ${TERMS_VERSION}`,
  },
  {
    id: 'contato',
    title: '14. Contato',
    body: `Dúvida, reclamação, pedido de reembolso ou exercício de arrependimento: **contato@casacar.club**.

Assuntos de privacidade e dados pessoais: **privacidade@casacar.club**.`,
  },
];
