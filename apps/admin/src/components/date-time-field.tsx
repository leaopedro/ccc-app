'use client';

import { format, parse } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useEffect, useRef, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTE_OPTIONS = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));

// Date + time inputs that write a single combined "YYYY-MM-DDTHH:MM" string
// into a hidden field so the server action keeps reading one value. Calendar
// popover uses react-day-picker. Time is two selects rather than a native
// <input type="time">: Chrome formats that one from the browser UI locale
// (ignoring lang), so an en-US browser rendered 12h AM/PM here.
export const DateTimeField = ({
  name,
  label,
  defaultValue,
  required = false,
}: {
  name: string;
  label: string;
  defaultValue: string; // "YYYY-MM-DDTHH:MM"
  required?: boolean;
}) => {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const datePart = value.split('T')[0] ?? '';
  const timePart = value.split('T')[1] ?? '19:00';
  const [hourPart = '19', minutePart = '00'] = timePart.split(':');
  // An existing event may sit off the 5-minute grid; keep its minute selectable
  // so opening the form never silently rounds the saved time.
  const minuteOptions = MINUTE_OPTIONS.includes(minutePart)
    ? MINUTE_OPTIONS
    : [...MINUTE_OPTIONS, minutePart].sort();

  const selected = datePart ? parse(datePart, 'yyyy-MM-dd', new Date()) : undefined;
  const displayLabel = selected
    ? format(selected, "d 'de' MMMM 'de' y", { locale: ptBR })
    : 'Escolher data';

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const selectClass =
    'rounded border border-[color:var(--color-border)] bg-transparent px-2 py-2 tabular-nums';

  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm text-[color:var(--color-muted)]">{label}</span>
      <div ref={rootRef} className="relative flex gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex-1 rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2 text-left"
        >
          {displayLabel}
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <select
            aria-label={`${label}: hora`}
            value={hourPart}
            onChange={(e) => setValue(`${datePart}T${e.target.value}:${minutePart}`)}
            className={selectClass}
          >
            {HOUR_OPTIONS.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
          <span aria-hidden="true" className="text-[color:var(--color-muted)]">
            :
          </span>
          <select
            aria-label={`${label}: minuto`}
            value={minutePart}
            onChange={(e) => setValue(`${datePart}T${hourPart}:${e.target.value}`)}
            className={selectClass}
          >
            {minuteOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        {open ? (
          <div className="absolute left-0 top-full z-10 mt-1 rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-2 shadow-lg">
            <DayPicker
              mode="single"
              locale={ptBR}
              selected={selected}
              onSelect={(d) => {
                if (!d) return;
                setValue(`${format(d, 'yyyy-MM-dd')}T${timePart}`);
                setOpen(false);
              }}
            />
          </div>
        ) : null}
      </div>
      <input type="hidden" name={name} value={value} required={required} />
    </div>
  );
};
