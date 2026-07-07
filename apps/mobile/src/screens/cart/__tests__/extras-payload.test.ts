import { describe, expect, it } from 'vitest';

interface CartItemTicket {
  carId?: string;
  licensePlate?: string;
  extras: string[];
}

function buildExtrasTogglePayload(tickets: CartItemTicket[], extraId: string): CartItemTicket[] {
  return tickets.map((ticket) => {
    const isSelected = ticket.extras.includes(extraId);
    const extras = isSelected
      ? ticket.extras.filter((id) => id !== extraId)
      : [...ticket.extras, extraId];
    return { ...ticket, extras };
  });
}

describe('buildExtrasTogglePayload', () => {
  it('adds extra while preserving carId and licensePlate', () => {
    const tickets: CartItemTicket[] = [
      { carId: 'car-1', licensePlate: 'ABC-1D23', extras: ['extra-a'] },
    ];
    const result = buildExtrasTogglePayload(tickets, 'extra-b');
    expect(result).toEqual([
      { carId: 'car-1', licensePlate: 'ABC-1D23', extras: ['extra-a', 'extra-b'] },
    ]);
  });

  it('removes extra while preserving carId and licensePlate', () => {
    const tickets: CartItemTicket[] = [
      { carId: 'car-1', licensePlate: 'ABC-1D23', extras: ['extra-a', 'extra-b'] },
    ];
    const result = buildExtrasTogglePayload(tickets, 'extra-a');
    expect(result).toEqual([{ carId: 'car-1', licensePlate: 'ABC-1D23', extras: ['extra-b'] }]);
  });

  it('handles multi-ticket carts', () => {
    const tickets: CartItemTicket[] = [
      { carId: 'car-1', licensePlate: 'ABC-1D23', extras: [] },
      { carId: 'car-2', licensePlate: 'DEF-4G56', extras: ['extra-a'] },
    ];
    const result = buildExtrasTogglePayload(tickets, 'extra-b');
    expect(result).toEqual([
      { carId: 'car-1', licensePlate: 'ABC-1D23', extras: ['extra-b'] },
      { carId: 'car-2', licensePlate: 'DEF-4G56', extras: ['extra-a', 'extra-b'] },
    ]);
  });

  it('preserves tickets without car fields', () => {
    const tickets: CartItemTicket[] = [{ extras: ['extra-a'] }];
    const result = buildExtrasTogglePayload(tickets, 'extra-a');
    expect(result).toEqual([{ extras: [] }]);
  });

  it('does not mutate original ticket objects', () => {
    const original: CartItemTicket[] = [
      { carId: 'car-1', licensePlate: 'XYZ-9A87', extras: ['extra-a'] },
    ];
    const originalExtras = original[0]!.extras;
    buildExtrasTogglePayload(original, 'extra-b');
    expect(original[0]!.extras).toBe(originalExtras);
    expect(original[0]!.extras).toEqual(['extra-a']);
  });
});
