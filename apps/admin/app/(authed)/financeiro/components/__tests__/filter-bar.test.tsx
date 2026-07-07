// @vitest-environment jsdom
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FilterBar } from '../filter-bar';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

const baseFilters = {
  from: null,
  to: null,
  provider: null,
  method: null,
  search: null,
  eventId: null,
  kind: null,
  cadence: null,
  tier: null,
  membershipStatus: null,
};

describe('FilterBar — kind dropdown + membership sub-filters (chunk 15)', () => {
  it('renders kind dropdown with default "Todos" selected', async () => {
    await act(async () => {
      root.render(
        <FilterBar
          filters={baseFilters}
          events={[]}
          onFilterChange={vi.fn()}
          onClear={vi.fn()}
          isPending={false}
        />,
      );
      await Promise.resolve();
    });
    const kindSelect = document.querySelector(
      '[aria-label="Tipo de receita"]',
    ) as HTMLSelectElement;
    expect(kindSelect).not.toBeNull();
    expect(kindSelect.value).toBe('all');
  });

  it('membership sub-filters are hidden when kind is null', async () => {
    await act(async () => {
      root.render(
        <FilterBar
          filters={baseFilters}
          events={[]}
          onFilterChange={vi.fn()}
          onClear={vi.fn()}
          isPending={false}
        />,
      );
      await Promise.resolve();
    });
    expect(document.querySelector('[aria-label="Cadência"]')).toBeNull();
    expect(document.querySelector('[aria-label="Plano"]')).toBeNull();
    expect(document.querySelector('[aria-label="Status"]')).toBeNull();
  });

  it('membership sub-filters are hidden when kind is "tickets"', async () => {
    await act(async () => {
      root.render(
        <FilterBar
          filters={{ ...baseFilters, kind: 'tickets' }}
          events={[]}
          onFilterChange={vi.fn()}
          onClear={vi.fn()}
          isPending={false}
        />,
      );
      await Promise.resolve();
    });
    expect(document.querySelector('[aria-label="Cadência"]')).toBeNull();
  });

  it('membership sub-filters are hidden when kind is "store"', async () => {
    await act(async () => {
      root.render(
        <FilterBar
          filters={{ ...baseFilters, kind: 'store' }}
          events={[]}
          onFilterChange={vi.fn()}
          onClear={vi.fn()}
          isPending={false}
        />,
      );
      await Promise.resolve();
    });
    expect(document.querySelector('[aria-label="Cadência"]')).toBeNull();
  });

  it('membership sub-filters appear when kind is "membership"', async () => {
    await act(async () => {
      root.render(
        <FilterBar
          filters={{ ...baseFilters, kind: 'membership' }}
          events={[]}
          onFilterChange={vi.fn()}
          onClear={vi.fn()}
          isPending={false}
        />,
      );
      await Promise.resolve();
    });
    expect(document.querySelector('[aria-label="Cadência"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="Plano"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="Status"]')).not.toBeNull();
  });

  it('cadence sub-filter calls onFilterChange with correct value', async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <FilterBar
          filters={{ ...baseFilters, kind: 'membership' }}
          events={[]}
          onFilterChange={onChange}
          onClear={vi.fn()}
          isPending={false}
        />,
      );
      await Promise.resolve();
    });
    const cadenceSelect = document.querySelector('[aria-label="Cadência"]') as HTMLSelectElement;
    await act(async () => {
      cadenceSelect.value = 'monthly';
      cadenceSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    expect(onChange).toHaveBeenCalledWith('cadence', 'monthly');
  });

  it('selecting "all" cadence calls onFilterChange with null', async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <FilterBar
          filters={{ ...baseFilters, kind: 'membership', cadence: 'monthly' }}
          events={[]}
          onFilterChange={onChange}
          onClear={vi.fn()}
          isPending={false}
        />,
      );
      await Promise.resolve();
    });
    const cadenceSelect = document.querySelector('[aria-label="Cadência"]') as HTMLSelectElement;
    await act(async () => {
      cadenceSelect.value = 'all';
      cadenceSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    expect(onChange).toHaveBeenCalledWith('cadence', null);
  });

  it('tier sub-filter calls onFilterChange("tier", "gold")', async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <FilterBar
          filters={{ ...baseFilters, kind: 'membership' }}
          events={[]}
          onFilterChange={onChange}
          onClear={vi.fn()}
          isPending={false}
        />,
      );
      await Promise.resolve();
    });
    const tierSelect = document.querySelector('[aria-label="Plano"]') as HTMLSelectElement;
    await act(async () => {
      tierSelect.value = 'gold';
      tierSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    expect(onChange).toHaveBeenCalledWith('tier', 'gold');
  });

  it('membershipStatus sub-filter calls onFilterChange("membershipStatus", "active")', async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <FilterBar
          filters={{ ...baseFilters, kind: 'membership' }}
          events={[]}
          onFilterChange={onChange}
          onClear={vi.fn()}
          isPending={false}
        />,
      );
      await Promise.resolve();
    });
    const statusSelect = document.querySelector('[aria-label="Status"]') as HTMLSelectElement;
    await act(async () => {
      statusSelect.value = 'active';
      statusSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    expect(onChange).toHaveBeenCalledWith('membershipStatus', 'active');
  });

  it('kind dropdown calls onFilterChange("kind", "membership")', async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <FilterBar
          filters={baseFilters}
          events={[]}
          onFilterChange={onChange}
          onClear={vi.fn()}
          isPending={false}
        />,
      );
      await Promise.resolve();
    });
    const kindSelect = document.querySelector(
      '[aria-label="Tipo de receita"]',
    ) as HTMLSelectElement;
    await act(async () => {
      kindSelect.value = 'membership';
      kindSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    expect(onChange).toHaveBeenCalledWith('kind', 'membership');
  });

  it('kind dropdown calls onFilterChange("kind", null) when "all" selected', async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <FilterBar
          filters={{ ...baseFilters, kind: 'membership' }}
          events={[]}
          onFilterChange={onChange}
          onClear={vi.fn()}
          isPending={false}
        />,
      );
      await Promise.resolve();
    });
    const kindSelect = document.querySelector(
      '[aria-label="Tipo de receita"]',
    ) as HTMLSelectElement;
    await act(async () => {
      kindSelect.value = 'all';
      kindSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    expect(onChange).toHaveBeenCalledWith('kind', null);
  });
});
