export type VerificationMail = { to: string; subject: string; html: string };
export type ResetMail = VerificationMail;
export type EmailChangeMail = VerificationMail;

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const verificationMail = (to: string, link: string): VerificationMail => {
  const safe = escapeHtml(link);
  return {
    to,
    subject: 'Casa Car Club — verifique seu e-mail',
    html: `
    <p>Olá!</p>
    <p>Clique no link abaixo para confirmar seu e-mail. Ele expira em 24h.</p>
    <p><a href="${safe}">${safe}</a></p>
    <p>Se você não criou a conta, ignore este e-mail.</p>
  `,
  };
};

export const resetMail = (to: string, link: string): ResetMail => {
  const safe = escapeHtml(link);
  return {
    to,
    subject: 'Casa Car Club — redefinição de senha',
    html: `
    <p>Recebemos um pedido para redefinir sua senha.</p>
    <p>Clique no link abaixo (expira em 1h):</p>
    <p><a href="${safe}">${safe}</a></p>
    <p>Se você não solicitou, ignore este e-mail.</p>
  `,
  };
};

export const emailChangeConfirmMail = (to: string, link: string): EmailChangeMail => {
  const safe = escapeHtml(link);
  return {
    to,
    subject: 'Casa Car Club — confirme seu novo e-mail',
    html: `
    <p>Recebemos um pedido para alterar o e-mail da sua conta.</p>
    <p>Clique no link abaixo para confirmar. Ele expira em 24h:</p>
    <p><a href="${safe}">${safe}</a></p>
    <p>Se você não fez essa solicitação, ignore este e-mail.</p>
  `,
  };
};

export const emailChangeNotifyMail = (to: string, newEmail: string): EmailChangeMail => {
  const safeEmail = escapeHtml(newEmail);
  return {
    to,
    subject: 'Casa Car Club — seu e-mail foi alterado',
    html: `
    <p>O e-mail da sua conta Casa Car Club foi alterado para <strong>${safeEmail}</strong>.</p>
    <p>Se você não fez essa alteração, entre em contato com nosso suporte imediatamente.</p>
  `,
  };
};
