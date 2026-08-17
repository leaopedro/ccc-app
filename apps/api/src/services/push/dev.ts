import type { PushMessage, PushSendOutcome, PushSendResult, PushSender } from './types.js';

export class DevPushSender implements PushSender {
  public readonly captured: PushMessage[] = [];
  private readonly invalidTokens = new Set<string>();
  private readonly errorTokens = new Set<string>();

  markInvalid(token: string): void {
    this.invalidTokens.add(token);
  }

  markError(token: string): void {
    this.errorTokens.add(token);
  }

  async send(messages: PushMessage[]): Promise<PushSendResult> {
    const outcomesByToken = new Map<string, PushSendOutcome>();
    for (const m of messages) {
      this.captured.push(m);
      console.log(`[dev-push] to=${m.to} title=${m.title}`);
      let outcome: PushSendOutcome;
      if (this.invalidTokens.has(m.to)) outcome = { kind: 'invalid-token' };
      else if (this.errorTokens.has(m.to)) outcome = { kind: 'error', message: 'dev-error' };
      else outcome = { kind: 'ok' };
      outcomesByToken.set(m.to, outcome);
    }
    return { outcomesByToken };
  }

  clear(): void {
    this.captured.length = 0;
  }
}
