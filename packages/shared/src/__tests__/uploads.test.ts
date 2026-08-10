import { describe, expect, it } from 'vitest';

import { presignRequestSchema } from '../uploads.js';

describe('uploads kinds - box builder', () => {
  it('accepts box_item, partner_logo, partner_module', () => {
    for (const kind of ['box_item', 'partner_logo', 'partner_module'] as const) {
      const parsed = presignRequestSchema.safeParse({
        kind,
        contentType: 'image/jpeg',
        size: 1024,
      });
      expect(parsed.success).toBe(true);
    }
  });
});
