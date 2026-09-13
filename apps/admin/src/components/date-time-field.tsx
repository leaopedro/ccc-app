'use client';

import { format, parse } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useEffect, useRef, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';

// Date + time inputs that write a single combined "YYYY-MM-DDTHH:MM" string
// into a hidden field so the server action keeps reading one value. Calendar
// popover uses react-day-picker. Time is a masked text input instead of the
// native <input type="time">: Chrome formats that one from the browser UI
// locale (ignoring lang), so an en-US browser rendered 12h AM/PM here.
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
  const [timeText, setTimeText] = useState(timePart);
  const selected = datePart ? parse(datePart, 'yyyy-MM-dd', new Date()) : undefined;
  const displayLabel = selected
    ? format(selected, "d 'de' MMMM 'de' y", { locale: ptBR })
    : 'Escolher data';

  // Keep at most 4 digits and drop a ":" in after the hour pair.
  const onTimeChange = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 4);
    setTimeText(digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits);
  };

  // Clamp to 24h on blur, or fall back to the last committed time.
  const commitTime = () => {
    const digits = timeText.replace(/\D/g, '');
    if (digits.length !== 4) {
      setTimeText(timePart);
      return;
    }
    const hours = Math.min(23, Number(digits.slice(0, 2)));
    const minutes = Math.min(59, Number(digits.slice(2)));
    const next = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    setTimeText(next);
    setValue(`${datePart}T${next}`);
  };

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

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
        <input
          type="text"
          inputMode="numeric"
          maxLength={5}
          placeholder="HH:MM"
          aria-label={`${label}: horário`}
          value={timeText}
          onChange={(e) => onTimeChange(e.target.value)}
          onBlur={commitTime}
          className="w-24 shrink-0 rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2 tabular-nums"
        />
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
