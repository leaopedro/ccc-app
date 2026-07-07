declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type UserId = Brand<string, 'UserId'>;
export type EventId = Brand<string, 'EventId'>;
export type TicketId = Brand<string, 'TicketId'>;
export type OrderId = Brand<string, 'OrderId'>;

const assertNonEmpty = (value: string, label: string): void => {
  if (value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
};

export const userId = (value: string): UserId => {
  assertNonEmpty(value, 'UserId');
  return value as UserId;
};

export const eventId = (value: string): EventId => {
  assertNonEmpty(value, 'EventId');
  return value as EventId;
};

export const ticketId = (value: string): TicketId => {
  assertNonEmpty(value, 'TicketId');
  return value as TicketId;
};

export const orderId = (value: string): OrderId => {
  assertNonEmpty(value, 'OrderId');
  return value as OrderId;
};
