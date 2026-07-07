import type { PushMessage, PushSendOutcome, PushSendResult, PushSender } from './types.js';

export class DevPushSender implements PushSender {
  public readonly captured: PushMessage[] = [];
  private readonly invalidTokens = new Set<string>();

  markInvalid(token: string): void {
    this.invalidTokens.add(token);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async send(messages: PushMessage[]): Promise<PushSendResult> {
    const outcomesByToken = new Map<string, PushSendOutcome>();
    for (const m of messages) {
      this.captured.push(m);
      console.log(`[dev-push] to=${m.to} title=${m.title}`);
      const outcome: PushSendOutcome = this.invalidTokens.has(m.to)
        ? { kind: 'invalid-token' }
        : { kind: 'ok' };
      outcomesByToken.set(m.to, outcome);
    }
    return { outcomesByToken };
  }

  clear(): void {
    this.captured.length = 0;
  }
}
