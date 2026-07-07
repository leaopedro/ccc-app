export const toNumber = (v: FormDataEntryValue | null): number =>
  v == null || v === '' ? NaN : Number(v);

// HTML datetime-local returns "YYYY-MM-DDTHH:MM" which Zod's datetime()
// rejects; round-trip through Date to get a full ISO string.
export const toIso = (v: FormDataEntryValue | null): string => {
  if (typeof v !== 'string' || v === '') return '';
  return new Date(v).toISOString();
};
