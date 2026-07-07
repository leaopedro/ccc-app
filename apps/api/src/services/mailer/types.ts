export type MailMessage = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}
