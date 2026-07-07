import { describe, expect, it } from 'vitest';

import { dropRiskyConsoleBreadcrumbs } from '../../src/lib/sentry-breadcrumb-filter.js';

describe('dropRiskyConsoleBreadcrumbs', () => {
  it('keeps non-console breadcrumbs regardless of content', () => {
    const crumbs = [
      { category: 'http', message: 'user@example.com', type: 'default' },
      { category: 'navigation', message: 'x'.repeat(300), type: 'default' },
    ];
    expect(dropRiskyConsoleBreadcrumbs(crumbs)).toHaveLength(2);
  });

  it('keeps short safe console breadcrumbs', () => {
    const crumbs = [{ category: 'console', message: 'app started', type: 'default' }];
    expect(dropRiskyConsoleBreadcrumbs(crumbs)).toHaveLength(1);
  });

  it('drops console breadcrumb with message longer than 200 chars', () => {
    const crumbs = [{ category: 'console', message: 'x'.repeat(201), type: 'default' }];
    expect(dropRiskyConsoleBreadcrumbs(crumbs)).toHaveLength(0);
  });

  it('drops console breadcrumb whose message contains an email', () => {
    const crumbs = [
      { category: 'console', message: 'logged in user@example.com', type: 'default' },
    ];
    expect(dropRiskyConsoleBreadcrumbs(crumbs)).toHaveLength(0);
  });

  it('drops console breadcrumb whose message contains a formatted CPF', () => {
    const crumbs = [
      { category: 'console', message: 'document 123.456.789-01 submitted', type: 'default' },
    ];
    expect(dropRiskyConsoleBreadcrumbs(crumbs)).toHaveLength(0);
  });

  it('drops console breadcrumb when data.arguments contains an email object', () => {
    const crumbs = [
      {
        category: 'console',
        message: '',
        type: 'default',
        data: { arguments: [{ email: 'user@example.com', id: 42 }] },
      },
    ];
    expect(dropRiskyConsoleBreadcrumbs(crumbs)).toHaveLength(0);
  });

  it('drops console breadcrumb when data.arguments serialized length exceeds 200', () => {
    const crumbs = [
      {
        category: 'console',
        message: '',
        type: 'default',
        data: { arguments: ['x'.repeat(201)] },
      },
    ];
    expect(dropRiskyConsoleBreadcrumbs(crumbs)).toHaveLength(0);
  });

  it('keeps console breadcrumb when data.arguments is short and clean', () => {
    const crumbs = [
      {
        category: 'console',
        message: 'cart updated',
        type: 'default',
        data: { arguments: ['cart updated', { itemCount: 3 }] },
      },
    ];
    expect(dropRiskyConsoleBreadcrumbs(crumbs)).toHaveLength(1);
  });

  it('keeps breadcrumb when data.arguments contain a circular object (no throw)', () => {
    const circular: Record<string, unknown> = { label: 'safe' };
    circular['self'] = circular;
    const crumbs = [
      {
        category: 'console',
        message: 'render',
        type: 'default',
        data: { arguments: [circular] },
      },
    ];
    expect(() => dropRiskyConsoleBreadcrumbs(crumbs)).not.toThrow();
    expect(dropRiskyConsoleBreadcrumbs(crumbs)).toHaveLength(1);
  });

  it('keeps breadcrumb when data.arguments contain a BigInt (no throw)', () => {
    const crumbs = [
      {
        category: 'console',
        message: 'id',
        type: 'default',
        data: { arguments: [BigInt(12345)] },
      },
    ];
    expect(() => dropRiskyConsoleBreadcrumbs(crumbs)).not.toThrow();
    expect(dropRiskyConsoleBreadcrumbs(crumbs)).toHaveLength(1);
  });

  it('mixed batch: drops only risky breadcrumbs', () => {
    const crumbs = [
      { category: 'console', message: 'safe log', type: 'default' },
      { category: 'console', message: 'contact admin@corp.com', type: 'default' },
      { category: 'http', message: 'POST /api/tickets', type: 'default' },
      { category: 'console', message: 'x'.repeat(201), type: 'default' },
    ];
    const result = dropRiskyConsoleBreadcrumbs(crumbs);
    expect(result).toHaveLength(2);
    expect(result[0]?.message).toBe('safe log');
    expect(result[1]?.category).toBe('http');
  });
});
