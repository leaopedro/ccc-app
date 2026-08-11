export const PRIVACY_POLICY_VERSION = 'privacy-2026-08-06' as const;

export type PolicySection = {
  id: string;
  title: string;
  body: string;
};

export const privacyPolicySections: PolicySection[] = [
  {
    id: 'quem-somos',
    title: '1. Quem somos — dados do controlador',
    body: `A **Casa Car Club** é uma empresa brasileira que organiza eventos e um clubhouse automotivo privado em Curitiba. Somos o controlador dos seus dados pessoais nos termos da Lei Geral de Proteção de Dados (LGPD — Lei nº 13.709/2018).

Nossos dados de contato:

- **Razão social:** Casa Car Club
- **CNPJ:** a ser publicado antes do lançamento em produção
- **Endereço:** a ser publicado antes do lançamento em produção
- **E-mail comercial:** contato@casacar.club`,
  },
  {
    id: 'encarregado',
    title: '2. Encarregado de Proteção de Dados (DPO)',
    body: `Designamos um Encarregado pelo Tratamento de Dados Pessoais, conforme exige o Art. 41 da LGPD e a Resolução CD/ANPD nº 18/2024.

- **Nome:** Pedro Leão
- **Cargo:** CEO e fundador
- **E-mail:** privacidade@casacar.club
- **Prazo de resposta:** acuse de recebimento em até 2 dias úteis; resposta substantiva em até 15 dias (LGPD Art. 19 § 1º)

Você pode enviar dúvidas, solicitações de direitos, reclamações e comunicações sobre proteção de dados diretamente para o e-mail acima.`,
  },
  {
    id: 'dados-coletados',
    title: '3. Quais dados coletamos',
    body: `Coletamos apenas os dados necessários para as finalidades descritas nesta política:

**Conta e identidade**
- Nome completo, e-mail, senha (armazenada como hash irreversível)
- Confirmação de que você tem 18 anos ou mais (registramos apenas o aceite e a data do aceite; **não** coletamos sua data de nascimento)
- Foto de perfil (opcional)

**Veículos e garagem**
- Marca, modelo, ano, cor, placa (opcional), fotos

**Ingressos e pedidos**
- Histórico de compras de ingressos e produtos da loja
- Endereço de entrega e telefone (para pedidos com frete)
- Código de ingresso (QR) — assinado com HMAC; não armazena dados de localização

**Suporte**
- Telefone, mensagens e anexos que você enviar ao abrir um chamado de suporte

**Imagens**
- Foto de perfil, fotos de veículos e anexos de suporte, armazenados na Cloudflare R2

**Pagamento**
- Dados de cartão de crédito/débito: processados pela **Stripe** nos EUA — nunca armazenados por nós
- Pix: processado pela **AbacatePay** no Brasil; armazenamos apenas o status da transação. **Não** coletamos nem armazenamos CPF/CNPJ
- Assinaturas premium: gerenciadas pela **RevenueCat**, que recebe apenas um identificador interno da sua conta

**Notificações**
- Token de dispositivo para notificações push (Expo Push / APNs / FCM)
- Preferências de notificação (opt-in por categoria)

**Dados técnicos**
- Logs de acesso (IP, user-agent, timestamp) — retidos por 90 dias e depois eliminados
- Dados de erro e performance via **Sentry** (e-mail substituído por hash SHA-256; sem cookies de rastreamento)`,
  },
  {
    id: 'finalidades-base-legal',
    title: '4. Por que coletamos e qual é a base legal',
    body: `| Finalidade | Dados usados | Base legal (LGPD Art. 7) |
|---|---|---|
| Criar e manter sua conta | Nome, e-mail, senha | Art. 7, V — execução de contrato |
| Emitir ingressos e QR codes | E-mail, dados do pedido | Art. 7, V — execução de contrato |
| Processar pagamentos | Dados do pedido | Art. 7, V — execução de contrato |
| Enviar e-mails transacionais | E-mail | Art. 7, V — execução de contrato |
| Guardar registros fiscais | Dados do pedido, valor | Art. 7, II — obrigação legal |
| Restringir o acesso a maiores de 18 anos | Autodeclaração de maioridade | Art. 7, IX — interesse legítimo (proteção de menores) |
| Notificações de eventos (push) | Token de dispositivo | Art. 7, I — consentimento (revogável) |
| E-mails e novidades de marketing | E-mail | Art. 7, I — consentimento (revogável) |
| Monitoramento de erros (Sentry) | Dados técnicos | Art. 7, IX — interesse legítimo (segurança do sistema) |
| Validar identidade para assinatura | CPF, telefone, documento de identidade | Art. 7, V — execução de contrato |

**Sobre o interesse legítimo:** realizamos o balanço de interesses (teste LIA) antes de usar esta base. Você pode opor-se a tratamentos baseados em interesse legítimo enviando mensagem ao Encarregado.`,
  },
  {
    id: 'compartilhamento',
    title: '5. Com quem compartilhamos seus dados',
    body: `Não vendemos seus dados. Compartilhamos apenas com fornecedores necessários para a prestação do serviço:

| Fornecedor | Finalidade | País | Papel LGPD |
|---|---|---|---|
| Stripe | Processamento de pagamentos com cartão | EUA | Operador |
| AbacatePay | Processamento de Pix | Brasil | Operador |
| RevenueCat | Gestão de assinaturas premium | EUA | Operador |
| Expo / Apple / Google | Envio de notificações push | EUA | Operador |
| Sentry | Monitoramento de erros | EUA | Operador |
| Cloudflare R2 | Armazenamento de fotos e mídia | EUA | Operador |
| Resend | Envio de e-mails transacionais | EUA | Operador |
| Railway | Infraestrutura de servidores | EUA | Operador |

Todos os fornecedores estão sujeitos a cláusulas contratuais de proteção de dados (DPA). Poderemos compartilhar dados com autoridades públicas brasileiras quando exigido por lei. Não utilizamos SDKs de publicidade ou rastreamento de terceiros.`,
  },
  {
    id: 'transferencias-internacionais',
    title: '6. Transferências internacionais',
    body: `Vários dos nossos fornecedores processam dados fora do Brasil (principalmente nos EUA). Adotamos as seguintes salvaguardas:

- **Cláusulas contratuais padrão (SCC):** incluímos cláusulas de proteção equivalentes às exigidas pela ANPD nos contratos com cada fornecedor listado acima.
- **Adequação contratual:** os contratos seguem o modelo aprovado pela ANPD para transferências internacionais (Art. 33, II da LGPD).

Os fornecedores que ainda não possuem SCC formalizados serão adequados antes do lançamento em produção, conforme o programa LGPD interno (JDMA-672).`,
  },
  {
    id: 'retencao',
    title: '7. Por quanto tempo guardamos seus dados',
    body: `| Categoria de dados | Período de retenção | Fundamento |
|---|---|---|
| Dados de conta (ativos) | Enquanto a conta estiver ativa | Execução de contrato |
| Dados de conta (após exclusão) | 30 dias de carência, depois anonimização | Política interna + LGPD Art. 16 |
| Histórico de pedidos e ingressos | 5 anos após a compra | Obrigação fiscal (Lei nº 9.613/1998) |
| Chamados de suporte | 2 anos após o encerramento | Política interna |
| Tokens de sessão | 30 dias (expiração automática) | Segurança |
| Logs de acesso (IP, user-agent) | 90 dias | Segurança / Marco Civil da Internet |
| Tokens de push | Até revogação do consentimento | Consentimento |
| Dados de erro (Sentry) | 90 dias na plataforma Sentry | Interesse legítimo |
| Documento de identidade (aprovado) | 90 dias após a análise | Prevenção a fraude |
| Documento de identidade (rejeitado) | 30 dias após a análise | Prevenção a fraude |
| Documento de identidade (em análise) | 180 dias após o envio | Prevenção a fraude |

Após os prazos acima, os dados são excluídos ou anonimizados de forma irreversível.`,
  },
  {
    id: 'cookies',
    title: '8. Cookies e tecnologias semelhantes',
    body: `Utilizamos cookies e tecnologias similares apenas no painel administrativo web. O aplicativo móvel não usa cookies de rastreamento.

**Categorias de cookies:**

| Categoria | Exemplos | Exige consentimento? |
|---|---|---|
| **Estritamente necessários** | Cookie de sessão, proteção CSRF, preferências de idioma | Não — necessários para o funcionamento |
| **Funcionais** | Preferências de tema, último evento visualizado | Não — funcionalidade básica |
| **Analíticos** | Sentry Session Replay (admin) | **Sim** — coletado apenas com sua autorização |
| **Marketing** | Nenhum atualmente | N/A |

Ao acessar o painel admin, você verá um banner de consentimento de cookies. Você pode aceitar ou rejeitar categorias individualmente. A opção "Rejeitar não essenciais" tem o mesmo destaque visual que "Aceitar tudo", conforme exige o Guia de Cookies da ANPD (atualização 2025).

Você pode revogar ou alterar suas preferências de cookies a qualquer momento nas configurações do painel.`,
  },
  {
    id: 'direitos',
    title: '9. Seus direitos (LGPD Art. 18)',
    body: `Você tem os seguintes direitos em relação aos seus dados pessoais:

- **Confirmação e acesso:** saber se tratamos seus dados e obter uma cópia
- **Correção:** corrigir dados incompletos, inexatos ou desatualizados
- **Anonimização, bloqueio ou eliminação:** de dados desnecessários ou excessivos
- **Portabilidade:** receber seus dados em formato estruturado para transferência a outro fornecedor
- **Eliminação:** excluir dados tratados com base em consentimento (respeitados os prazos legais)
- **Informação sobre compartilhamento:** saber com quais entidades seus dados são compartilhados
- **Revogação do consentimento:** a qualquer momento, sem prejuízo ao que já foi tratado
- **Revisão de decisões automatizadas:** solicitar revisão humana de decisões baseadas em tratamento automatizado

**Como exercer seus direitos:**

1. Pelo aplicativo: Perfil → Privacidade e dados (exportar seus dados ou excluir sua conta)
2. Por e-mail: privacidade@casacar.club
3. Respondemos em até 15 dias corridos (LGPD Art. 19 § 1º)

Para solicitações de eliminação de dados, a conta será anonimizada após período de carência de 30 dias e os registros fiscais serão preservados pelo prazo legal.`,
  },
  {
    id: 'criancas',
    title: '10. Crianças e adolescentes',
    body: `Nossa plataforma é destinada a maiores de 18 anos. No cadastro, exigimos que você declare ter 18 anos ou mais (autodeclaração). **Não** coletamos sua data de nascimento.

Não coletamos intencionalmente dados de menores de 18 anos sem consentimento dos pais ou responsáveis legais. Se identificarmos que um menor cadastrou-se sem autorização adequada, a conta será suspensa e os dados eliminados.

Se você é pai, mãe ou responsável e acredita que seu filho menor cadastrou-se em nossa plataforma sem autorização, entre em contato pelo e-mail: privacidade@casacar.club.`,
  },
  {
    id: 'seguranca',
    title: '11. Segurança da informação',
    body: `Adotamos medidas técnicas e organizacionais para proteger seus dados:

- **Transmissão:** todas as comunicações usam TLS/HTTPS
- **Senhas:** armazenadas com hash bcrypt (irreversível)
- **Ingressos:** QR codes assinados com HMAC — impossível falsificar
- **Mídia:** fotos armazenadas com URLs pré-assinadas de curta duração (15 minutos)
- **Pagamentos:** dados de cartão nunca passam pelos nossos servidores (Stripe)
- **Autenticação:** MFA obrigatório para administradores e staff
- **Logs:** dados sensíveis (senhas, tokens, e-mails, IP) são removidos ou mascarados nos logs automaticamente

Em caso de incidente de segurança com risco real aos titulares, notificaremos a ANPD e os afetados nos prazos previstos na Resolução CD/ANPD nº 15/2024.`,
  },
  {
    id: 'alteracoes',
    title: '12. Alterações desta política',
    body: `Esta política pode ser atualizada periodicamente. Quando houver alterações materiais:

- Publicaremos a nova versão com a data de atualização
- Notificaremos por e-mail e notificação no app
- Se as mudanças exigirem novo consentimento (base legal Art. 7, I), solicitaremos sua confirmação antes de continuar o tratamento

**Versão atual:** ${PRIVACY_POLICY_VERSION}
**Data de vigência:** 6 de agosto de 2026
**Versão anterior:** privacy-2026-05-14`,
  },
  {
    id: 'anpd',
    title: '13. Como reclamar à ANPD',
    body: `Se você acredita que seus direitos de proteção de dados foram violados e não ficou satisfeito com nossa resposta, você pode registrar uma reclamação junto à **Autoridade Nacional de Proteção de Dados (ANPD)**:

- **Portal:** gov.br/anpd
- **E-mail:** comunicacao@anpd.gov.br
- **Formulário de petição:** disponível no portal da ANPD

Recomendamos que você entre em contato conosco primeiro (privacidade@casacar.club) para que possamos resolver sua questão diretamente.`,
  },
];
