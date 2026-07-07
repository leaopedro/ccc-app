import { Expo, type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk';

import type { PushMessage, PushSendOutcome, PushSendResult, PushSender } from './types.js';

export class ExpoPushSender implements PushSender {
  private readonly client: Expo;

  constructor(accessToken?: string) {
    this.client = new Expo(accessToken ? { accessToken } : {});
  }

  async send(messages: PushMessage[]): Promise<PushSendResult> {
    const outcomesByToken = new Map<string, PushSendOutcome>();
    const valid: ExpoPushMessage[] = [];
    for (const m of messages) {
      if (!Expo.isExpoPushToken(m.to)) {
        outcomesByToken.set(m.to, { kind: 'invalid-token' });
        continue;
      }
      valid.push({ to: m.to, title: m.title, body: m.body, data: m.data ?? {} });
    }
    const chunks = this.client.chunkPushNotifications(valid);
    for (const chunk of chunks) {
      let tickets: ExpoPushTicket[] = [];
      try {
        tickets = await this.client.sendPushNotificationsAsync(chunk);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown';
        for (const m of chunk) {
          if (typeof m.to === 'string') {
            outcomesByToken.set(m.to, { kind: 'error', message: msg });
          }
        }
        continue;
      }
      chunk.forEach((m, i) => {
        const ticket = tickets[i];
        const to = typeof m.to === 'string' ? m.to : '';
        if (!ticket || !to) return;
        if (ticket.status === 'ok') {
          outcomesByToken.set(to, { kind: 'ok' });
          return;
        }
        const detailsErr = ticket.details?.error;
        if (detailsErr === 'DeviceNotRegistered' || detailsErr === 'InvalidCredentials') {
          outcomesByToken.set(to, { kind: 'invalid-token' });
        } else {
          outcomesByToken.set(to, { kind: 'error', message: ticket.message ?? 'expo error' });
        }
      });
    }
    return { outcomesByToken };
  }
}
