// Display masks for CPF and phone text inputs. Pure and total: any string
// input, never throws. The form keeps the masked string for display, but
// must submit digits only (what cpfSchema/phoneSchema normalize to anyway),
// so every caller pairs mask*() for onChangeText with unmask*() for submit.

const onlyDigits = (input: string): string =>
  (typeof input === 'string' ? input : '').replace(/\D/g, '');

export const unmaskCpf = (value: string): string => onlyDigits(value).slice(0, 11);

export const maskCpf = (digits: string): string => {
  const d = unmaskCpf(digits);
  if (d.length === 0) return '';
  const part1 = d.slice(0, 3);
  const part2 = d.slice(3, 6);
  const part3 = d.slice(6, 9);
  const part4 = d.slice(9, 11);
  let out = part1;
  if (part2) out += `.${part2}`;
  if (part3) out += `.${part3}`;
  if (part4) out += `-${part4}`;
  return out;
};

export const unmaskPhone = (value: string): string => onlyDigits(value).slice(0, 11);

export const maskPhone = (digits: string): string => {
  const d = unmaskPhone(digits);
  if (d.length === 0) return '';
  // No closing paren until a 3rd digit exists. Closing it at exactly 2
  // digits (`(11)`) creates a backspace trap: unmasking `(11)` and
  // `(11` both yield the same 2 digits, so re-masking always re-adds the
  // paren and the field can never be cleared past that point.
  if (d.length <= 2) return `(${d}`;
  const ddd = d.slice(0, 2);
  const rest = d.slice(2);
  // 11 total digits is a mobile number (5-digit subscriber block), 10 or
  // fewer is a landline (4-digit block). Recomputed on every keystroke so
  // the split shifts naturally when the 11th digit is typed.
  const splitLen = d.length >= 11 ? 5 : 4;
  const first = rest.slice(0, splitLen);
  const last = rest.slice(splitLen);
  return last.length > 0 ? `(${ddd}) ${first}-${last}` : `(${ddd}) ${first}`;
};
