import type { MailMessage, Mailer } from './types.js';

export class DevMailer implements Mailer {
  public readonly captured: MailMessage[] = [];

  // eslint-disable-next-line @typescript-eslint/require-await
  async send(message: MailMessage): Promise<void> {
    this.captured.push(message);

    console.log(`[dev-mail] to=${message.to} subject=${message.subject}`);
    console.log(`[dev-mail] body:\n${message.text ?? message.html}`);
  }

  clear(): void {
    this.captured.length = 0;
  }

  find(to: string): MailMessage | undefined {
    for (let i = this.captured.length - 1; i >= 0; i -= 1) {
      if (this.captured[i]?.to === to) return this.captured[i];
    }
    return undefined;
  }
}
