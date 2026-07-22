// Subscription plans + optional add-on modules.
//
// Hardcoded for the first delivery (screen only). Structured so the source can
// later be swapped for the subscriptions API / config without touching the UI:
// keep this the single shape the screen renders, and have the API map onto it.
//
// Add-on modules are modeled from day one so the future "add during checkout /
// manage in Minha Assinatura" flow does not require reshaping plans.

export type PlanTier = 'bronze' | 'prata' | 'ouro';

export type Plan = {
  tier: PlanTier;
  /** Uppercase tier label shown on the card (BRONZE / PRATA / OURO). */
  tierLabel: string;
  /** Plan display name (Ingresso / Estrada / Fundador). */
  name: string;
  /** Monthly price in cents — source of truth for future checkout math. */
  priceCents: number;
  /** Pre-formatted BR price label as designed (e.g. "R$490", "R$1.490"). */
  priceLabel: string;
  /** Tier accent color (dot, tier label, benefit checks, outline CTA text). */
  accent: string;
  /** Highlighted "RECOMENDADO" tier — drives the gold card treatment. */
  recommended: boolean;
  benefits: string[];
};

export type AddonModuleKey = 'detailing' | 'oficina';

export type AddonModule = {
  key: AddonModuleKey;
  name: string;
  description: string;
  /** Monthly surcharge in cents. */
  monthlyDeltaCents: number;
  /** Pre-formatted surcharge label as designed (e.g. "+R$150"). */
  priceLabel: string;
  /** lucide-react-native icon name mapping (resolved in the screen). */
  icon: AddonModuleKey;
};

export const PLANS: Plan[] = [
  {
    tier: 'bronze',
    tierLabel: 'BRONZE',
    name: 'Ingresso',
    priceCents: 49000,
    priceLabel: 'R$490',
    accent: '#C08A4E',
    recommended: false,
    benefits: [
      'Acesso ao clube em horário comercial',
      'Eventos abertos da comunidade',
      'Comunidade no app',
    ],
  },
  {
    tier: 'prata',
    tierLabel: 'PRATA',
    name: 'Estrada',
    priceCents: 89000,
    priceLabel: 'R$890',
    accent: '#C7CCD1',
    recommended: false,
    benefits: [
      'Tudo do Bronze',
      'Prioridade em eventos exclusivos',
      '1 convidado por evento',
      'Descontos com parceiros',
    ],
  },
  {
    tier: 'ouro',
    tierLabel: 'OURO',
    name: 'Fundador',
    priceCents: 149000,
    priceLabel: 'R$1.490',
    accent: '#E8CE86',
    recommended: true,
    benefits: [
      'Tudo da Prata',
      'Acesso ao clube 24 horas',
      'Até 3 convidados por evento',
      'Concierge dedicado',
      'Vaga premium na garagem',
    ],
  },
];

export const ADDON_MODULES: AddonModule[] = [
  {
    key: 'detailing',
    name: 'Detailing',
    description: '3 acessos/mês para lavagem & detailing',
    monthlyDeltaCents: 15000,
    priceLabel: '+R$150',
    icon: 'detailing',
  },
  {
    key: 'oficina',
    name: 'Oficina',
    description: '5 horas de oficina por mês',
    monthlyDeltaCents: 50000,
    priceLabel: '+R$500',
    icon: 'oficina',
  },
];
