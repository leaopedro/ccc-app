# Deploy Android até o teste interno da Play — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Levar o app mobile do zero absoluto em Android até um build instalável
pela faixa de teste interno da Play Store, com push validado de ponta a ponta.

**Architecture:** A burocracia da Play roda em paralelo desde o dia 1, porque a
verificação de identidade do Google é latência pura e não depende de nada
técnico. O trabalho técnico é sequencial: APK e smoke primeiro, push depois,
build de loja por último. Cada etapa prova uma coisa, e uma falha precoce custa
apenas o tempo que a burocracia já estava gastando de qualquer jeito.

**Tech Stack:** Expo SDK 54, React Native 0.81, EAS Build e EAS Submit,
Firebase Cloud Messaging V1, Google Play Console, Stripe React Native.

**Spec:** `docs/superpowers/specs/2026-09-13-android-play-deploy-design.md`

## Global Constraints

- **Todo comando `eas` que leia o config precisa de `ALLOW_TEST_STRIPE_KEY=1` no
  shell.** A guarda em `apps/mobile/app.config.ts:56` derruba o comando com uma
  mensagem sobre chave Stripe que não parece ter relação com o que você pediu.
  O perfil do `eas.json` não resolve, porque `eas credentials` e `eas config`
  leem o env do shell.
- Pacotes Android: `com.casacarclub.app`, `com.casacarclub.app.preview`,
  `com.casacarclub.app.dev`.
- Projeto EAS: owner `leaopedro`, slug `ccc`, projectId
  `bd5bfc09-9874-47f5-9ded-5dcf3bd8c3c3`.
- Backend de preview e produção: `https://api.casacar.club`.
- **Nunca commitar:** service account da Play, keystore Android, `.env`.
  `apps/mobile/secrets/` já está no `.gitignore`.
- **Exceção deliberada:** `apps/mobile/google-services.json` VAI commitado.
  Justificativa em D4 do spec.
- Push só conta como pronto pelo log do Railway, nunca por ter visto a
  notificação no aparelho. Critério em D5 do spec.
- PRs abrem contra `main`. Nunca contra `production`.
- Este repo roda várias sessões de agente sobre o mesmo `.git`. Rode
  `git status` antes de cada commit e confirme que todo arquivo sujo é seu.

---

### Task 1: Abrir a conta Play Console e fixar o target API level

Paralela a tudo. Comece por ela, porque a verificação do Google leva dias e é o
caminho crítico do cronograma.

**Files:** nenhum. Task inteiramente externa ao repo.

**Interfaces:**

- Consumes: nada.
- Produces: uma conta Play verificada, e o número do target API level exigido
  na janela atual, que a Task 7 vai conferir contra o build.

- [ ] **Step 1: Criar a conta de desenvolvedor**

Acesse `https://play.google.com/console/signup`. Escolha o tipo **pessoal**,
conforme D1 do spec. Pague os US$25.

- [ ] **Step 2: Completar a verificação de identidade e endereço**

O Google pede documento com foto e comprovante de endereço. Envie e siga em
frente: o resto do plano não depende da aprovação sair, só a Task 6 depende.

- [ ] **Step 3: Ler e anotar o target API level exigido**

No Console, vá em `Policy and programs` e localize o requisito de target API
level vigente. Anote o número.

Não presuma o número a partir deste plano nem do spec. Ele muda todo ano, e os
dois documentos foram escritos sem ele de propósito.

- [ ] **Step 4: Registrar o achado no spec**

Edite `docs/superpowers/specs/2026-09-13-android-play-deploy-design.md`, na
seção de riscos, trocando "Verificar no Console durante a fase 0" pelo número
que você leu e a data em que leu.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-09-13-android-play-deploy-design.md
git commit -m "docs(spec): fixa o target API level exigido pela Play"
```

---

### Task 2: Primeiro build Android e smoke do APK

Este é o primeiro build Android da história do projeto. Não existe base para
supor que o app abre. Trate qualquer sucesso como novidade, não como o esperado.

**Files:** nenhum, se o smoke passar. Se falhar, os arquivos saem do resultado e
viram trabalho próprio, fora deste plano.

**Interfaces:**

- Consumes: nada. Não depende da Task 1.
- Produces: um APK instalado e um checklist preenchido. A Task 4 vai reusar o
  mesmo aparelho e a mesma conta logada.

- [ ] **Step 1: Disparar o build**

```bash
ALLOW_TEST_STRIPE_KEY=1 pnpm --filter @ccc/mobile exec eas build \
  --profile preview --platform android
```

O perfil `preview` já produz APK por `android.buildType` no `eas.json`. Na
primeira execução o EAS vai oferecer gerar um keystore Android. Aceite e deixe
ele gerenciar. Não exporte o keystore para o repo.

- [ ] **Step 2: Confirmar o que o build produziu**

Abra a página do build. Confirme três coisas antes de instalar:

- o artefato é `.apk`, não `.aab`
- o pacote é `com.casacarclub.app.preview`
- o nome do app é `Casa Car Club (Preview)`

Se o nome vier como `JDM Experience (Preview)`, pare. Isso significa que o
config resolveu errado, e o `docs/mobile-build.md` vai te confundir, porque ele
ainda documenta o nome antigo como o correto.

- [ ] **Step 3: Instalar no aparelho Android físico**

Baixe o APK pelo link do EAS direto no aparelho. O Android vai pedir para
liberar instalação de fonte desconhecida no navegador. Libere.

- [ ] **Step 4: Rodar o item número um do smoke, o retorno do checkout**

Este item é o primeiro porque é o que já quebrou duas vezes, nos commits
`6016948` e `89701ef`.

1. Entre em Assinaturas e inicie a contratação de um plano.
2. O app abre um Custom Tab com o checkout hospedado da Stripe.
3. Complete o pagamento com um cartão de teste da Stripe, `4242 4242 4242 4242`,
   validade futura qualquer, CVC qualquer.
4. Feche o Custom Tab.

Esperado: o app entra em estado `confirming` e o polling ativa a assinatura
sozinho, sem você tocar em nada.

Falha a registrar: o app volta e não acontece nada, ou mostra erro genérico
enquanto a Stripe cobrou. Esse é o sintoma exato dos dois commits acima.

- [ ] **Step 5: Rodar o restante do smoke**

Marque cada item como passou ou falhou. Não pule por parecer óbvio: nada disso
foi exercitado em Android alguma vez.

- [ ] Botão voltar do sistema em cada aba
- [ ] Botão voltar com modal aberto
- [ ] Botão voltar dentro do Custom Tab
- [ ] Stripe PaymentSheet no carrinho, com cartão de teste
- [ ] Seletor de fotos no avatar
- [ ] Seletor de fotos na foto de veículo
- [ ] Salvar o QR do ingresso na galeria
- [ ] Teclado não cobre o campo em `reset-password`
- [ ] Teclado não cobre o campo na tela de ingresso
- [ ] Background e foreground sem perder sessão

Sobre o teclado: vários `KeyboardAvoidingView` no app passam `behavior` apenas
no iOS e deixam `undefined` no Android. Isso funciona se `adjustResize` estiver
valendo, e falha silenciosamente se não estiver. Por isso os dois itens são
explícitos.

- [ ] **Step 6: Decidir se o plano continua**

Se o Step 4 falhou, pare o plano aqui e abra o trabalho de correção como tarefa
própria. Continuar para push e Play com o fluxo de pagamento quebrado só empilha
burocracia em cima de um bug.

Se apenas itens do Step 5 falharam, avalie um a um. Nada ali bloqueia o teste
interno, mas tudo ali bloqueia produção.

---

### Task 3: Firebase, `google-services.json` e o campo no config

Depois desta task o app passa a ter o lado cliente do FCM. O lado servidor vem
na Task 4. Os dois são independentes, e é exatamente por isso que dá para
esquecer o segundo.

**Files:**

- Create: `apps/mobile/google-services.json`
- Modify: `apps/mobile/app.config.ts:212-218`

**Interfaces:**

- Consumes: nada das tasks anteriores.
- Produces: `apps/mobile/google-services.json` no repo, e o campo
  `android.googleServicesFile` resolvendo no config público. A Task 4 consome o
  mesmo projeto Firebase criado aqui.

- [ ] **Step 1: Criar o projeto Firebase**

Em `https://console.firebase.google.com`, crie um projeto chamado
`Casa Car Club`. Pode desligar o Google Analytics: nada no app o consome.

- [ ] **Step 2: Registrar os três pacotes Android no mesmo projeto**

Adicione um app Android para cada um, nesta ordem:

1. `com.casacarclub.app`
2. `com.casacarclub.app.preview`
3. `com.casacarclub.app.dev`

Um projeto só, três apps dentro dele. Isso faz um único `google-services.json`
cobrir os três variants, conforme D4 do spec.

- [ ] **Step 3: Baixar o `google-services.json` e colocar no repo**

Baixe o arquivo depois de registrar os **três**. Se você baixar após o primeiro,
ele só terá um cliente e os builds de preview e dev falharão ao inicializar o
Firebase.

Salve como `apps/mobile/google-services.json`.

- [ ] **Step 4: Verificar que o arquivo tem os três clientes**

```bash
grep -c package_name apps/mobile/google-services.json
```

Esperado: `3`.

Se vier `1`, volte ao Step 2 e rebaixe o arquivo. Este é o erro mais provável
desta task inteira.

- [ ] **Step 5: Apontar o campo no `app.config.ts`**

No bloco `android` que hoje ocupa as linhas 212 a 218, acrescente uma linha:

```ts
  android: {
    package: bundleId[variant],
    // Um projeto Firebase com os tres pacotes registrados, entao o mesmo
    // arquivo serve development, preview e production. Vai commitado de
    // proposito: ele viaja dentro do APK e a chave dentro dele e restrita por
    // pacote e assinatura. Ver D4 do spec de deploy Android.
    googleServicesFile: './google-services.json',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#0A0A0A',
    },
  },
```

- [ ] **Step 6: Verificar que o config resolve**

```bash
ALLOW_TEST_STRIPE_KEY=1 pnpm --filter @ccc/mobile exec expo config --type public
```

Esperado: a saída inclui `googleServicesFile` dentro de `android`, e o comando
sai com código 0.

Se o comando morrer com a mensagem sobre chave Stripe de TEST, você esqueceu o
`ALLOW_TEST_STRIPE_KEY=1`.

- [ ] **Step 7: Confirmar que só arquivos seus estão sujos**

```bash
git status
```

Este repo roda sessões paralelas de agente sobre o mesmo `.git`. Se aparecer
arquivo que não é seu, não commite antes de resolver.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/google-services.json apps/mobile/app.config.ts
git commit -m "feat(mobile): registra o projeto Firebase para push no Android"
```

---

### Task 4: Credencial FCM no EAS e validação de push de ponta a ponta

O build Android funciona perfeitamente sem esta task. Só o envio falha. Por isso
"o build passou" não prova nada aqui, e por isso o critério de pronto é um log
de servidor.

**Files:** nenhum no repo. A credencial fica nos servidores do EAS.

**Interfaces:**

- Consumes: o projeto Firebase da Task 3, e o aparelho já logado da Task 2.
- Produces: envio de push funcionando para Android, comprovado por log.

- [ ] **Step 1: Criar o service account no Google Cloud**

No Firebase Console, vá em `Project settings`, aba `Cloud Messaging`. Na seção
da API V1, siga o link para o Google Cloud e gere uma chave de service account
em formato JSON. Baixe.

- [ ] **Step 2: Subir a chave no EAS**

```bash
ALLOW_TEST_STRIPE_KEY=1 pnpm --filter @ccc/mobile exec eas credentials -p android
```

Escolha o pacote `com.casacarclub.app.preview`, depois
`Push Notifications: Manage your FCM V1 service account key`, depois o upload do
JSON que você baixou.

O prefixo `ALLOW_TEST_STRIPE_KEY=1` não é opcional. Sem ele o comando morre ao
ler o config, com uma mensagem sobre chave Stripe que não tem relação aparente
com credenciais.

- [ ] **Step 3: Repetir para o pacote de produção**

Repita o Step 2 para `com.casacarclub.app`. A Task 6 vai buildar esse pacote, e
credencial de FCM é por pacote, não por projeto.

- [ ] **Step 4: Rebuildar o preview**

```bash
ALLOW_TEST_STRIPE_KEY=1 pnpm --filter @ccc/mobile exec eas build \
  --profile preview --platform android
```

O `google-services.json` da Task 3 só entra no binário num build novo. O APK da
Task 2 não tem Firebase dentro.

- [ ] **Step 5: Instalar e conceder a permissão de notificação**

Instale o APK novo. Faça login. No Android 13 ou superior o sistema pede a
permissão de notificação em runtime, tratada por
`apps/mobile/src/notifications/permission.ts`.

Teste os dois caminhos:

1. Conceda na primeira vez. O token deve registrar.
2. Depois, negue: desinstale, reinstale, negue o prompt, vá nas configurações do
   sistema e conceda manualmente. Reabra o app. O token deve registrar também.

- [ ] **Step 6: Disparar uma broadcast e ler o log do Railway**

Dispare uma broadcast pelo admin. Nos logs do serviço `ccc-app` no Railway,
procure a linha `[broadcasts] dispatch complete`.

Esperado: `totalSent>0` **e ausência** de `pruned invalid tokens`.

Este é o critério de pronto, conforme D5 do spec. Ver a notificação no aparelho
não substitui esta leitura.

- [ ] **Step 7: Interpretar o log, se ele não vier como esperado**

- **`pruned invalid tokens` aparece:** o Expo está rejeitando. Como
  `apps/api/src/services/push/expo.ts:52-57` só classifica `DeviceNotRegistered`
  como token inválido, prune aqui significa que o token realmente não existe
  mais, e **não** que o FCM está errado. Desinstalar e reinstalar sem reabrir o
  app produz isso.
- **`totalSent` é 0 e não há prune:** provável falha de credencial. O erro do
  ticket vai citar `InvalidCredentials`. Volte ao Step 2.
- **Nenhuma linha `[broadcasts] dispatch complete` aparece:** o worker não está
  ligado. Confira `WORKER_ENABLED` e `BROADCAST_WORKER_ENABLED` no serviço
  `ccc-app` do Railway. Ambos têm default `false` em `apps/api/src/env.ts`.

- [ ] **Step 8: Testar os três estados do app**

Com o envio comprovado, teste a recepção:

- [ ] App em primeiro plano
- [ ] App em segundo plano
- [ ] App morto, fechado pelo gerenciador de tarefas
- [ ] Tocar na notificação abre a rota certa, por `use-push-open-handler.ts`

App morto é o estado que mais falha no Android. Teste-o por último e com
atenção.

---

### Task 5: Perfil `playinternal` no `eas.json`

**Files:**

- Modify: `apps/mobile/eas.json`

**Interfaces:**

- Consumes: nada das tasks anteriores.
- Produces: os perfis `build.playinternal` e `submit.playinternal`, consumidos
  pela Task 6.

- [ ] **Step 1: Adicionar o perfil de build**

Em `apps/mobile/eas.json`, dentro de `build`, logo depois do bloco `testflight`,
acrescente:

```json
    "playinternal": {
      "extends": "production",
      "env": {
        "ALLOW_TEST_STRIPE_KEY": "1"
      }
    }
```

É o simétrico do `testflight`, que existe pelo mesmo motivo do lado iOS. Deixar
o `production` continuar quebrando com `pk_test_` é proposital, e está
documentado em `docs/eas-credentials.md`.

- [ ] **Step 2: Adicionar o perfil de submit**

Dentro de `submit`, acrescente:

```json
    "playinternal": {
      "android": {
        "serviceAccountKeyPath": "./secrets/play-service-account.json",
        "track": "internal"
      }
    }
```

- [ ] **Step 3: Verificar que o JSON é válido**

```bash
node -e "JSON.parse(require('fs').readFileSync('apps/mobile/eas.json','utf8')); console.log('ok')"
```

Esperado: `ok`.

- [ ] **Step 4: Verificar que o EAS resolve o perfil**

```bash
ALLOW_TEST_STRIPE_KEY=1 pnpm --filter @ccc/mobile exec eas config \
  --platform android --profile playinternal
```

Esperado: o config resolvido imprime, `APP_VARIANT` é `production`, e o pacote
é `com.casacarclub.app`.

Este é o teste real deste task. Um perfil que faz o parse mas não resolve só
falha meia hora depois, no meio do build.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/eas.json
git commit -m "feat(mobile): perfil playinternal para a faixa interna da Play"
```

---

### Task 6: App record na Play, service account e primeiro AAB

Depende da Task 1 ter sido aprovada pelo Google.

**Files:**

- Create: `apps/mobile/secrets/play-service-account.json`, local e nunca
  commitado.

**Interfaces:**

- Consumes: os perfis da Task 5, a conta verificada da Task 1, e a credencial
  FCM de `com.casacarclub.app` da Task 4 Step 3.
- Produces: um AAB na faixa interna, instalável pela Play.

- [ ] **Step 1: Criar o app no Play Console**

- App name: `Casa Car Club`
- Default language: `Português (Brasil)`
- Tipo: App, não Jogo
- Gratuito ou pago: `Gratuito`

O pacote `com.casacarclub.app` não é escolhido aqui. Ele é fixado na primeira
subida de binário.

- [ ] **Step 2: Criar o service account para o EAS Submit**

No Google Cloud, no mesmo projeto, crie um service account e gere uma chave
JSON. No Play Console, em `Users and permissions`, convide o email desse service
account e dê a ele permissão de gerenciar releases deste app.

- [ ] **Step 3: Salvar a chave no caminho que o `eas.json` espera**

Salve em `apps/mobile/secrets/play-service-account.json`.

- [ ] **Step 4: Confirmar que o arquivo está ignorado pelo git**

```bash
git check-ignore -v apps/mobile/secrets/play-service-account.json
```

Esperado: a saída cita `apps/mobile/.gitignore:46`, que já ignora `secrets/`.

Se o comando não imprimir nada, o arquivo NÃO está ignorado. Pare e resolva
antes de qualquer commit.

- [ ] **Step 4b: Confirmar a flag da caixa antes de submeter**

```bash
grep -c '"EXPO_PUBLIC_CAIXA_ENABLED": "true"' apps/mobile/eas.json
```

Esperado: `3`, e `playinternal` herda de `production`.

Não é conferência de rotina. A assinatura premium só pode sair por checkout
externo porque a caixa física viaja dentro do binário. Com a flag desligada, a
assinatura vira produto digital e a Política de Pagamentos da Play passa a
exigir Google Play Billing, exatamente como a 3.1.1 da Apple.

Isso não bloqueia o teste interno, que não passa por revisão. Bloqueia produção.
A afirmação "a flag está ligada" já ficou desatualizada uma vez neste projeto,
por isso ela é verificada aqui e não assumida.

- [ ] **Step 5: Buildar e submeter**

```bash
ALLOW_TEST_STRIPE_KEY=1 pnpm --filter @ccc/mobile exec eas build \
  --platform android --profile playinternal \
  --auto-submit-with-profile playinternal --non-interactive
```

`appVersionSource: remote` com `autoIncrement` cuida do `versionCode`. Não há
nada para incrementar à mão.

- [ ] **Step 6: Aceitar o Play App Signing**

Na primeira subida o Console oferece o Play App Signing. Aceite, conforme
`docs/eas-credentials.md`. Isso mantém a chave de upload separada da chave de
assinatura do app.

- [ ] **Step 7: Não repetir o submit para conferir**

Se ficar na dúvida se funcionou, leia a URL de submissão que o comando imprimiu.
Não redispare. No lado Apple isso gera uma linha Failed para a mesma versão, e o
Play tem comportamento igualmente confuso.

- [ ] **Step 8: Conferir o target API level do build contra a Task 1**

No Console, abra o release e confira o target API level que o Play reporta.
Compare com o número que você anotou na Task 1 Step 3.

Se estiver abaixo do exigido, o Play avisa no próprio release. Isso vira
trabalho próprio, fora deste plano.

- [ ] **Step 9: Instalar pela faixa interna e repetir o smoke crítico**

Adicione seu email como testador interno. Instale pelo link de opt-in.

Repita três itens da Task 2, e só esses três:

- [ ] Retorno do checkout de assinatura
- [ ] Botão voltar do sistema
- [ ] Stripe PaymentSheet no carrinho

O AAB é assinado pela Play, não pelo EAS. Assinatura diferente pode quebrar
integração que funcionava no APK.

---

### Task 7: Auditar as permissões do AndroidManifest

Feita antes da Task 8 de propósito. O formulário de Data Safety pergunta sobre
permissões, e responder sem ter lido o manifest gerado é chutar.

**Files:**

- Modify: `apps/mobile/app.config.ts`, apenas se a auditoria encontrar sobra.

**Interfaces:**

- Consumes: o config da Task 3.
- Produces: a lista real de permissões, consumida pela Task 8.

- [ ] **Step 1: Gerar o projeto nativo Android**

Rode da raiz do repo, para que os caminhos dos steps seguintes batam:

```bash
ALLOW_TEST_STRIPE_KEY=1 APP_VARIANT=production \
  pnpm --filter @ccc/mobile exec expo prebuild \
  --clean --platform android --no-install
```

`--clean` não é opcional. Sem ele o Expo pode reaproveitar um diretório antigo,
e o repo já tem esse histórico documentado no `docs/mobile-build.md` para iOS.

- [ ] **Step 2: Ler as permissões geradas**

```bash
grep uses-permission apps/mobile/android/app/src/main/AndroidManifest.xml
```

Anote a lista inteira.

- [ ] **Step 3: Comparar com o que o app de fato usa**

O app tem estas capacidades, e nenhuma outra:

| Capacidade               | Origem                                            |
| ------------------------ | ------------------------------------------------- |
| Notificação              | `expo-notifications`                              |
| Escolher foto da galeria | `expo-image-picker`, só `launchImageLibraryAsync` |
| Salvar imagem na galeria | `expo-media-library`, para o QR do ingresso       |
| Rede                     | a API                                             |

O app **não** tira foto, **não** grava áudio, **não** usa localização e **não**
usa biometria. Qualquer permissão fora da tabela acima é sobra injetada por
plugin.

O caso mais provável é `CAMERA`, vindo do `expo-image-picker`. No iOS a string
de câmera precisou ficar por exigência do validador da Apple, conforme o
comentário em `app.config.ts`. No Android, a permissão pode sair.

- [ ] **Step 4: Se sobrou permissão, fixar a lista explicitamente**

Só faça este step se o Step 3 encontrou sobra. Acrescente ao bloco `android` do
`app.config.ts`, adaptando a lista ao que a auditoria realmente achou:

```ts
    // Fixa a lista para o que o app de fato usa. Sem isto, plugins injetam
    // permissoes de features ausentes, e cada permissao a mais e uma pergunta
    // a mais no Data Safety da Play.
    permissions: ['INTERNET', 'POST_NOTIFICATIONS', 'READ_MEDIA_IMAGES'],
```

- [ ] **Step 5: Reconferir o manifest**

Repita os Steps 1 e 2. Confirme que a lista encolheu para o que você declarou.

- [ ] **Step 6: Limpar o diretório nativo gerado**

```bash
rm -rf apps/mobile/android
```

O repo não versiona `android/`. Deixar o diretório gerado para trás suja o
worktree e confunde a próxima sessão.

- [ ] **Step 7: Commit, se o Step 4 mudou algo**

```bash
git status
git add apps/mobile/app.config.ts
git commit -m "fix(mobile): fixa as permissoes Android no que o app usa"
```

---

### Task 8: Data Safety, classificação e ficha da loja

**Files:** nenhum. Trabalho no Console.

**Interfaces:**

- Consumes: a lista de permissões da Task 7, e o app record da Task 6.
- Produces: a ficha completa, último requisito antes do teste fechado.

- [ ] **Step 1: Preencher o Data Safety a partir da fonte que já existe**

Não comece do zero. O inventário do que o app coleta já foi feito para a Apple e
está em `apps/mobile/app.config.ts:148-203`. O texto legal correspondente está
em `packages/shared/src/legal.ts`.

Traduza item a item:

| No `privacyManifests`                   | No Data Safety                   |
| --------------------------------------- | -------------------------------- |
| EmailAddress                            | Personal info, Email address     |
| PhoneNumber                             | Personal info, Phone number      |
| Name                                    | Personal info, Name              |
| OtherDataTypes, que é CPF e o documento | Personal info, Other IDs         |
| PhotosorVideos                          | Photos and videos, Photos        |
| PurchaseHistory                         | Financial info, Purchase history |
| UserContent                             | Messages ou Other user content   |
| CrashData                               | App activity, Crash logs         |

Tudo é `Collected` e `Linked to the user`, porque tudo pende de uma conta
autenticada. Nada é `Shared` para publicidade, e nada é usado para tracking:
não existe SDK de anúncio no app.

- [ ] **Step 2: Responder o questionário de classificação IARC**

Responda honestamente sobre conteúdo gerado por usuário: o app tem feed com
posts de membros, então UGC existe e os controles de denúncia e bloqueio também,
conforme o que já foi feito para a Apple.

- [ ] **Step 3: Informar a URL da política de privacidade**

Use a URL hospedada, no domínio `casacar.club`. O domínio correto é esse, nunca
`casacarclub.com.br`.

- [ ] **Step 4: Preencher a ficha em PT-BR**

Nome, descrição curta, descrição completa, ícone, capturas de tela de telefone.
Reuse o material da App Store onde couber.

- [ ] **Step 5: Preparar a conta de revisão e preencher App access**

```bash
REVIEW_ACCOUNT_EMAIL=review@casacar.club \
REVIEW_ACCOUNT_PASSWORD='<gere na hora, nao versione>' \
  pnpm --filter @ccc/api exec tsx src/scripts/seed-review-account.ts
```

O script é idempotente e já é usado para a Apple. Ele deixa a conta verificada,
com assinatura ativa, evento publicado e posts de outro membro no feed.

Cole email e senha em App access no Play Console. A fonte da verdade da senha é
o Console, não o banco: o script reescreve a senha a cada execução.

---

### Task 9: Atualizar os runbooks

Feita por último, porque só agora se sabe o que de fato aconteceu.

**Files:**

- Modify: `docs/mobile-build.md`
- Modify: `docs/eas-credentials.md`

**Interfaces:**

- Consumes: tudo que as tasks anteriores descobriram.
- Produces: runbooks que não mentem.

- [ ] **Step 1: Corrigir o que ficou para trás na virada de marca**

Em `docs/mobile-build.md`, a seção do Step 3 manda esperar o nome
`JDM Experience (Preview)` e o backend `jdm-production.up.railway.app`. Os dois
estão errados desde a virada para Casa Car Club. Troque por
`Casa Car Club (Preview)` e `https://api.casacar.club`.

- [ ] **Step 2: Reescrever a seção Android do `mobile-build.md`**

O Step 4 atual diz apenas "baixe o APK". Substitua pelo que este plano
descobriu: o keystore gerenciado pelo EAS, a necessidade do
`ALLOW_TEST_STRIPE_KEY=1`, e o smoke que é específico de Android.

O Step 5, "Optional Play Internal handoff", deixou de ser opcional e deixou de
ser um esboço. Aponte para este plano.

- [ ] **Step 3: Preencher a seção de Google Play do `eas-credentials.md`**

A seção `Step 2: Google Play setup` foi escrita antes de qualquer coisa existir.
Substitua as intenções pelo que foi feito: nome do projeto Firebase, onde vive a
credencial FCM V1, qual service account tem acesso ao Play, e o fato de que
`eas credentials` precisa do `ALLOW_TEST_STRIPE_KEY=1`.

- [ ] **Step 4: Registrar o bloqueio de produção**

Nos dois arquivos, deixe explícito que produção depende de teste fechado com 12
testadores por 14 dias, que é requisito de recrutamento e não de engenharia.

- [ ] **Step 5: Commit**

```bash
git status
git add docs/mobile-build.md docs/eas-credentials.md
git commit -m "docs: runbooks de build refletem o caminho Android real"
```

---

## O que este plano não faz

Produção na Play. Ela exige teste fechado com 12 testadores opted-in por 14 dias
seguidos, e hoje esses testadores não existem. O APK instalado à mão não conta:
o Google só conta opt-in dentro de uma faixa de teste fechado.

Nenhuma task acima encurta esses 14 dias. As duas saídas reais são recrutar as
12 pessoas, ou migrar para conta de organização com CNPJ, que não cai na regra.

Também fica pendente, e agora em duas lojas, a vaga de garagem de R$49 em
`packages/db/src/garage-spot-product.ts`. É um SKU virtual vendido pelo carrinho
normal, sem defesa de bem físico. Hoje é inalcançável porque
`defaultFreeGarageSpots` é null.
