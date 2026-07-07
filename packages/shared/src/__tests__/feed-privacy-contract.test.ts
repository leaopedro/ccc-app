import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { FEED_FORBIDDEN_RESPONSE_KEYS, FEED_PUBLIC_RESPONSE_SCHEMAS } from '../feed.js';

// Recursively walk a Zod schema and return every property key it declares.
function collectKeys(schema: z.ZodTypeAny, seen = new Set<z.ZodTypeAny>()): string[] {
  if (seen.has(schema)) return [];
  seen.add(schema);

  const def = (schema as { _def: { typeName: string } })._def;

  switch (def.typeName) {
    case 'ZodObject': {
      const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
      const own = Object.keys(shape);
      const nested = own.flatMap((k) => {
        const field = shape[k];
        return field ? collectKeys(field, seen) : [];
      });
      return [...own, ...nested];
    }
    case 'ZodArray':
      return collectKeys((schema as z.ZodArray<z.ZodTypeAny>).element, seen);
    case 'ZodNullable':
    case 'ZodOptional':
    case 'ZodDefault':
      return collectKeys((schema as z.ZodNullable<z.ZodTypeAny>).unwrap(), seen);
    case 'ZodUnion':
    case 'ZodDiscriminatedUnion': {
      const options = (schema as z.ZodUnion<[z.ZodTypeAny, ...z.ZodTypeAny[]]>).options;
      return options.flatMap((o) => collectKeys(o, seen));
    }
    case 'ZodIntersection': {
      const { left, right } = (schema as z.ZodIntersection<z.ZodTypeAny, z.ZodTypeAny>)._def;
      return [...collectKeys(left, seen), ...collectKeys(right, seen)];
    }
    case 'ZodRecord':
      return collectKeys((schema as z.ZodRecord)._def.valueType, seen);
    case 'ZodTuple': {
      const items = (schema as z.ZodTuple<[z.ZodTypeAny, ...z.ZodTypeAny[]]>).items;
      return items.flatMap((o: z.ZodTypeAny) => collectKeys(o, seen));
    }
    case 'ZodLazy':
      return collectKeys((schema as z.ZodLazy<z.ZodTypeAny>)._def.getter(), seen);
    default:
      return [];
  }
}

describe('feed privacy contract', () => {
  it('every public feed response schema is enumerable', () => {
    expect(Object.keys(FEED_PUBLIC_RESPONSE_SCHEMAS).length).toBeGreaterThan(0);
  });

  it.each(Object.entries(FEED_PUBLIC_RESPONSE_SCHEMAS))(
    'schema %s declares no forbidden response key',
    (_name, schema) => {
      const keys = collectKeys(schema);
      const leaks = keys.filter((k) => FEED_FORBIDDEN_RESPONSE_KEYS.has(k));
      expect(leaks).toEqual([]);
    },
  );

  it('strips forbidden keys when extra data is fed in', () => {
    const dirty = {
      id: 'car_1',
      make: 'Nissan',
      model: 'Skyline',
      year: 1999,
      nickname: null,
      modifications: [],
      photo: null,
      isPremiumActive: false,
      plate: 'ABC-1234',
      ownerId: 'usr_1',
      email: 'leak@example.com',
      phone: '+5511999999999',
      cpf: '00000000000',
      userId: 'usr_2',
      address: 'Av. Paulista, 1000',
    };
    const parsed = FEED_PUBLIC_RESPONSE_SCHEMAS.publicCarProfile.parse(dirty);
    const parsedKeys = Object.keys(parsed as object);
    for (const forbidden of FEED_FORBIDDEN_RESPONSE_KEYS) {
      expect(parsedKeys).not.toContain(forbidden);
    }
  });

  it('forbidden key set matches the issue brief exactly', () => {
    expect(new Set(FEED_FORBIDDEN_RESPONSE_KEYS)).toEqual(
      new Set(['plate', 'email', 'phone', 'cpf', 'userId', 'ownerId', 'address']),
    );
  });
});
