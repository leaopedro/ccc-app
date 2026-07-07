import { describe, expect, it } from 'vitest';

import { DevPushSender } from '../../src/services/push/dev.js';

describe('DevPushSender', () => {
  it('captures messages and reports ok for every token', async () => {
    const sender = new DevPushSender();
    const result = await sender.send([
      { to: 'ExponentPushToken[a]', title: 't1', body: 'b1' },
      { to: 'ExponentPushToken[b]', title: 't2', body: 'b2', data: { x: 1 } },
    ]);
    expect(sender.captured).toHaveLength(2);
    expect(sender.captured[0]?.title).toBe('t1');
    expect(result.outcomesByToken.get('ExponentPushToken[a]')).toEqual({ kind: 'ok' });
    expect(result.outcomesByToken.get('ExponentPushToken[b]')).toEqual({ kind: 'ok' });
  });

  it('marks pre-configured invalid tokens', async () => {
    const sender = new DevPushSender();
    sender.markInvalid('ExponentPushToken[bad]');
    const result = await sender.send([
      { to: 'ExponentPushToken[bad]', title: 't', body: 'b' },
      { to: 'ExponentPushToken[good]', title: 't', body: 'b' },
    ]);
    expect(result.outcomesByToken.get('ExponentPushToken[bad]')).toEqual({
      kind: 'invalid-token',
    });
    expect(result.outcomesByToken.get('ExponentPushToken[good]')).toEqual({ kind: 'ok' });
  });

  it('clear() empties capture buffer', async () => {
    const sender = new DevPushSender();
    await sender.send([{ to: 'ExponentPushToken[a]', title: 't', body: 'b' }]);
    sender.clear();
    expect(sender.captured).toHaveLength(0);
  });
});
