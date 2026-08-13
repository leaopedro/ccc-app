# Bloqueadores da primeira submissão iOS

**Data:** 2026-08-12
**Status:** aprovado, aguardando plano de implementação
**Bloqueia:** `2026-08-12-apple-pay-ios-design.md`

## Por que este documento existe

O app está só em TestFlight e nunca passou por App Review completo. A revisão
adversarial encontrou bloqueadores que **não têm relação com pagamento**.
Estimativa de rejeição da primeira submissão só por estes itens: 75 a 90 por
cento.

Nenhum deles é resolvido pelo trabalho de Apple Pay. Todos travam a submissão
com ou sem pagamento no app. Por isso vêm antes.

## 1.2 — Conteúdo gerado por usuário sem controles

O app tem feed completo: posts, fotos, comentários e reações
(`packages/db/prisma/schema.prisma:1678,1704,1718,1741`;
`apps/api/src/routes/feed.ts:261,509,599`).

A Apple exige cinco coisas para UGC: filtro, denúncia, bloquear usuário, agir em
24 horas, e contato publicado. Faltam duas no cliente, e são as mais visíveis.

**Denúncia não existe para o usuário.** O modelo `Report` existe
(`schema.prisma:1756`), mas toda chamada `prisma.report.*` na API é leitura ou
update dentro de `routes/admin/feed-moderation.ts:109,143,153,173,183`. Não há
`.create()` em lugar nenhum. A tabela é vazia por construção.

**Bloquear usuário não existe.** `FeedBan` é aplicado pelo admin e tem escopo de
evento (`feed-moderation.ts:226`). Não há bloqueio de pessoa por pessoa.

**Não há EULA.** `apps/mobile/app/(auth)/signup.tsx:317-319` renderiza "Termos"
como `<Text>` puro, sem `onPress` e sem `accessibilityRole`, enquanto o link da
política ao lado navega. Não existe documento, rota, nem versão de aceite
armazenada. `packages/shared/src/legal.ts` exporta só privacidade.

**Correção:** endpoint e UI de denúncia criando `Report`, bloqueio entre
usuários com filtragem no feed, documento de termos publicado com aceite
versionado no `User`, e o link do signup navegando para ele.

## 5.1.1 — Strings de permissão para funcionalidades inexistentes

`apps/mobile/ios/CasaCarClubDev/Info.plist:62-67` embarca
`NSCameraUsageDescription`, `NSMicrophoneUsageDescription` e
`NSFaceIDUsageDescription`, todas em inglês genérico, num app em PT-BR.

Vêm por autolink de `expo-image-picker` e `expo-secure-store`
(`app.config.ts:109`, sem options). O app não tem câmera, microfone nem
biometria: não existe `launchCameraAsync`, `expo-camera` nem
`expo-local-authentication` no repositório.

As duas strings escritas de propósito (`app.config.ts:93-97`) estão corretas e
em PT-BR.

**Correção:** configurar options dos plugins para suprimir as três strings, ou
substituí-las por texto PT-BR verdadeiro caso a funcionalidade venha a existir.
Correção trivial, rejeição comum.

## 5.1.2 — Manifesto de privacidade vazio

`apps/mobile/ios/CasaCarClubDev/PrivacyInfo.xcprivacy:44` declara
`NSPrivacyCollectedDataTypes` como array vazio, enquanto o app coleta email,
telefone, CPF, fotos, documento de identidade e histórico de compras.

**Correção:** preencher o manifesto com os tipos reais.

## 2.1 — Revisor não consegue entrar, e encontra placeholder

**Sem conta de demonstração.** Não existe seed de conta de revisor, e
`apps/mobile/app/_layout.tsx:84-93` redireciona usuário não verificado para
`/verify-email-pending`. Revisor que se cadastra sozinho trava no muro de email.

**Sem URL pública da política de privacidade.** A política existe só como JS
empacotado (`packages/shared/src/legal.ts:9`, renderizada em
`app/(auth)/privacidade.tsx`). `brand.urls`
(`packages/design/src/brand.ts:66-70`) não tem URL de privacidade nem de termos.
App Store Connect exige uma HTTPS pública.

**Copy de "em breve" em aba primária.** Com a flag desligada,
`MinhaAssinaturaScreen` mostra `'Assinaturas em breve.'`
(`apps/mobile/src/copy/assinaturas.ts:89`) e `PremiumScreen` mostra
`'Premium em breve'` (`PremiumScreen.tsx:83`). A aba em si é incondicional
(`app/(app)/_layout.tsx:66-70`).

**Correção:** conta de demonstração com email já verificado e assinatura ativa,
página pública de privacidade e termos em `casacar.club`, e nenhuma aba primária
podendo cair em placeholder no build submetido.

## 2.3.1 — Benefícios anunciados e não implementados

A folha do Premium promete "Garagem em destaque, suas publicações ganham mais
visibilidade no feed" e "Página pública premium, sem rodapé promocional"
(`apps/mobile/src/copy/garage.ts:102-103`). Não existe termo de premium na
ordenação do feed (`routes/feed.ts`) nem condicional de rodapé em
`apps/admin/src/components/public-garage-view.tsx`.

Os benefícios de plano no seed prometem mais: acesso ao clube em horário
comercial, prioridade em eventos, convidados, desconto com parceiros, acesso
24h, concierge, vaga premium. Não existe contador de convidados, lógica de
desconto, ordenação por prioridade, nem verificação de membership na porta
(`routes/fridge-unlock.ts:17-21` autentica por `x-api-key` compartilhada, sem
checar membership). `GarageSpotSource.premium_membership` existe no enum
(`schema.prisma:237`) e nenhum caminho de código cria vaga com essa origem.

**Correção:** ou implementar, ou remover da copy. Prometer o que não existe é
exposição de metadata enganosa, e o Spec de Apple Pay depende de a copy do
Premium descrever a realidade.

## Configuração de build errada

`apps/mobile/eas.json`, perfil `production`:

- `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` é `pk_test_51RD9T6...`, idêntica à do
  perfil `preview`. O binário de loja falaria com a Stripe em modo test.
- `EXPO_PUBLIC_API_BASE_URL` é `https://ccc-app-production.up.railway.app`, e
  não `api.casacar.club`.
- Não tem `EXPO_PUBLIC_CAIXA_ENABLED`, então a aba da caixa física não renderiza
  (`src/screens/caixa/caixa-enabled.ts:1`, `src/navigation/caixa-slot.ts:7`).
- Não tem `EXPO_PUBLIC_PREMIUM_BILLING_ENABLED`.

As duas primeiras são defeito puro. As duas últimas são decisão de produto e
estão tratadas no spec de Apple Pay.

**Correção:** chave live, domínio próprio, e os dois flags conforme o spec
irmão.

`docs/eas-credentials.md:17,237-246` ainda diz `com.jdmexperience.app`, contra
`packages/design/src/brand.ts:74`. Corrigir, senão provisiona errado.

## Sem ação necessária, verificado

- Exclusão de conta implementada e alcançável em dois toques
  (`routes/me-account-delete.ts:10`; `app/(app)/profile/privacy.tsx:94-106`).
- Sign in with Apple não é exigido: a autenticação é só email e senha.
  `withGoogle` e `withApple` em `src/copy/auth.ts:40-41` são strings mortas sem
  ponto de renderização.
- Navegação como visitante funciona, então não há muro de login na abertura.
- `ITSAppUsesNonExemptEncryption: false` setado. Sem exceções de ATS. Sem
  permissão de localização.

## Ordem

Os itens 1.2 são os de maior esforço e vão antes. Os de configuração e
manifesto são baratos e entram junto. A conta de demonstração e as páginas
públicas são pré-requisito da submissão, não do desenvolvimento.
