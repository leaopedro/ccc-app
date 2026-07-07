import { Resend } from 'resend';

import type { MailMessage, Mailer } from './types.js';

export class ResendMailer implements Mailer {
  private readonly client: Resend;

  constructor(
    apiKey: string,
    private readonly from: string,
  ) {
    this.client = new Resend(apiKey);
  }

  async send(message: MailMessage): Promise<void> {
    const { error } = await this.client.emails.send({
      from: this.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      ...(message.text !== undefined ? { text: message.text } : {}),
    });
    if (error) throw new Error(`resend send failed: ${error.message}`);
  }
}
