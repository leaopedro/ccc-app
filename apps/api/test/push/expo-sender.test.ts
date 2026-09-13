import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock('expo-server-sdk', () => {
  class Expo {
    static isExpoPushToken(token: string): boolean {
      return /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token);
    }
    chunkPushNotifications(messages: unknown[]): unknown[][] {
      return [messages];
    }
    sendPushNotificationsAsync = mocks.send;
  }
  return { Expo };
});

const { ExpoPushSender } = await import('../../src/services/push/expo.js');

const TOKEN = 'ExponentPushToken[real-device]';
const send = () => new ExpoPushSender().send([{ to: TOKEN, title: 't', body: 'b' }]);

describe('ExpoPushSender outcome mapping', () => {
  beforeEach(() => {
    mocks.send.mockReset();
  });

  it('maps DeviceNotRegistered to invalid-token', async () => {
    mocks.send.mockResolvedValue([
      { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } },
    ]);
    const result = await send();
    expect(result.outcomesByToken.get(TOKEN)).toEqual({ kind: 'invalid-token' });
  });

  // InvalidCredentials is a property of the PROJECT's APNs/FCM credentials, not
  // of the token. Reporting it as invalid-token makes both callers delete a
  // perfectly good DeviceToken row, so one missing push key wipes the install
  // base. It must surface as an error so the send is retried and recorded.
  it('maps InvalidCredentials to error, not invalid-token', async () => {
    mocks.send.mockResolvedValue([
      { status: 'error', message: 'no valid push key', details: { error: 'InvalidCredentials' } },
    ]);
    const result = await send();
    expect(result.outcomesByToken.get(TOKEN)).toEqual({
      kind: 'error',
      message: 'no valid push key',
    });
  });

  it('maps ok tickets to ok', async () => {
    mocks.send.mockResolvedValue([{ status: 'ok', id: 'x' }]);
    const result = await send();
    expect(result.outcomesByToken.get(TOKEN)).toEqual({ kind: 'ok' });
  });
});
