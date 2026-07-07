import { describe, expect, it } from 'vitest';

import { DevMailer } from '../../src/services/mailer/dev.js';

describe('DevMailer', () => {
  it('captures sent mail in memory', async () => {
    const mailer = new DevMailer();
    await mailer.send({ to: 'a@b.co', subject: 'Hi', html: '<p>hello</p>' });
    expect(mailer.captured).toHaveLength(1);
    expect(mailer.captured[0]).toMatchObject({ to: 'a@b.co', subject: 'Hi' });
  });

  it('can be reset', async () => {
    const mailer = new DevMailer();
    await mailer.send({ to: 'a@b.co', subject: 'x', html: 'y' });
    mailer.clear();
    expect(mailer.captured).toHaveLength(0);
  });

  it('find() returns the most recent match', async () => {
    const mailer = new DevMailer();
    await mailer.send({ to: 'a@b.co', subject: 'first', html: '' });
    await mailer.send({ to: 'a@b.co', subject: 'second', html: '' });
    expect(mailer.find('a@b.co')?.subject).toBe('second');
  });
});
