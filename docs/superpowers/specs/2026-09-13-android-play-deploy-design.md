# Deploy Android até o teste interno da Play Store

**Data:** 2026-09-13
**Status:** aguardando revisão
**Escopo desta rodada:** até a faixa de teste interno da Play. Produção fica
bloqueada, e o bloqueio não é técnico.

## Objetivo

Levar o app mobile do zero absoluto em Android até um build instalável pela
faixa de teste interno da Play Store, com push funcionando de ponta a ponta.

## Não-objetivo

Publicar em produção. O caminho até lá está descrito no fim deste documento,
mas depende de recrutar testadores, não de escrever código.

## Estado atual, verificado em 2026-09-13

**Nenhum build Android jamais rodou.** `eas build:list --platform android`
retorna lista vazia para `@leaopedro/ccc`. Todo o caminho Android é inédito.
Não existe base para supor que o app sequer abre em Android.

**Não existe nenhuma credencial FCM.** Nenhum `google-services.json` no repo,
nenhuma referência a Firebase em `apps/mobile`. Push em Android não registra
hoje.

**O perfil `production` não builda.** A guarda em `apps/mobile/app.config.ts:56`
derruba qualquer build de produção que carregue `pk_test_`, e a chave atual é de
teste. O único escape que existe é o perfil `testflight`, cujo bloco de submit
tem apenas iOS.

**A assinatura no Android sai por checkout hospedado.**
`apps/mobile/src/screens/assinaturas/checkout.ts:160` abre
`WebBrowser.openAuthSessionAsync`. O retorno não depende de deep link, depende
de polling. Esse caminho já quebrou duas vezes, nos commits `6016948` e
`89701ef`.

**O `eas.json` já prevê Android parcialmente.** O perfil `preview` produz APK
por `android.buildType`. O bloco `submit.production.android` aponta para
`./secrets/play-service-account.json`, arquivo que não existe. O diretório
`apps/mobile/secrets/` está no `.gitignore`.

**Os runbooks estão desatualizados.** `docs/mobile-build.md` manda esperar o
nome `JDM Experience (Preview)` e o backend `jdm-production.up.railway.app`.
Ambos são anteriores à virada de marca. Quem seguir aquelas seções ao pé da
letra vai concluir errado que o build saiu torto.

## Decisões

### D1. Conta de desenvolvedor pessoal, com a consequência aceita

A conta Play será pessoal, no nome do Pedro. Conta pessoal cai na regra do
Google que exige teste fechado com no mínimo 12 testadores por 14 dias seguidos
antes de liberar acesso a produção. Conta de organização escaparia dessa regra,
ao custo de verificação de CNPJ.

Confiança alta na regra, mas ela deve ser confirmada no próprio Console antes de
qualquer planejamento de data.

A regra vale para o teste **fechado**. O teste **interno** não cai nela: aceita
até 100 testadores, libera na hora e não passa por revisão. Por isso o teste
interno é um alvo alcançável agora e produção não é.

### D2. Sequencial, com a burocracia correndo em paralelo

A verificação de identidade e endereço do Google leva dias e não depende de
nada técnico. Ela abre no dia 1, em paralelo com a engenharia.

O trabalho técnico é sequencial: APK e smoke, depois push, depois build de loja.
Cada etapa prova uma coisa. Ir direto ao teste interno economizaria passos, mas
descobriria um crash de boot depois de pagar, verificar identidade e preencher
formulários, e iterar pela Play é mais lento que instalar um APK.

### D3. Perfil de build próprio para a faixa interna

Criar `playinternal` no `eas.json`, estendendo `production` com
`ALLOW_TEST_STRIPE_KEY=1`, mais um bloco de submit apontando para a faixa
`internal`. É o simétrico do `testflight` que já existe para iOS, com nome
honesto sobre o que faz.

Deixar `production` continuar quebrando é proposital, pelo mesmo motivo já
registrado em `docs/eas-credentials.md`: `production` é o perfil de venda, e
enquanto a stack estiver na conta sandbox da Stripe ele deve mesmo falhar.

### D4. `google-services.json` vai commitado

O arquivo viaja dentro do APK e qualquer um o extrai, então não é segredo. A API
key que ele contém é restrita por nome de pacote e assinatura.

A alternativa seria um file secret no EAS, que evita o commit mas quebra
`expo run:android` local sem um fallback adicional. Mais peça, mesmo resultado.

Um único projeto Firebase, com os três pacotes registrados nele:
`com.casacarclub.app`, `com.casacarclub.app.preview` e
`com.casacarclub.app.dev`. Um `google-services.json` cobre os três.

### D5. Push é critério de pronto por log de servidor, não por aparelho

Ver a notificação chegar no aparelho não prova que a stack está certa. O
critério é o mesmo já usado para a produção iOS: disparar uma broadcast e ler
`[broadcasts] dispatch complete` nos logs do Railway, com `totalSent>0` e
**ausência** de `pruned invalid tokens`.

## Fases

### Fase 0, paralela, começa no dia 1

1. Criar a conta de desenvolvedor da Play Console. Custo de US$25, uma vez.
2. Completar verificação de identidade e endereço.
3. Verificar no Console qual target API level está sendo exigido na janela
   atual. O número não está fixado neste documento de propósito.

Nada nesta fase depende das outras. É latência pura, e é o caminho crítico.

### Fase 1, primeiro build Android da história do projeto

```bash
pnpm --filter @ccc/mobile exec eas build --profile preview --platform android
```

Instalar o APK direto do link do EAS no aparelho Android físico. Rodar o smoke
da seção de teste, sem os itens de push.

Critério de pronto: abre sem crash nativo, navega, a API responde, e carrinho e
assinatura completam.

Se esta fase falhar, ela consome o tempo que a fase 0 está gastando com
burocracia. Esse é exatamente o desenho pretendido.

### Fase 2, push

1. Criar o projeto Firebase e registrar os três pacotes.
2. Baixar `google-services.json` e commitar em `apps/mobile/`.
3. Apontar `android.googleServicesFile` no `app.config.ts`.
4. Criar o service account no Google Cloud e subir a chave FCM V1 no EAS:

```bash
ALLOW_TEST_STRIPE_KEY=1 pnpm --filter @ccc/mobile exec eas credentials -p android
```

O prefixo não é opcional. Sem ele o comando morre ao ler o config, com uma
mensagem sobre chave Stripe que não parece ter relação nenhuma com credenciais.
O perfil não resolve, porque `eas credentials` lê o env do shell.

5. Rebuild do `preview` e teste de push nos três estados do app.

Critério de pronto: o log do Railway descrito em D5.

### Fase 3, build de loja

1. Adicionar o perfil `playinternal` ao `eas.json`.
2. Buildar o AAB e submeter:

```bash
pnpm --filter @ccc/mobile exec eas build --platform android \
  --profile playinternal --auto-submit-with-profile playinternal --non-interactive
```

3. Na primeira subida, aceitar o Play App Signing.
4. Salvar o service account da Play em `apps/mobile/secrets/play-service-account.json`.

`appVersionSource: remote` com `autoIncrement` cuida do `versionCode`. Não há
nada para incrementar à mão.

### Fase 4, conteúdo da ficha

1. Formulário de Data Safety. A fonte da verdade já existe e não deve ser
   reescrita do zero: o inventário em `app.config.ts:148-203` e o texto legal em
   `packages/shared/src/legal.ts`. O trabalho é traduzir de um formato para o
   outro.
2. Antes de preencher, rodar prebuild Android e ler o `AndroidManifest.xml`
   gerado. `expo-media-library` e `expo-image-picker` injetam permissões
   sozinhos. Declarar permissão que o app não usa é pergunta a mais na ficha e
   risco a mais de rejeição. Se sobrar permissão, fixar `android.permissions`
   explicitamente.
3. Classificação de conteúdo IARC.
4. URL de política de privacidade hospedada.
5. Ficha em PT-BR, com textos e capturas de tela.
6. App access, com a conta que `apps/api/src/scripts/seed-review-account.ts` já
   gera para a Apple. O script é idempotente e deve rodar antes da submissão.

## Mudanças no repo

| Arquivo                            | Mudança                                                                    |
| ---------------------------------- | -------------------------------------------------------------------------- |
| `apps/mobile/eas.json`             | Perfil de build e de submit `playinternal`                                 |
| `apps/mobile/app.config.ts`        | `android.googleServicesFile`, e `android.permissions` se a auditoria pedir |
| `apps/mobile/google-services.json` | Novo, commitado                                                            |
| `docs/mobile-build.md`             | Corrigir as seções Android anteriores à virada de marca                    |
| `docs/eas-credentials.md`          | Preencher a seção de Google Play com o que foi de fato feito               |

Nenhuma mudança em código de aplicação está prevista. Se o smoke da fase 1
exigir alguma, ela sai do escopo deste spec e vira trabalho próprio.

## Plano de teste

O app já foi exercitado no TestFlight. O smoke cobre apenas onde Android difere,
mais os caminhos que já quebraram.

### Smoke da fase 1

1. **Retorno do checkout de assinatura.** Abrir o Custom Tab, pagar, fechar. Tem
   que entrar em `confirming` e o polling tem que ativar a assinatura. Item
   número um, porque quebrou em `6016948` e de novo em `89701ef`.
2. **Botão voltar do sistema.** Em cada aba, com modal aberto, e dentro do
   Custom Tab. iOS não tem esse gesto, então nada disso foi exercitado.
3. Stripe PaymentSheet no carrinho, em aparelho real.
4. Seletor de fotos do Android 14, no avatar e na foto de veículo.
5. Salvar o QR do ingresso na galeria, via `expo-media-library`.
6. Teclado cobrindo campo. Vários `KeyboardAvoidingView` passam `behavior`
   apenas no iOS e deixam `undefined` no Android, o que depende de
   `adjustResize` estar valendo.
7. Background e foreground sem perder sessão.

### Smoke da fase 2

1. Permissão de notificação no Android 13 ou superior, incluindo negar e
   conceder depois pelas configurações do sistema.
2. Push com o app em primeiro plano, em segundo plano, e morto. Morto é o estado
   que mais falha no Android.
3. Toque na notificação abrindo a rota certa, por `use-push-open-handler.ts`.
4. O log do Railway de D5.

### Smoke da fase 3

Reinstalar pela faixa interna e repetir os itens 1, 2 e 3 da fase 1. O AAB é
assinado pela Play, não pelo EAS, e assinatura diferente pode quebrar
integração.

## Riscos e armadilhas conhecidas

**`eas credentials` falha antes de começar.** Descrito na fase 2. É a primeira
coisa que trava alguém que não conhece o repo.

**FCM é invisível para o build.** Exatamente como a Push Key APNs: build e
submit Android funcionam perfeitamente sem FCM configurado, e só o envio falha.
"O build passou" não é prova de nada sobre push.

**Um FCM errado se manifesta como `InvalidCredentials`.**
`apps/api/src/services/push/expo.ts:52-57` trata esse código como erro, e não como
token inválido, então ele não apaga tokens bons. Isso foi corrigido no PR #72
justamente para que esse diagnóstico seja possível. Se aparecer `pruned invalid
tokens` no log, o problema não é o FCM.

**Política de Pagamentos do Play.** Não trava o teste interno, que não passa por
revisão. Trava produção. Vale o mesmo raciocínio do iOS: com
`EXPO_PUBLIC_CAIXA_ENABLED` ligado, a caixa física sustenta o checkout externo.
A flag está `true` nos três perfis hoje. Confirme no `eas.json` antes de
submeter, porque essa afirmação já ficou desatualizada uma vez.

**A vaga de garagem de R$49 é um SKU virtual vendido pelo carrinho normal**,
em `packages/db/src/garage-spot-product.ts`. Não tem defesa de bem físico, nem
para a Apple nem para o Google. Hoje é inalcançável porque
`defaultFreeGarageSpots` é null. Continua pendente de decisão, e agora pendente
em duas lojas.

**Target API level.** O Google exige uma janela específica que muda todo ano.
Verificar no Console durante a fase 0.

**Worktrees paralelos.** Este repo roda várias sessões de agente ao mesmo tempo
sobre o mesmo `.git`. A branch do checkout principal muda sozinha. Antes de
qualquer commit, conferir que todo arquivo sujo é seu.

## O que fica bloqueado, e por quê

Produção na Play Store exige, além de tudo acima, teste fechado com 12
testadores opted-in por 14 dias seguidos.

Hoje não existem 12 testadores disponíveis. O APK instalado à mão não conta: o
Google só conta opt-in dentro de uma faixa de teste fechado.

Isso é um requisito de recrutamento, não de engenharia. Nenhuma decisão técnica
neste documento encurta esses 14 dias. As duas saídas reais são recrutar as 12
pessoas, ou migrar para uma conta de organização com CNPJ, que não cai na regra.

## Critérios de pronto desta rodada

- [ ] Conta Play Console criada e verificada.
- [ ] APK `preview` instalado em Android físico, com o smoke da fase 1 passado.
- [ ] Push validado pelo log do Railway, conforme D5.
- [ ] AAB na faixa de teste interno, instalável pela Play.
- [ ] Data Safety, classificação, privacidade e App access preenchidos.
- [ ] `docs/mobile-build.md` e `docs/eas-credentials.md` refletindo o que foi
      realmente feito.
