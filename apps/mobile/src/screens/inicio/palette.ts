// Paleta da tela de Início, derivada dos tokens de @ccc/design.
//
// Existe para o mesmo motivo de src/screens/assinaturas/tier-visual.ts: os
// componentes usam StyleSheet, não classes NativeWind, então precisam dos hex
// em runtime. A fonte da verdade é packages/design/src/tokens.ts; aqui só se
// dá nome curto ao que a tela usa.

import { color } from '@ccc/design';

export const p = {
  bg: color.bg,
  surface: color.surfaceGold,
  cream: color.textPrimary,
  gold: color.brand,
  goldDeep: color.goldDeep,
  goldLight: color.goldLight,
  hairline: color.hairlineGold,
  hairlineStrong: color.hairlineGoldStrong,
  muted60: 'rgba(242,232,216,0.6)',
  muted50: 'rgba(242,232,216,0.5)',
  muted45: 'rgba(242,232,216,0.45)',
  // FeatureCard: 60% stop do gradiente radial do handoff, achatado em solido.
  featureSurface: '#100e09',
  // HeroSection: aro do bloco de 210px, um valor unico do handoff, deliberadamente
  // distinto de hairline (.14) e hairlineStrong (.28).
  heroBorder: 'rgba(212,175,55,0.16)',
  // HeroSection: os tres stops do degrade vertical do handoff sobre a foto do
  // hero, do mais transparente (topo) ao mais opaco (base).
  scrimTop: 'rgba(10,10,10,0.15)',
  scrimMid: 'rgba(10,10,10,0.35)',
  scrimBottom: 'rgba(10,10,10,0.86)',
} as const;
