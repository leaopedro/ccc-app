'use client';

import { format, parse } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useEffect, useRef, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';

// Date + time inputs that write a single combined "YYYY-MM-DDTHH:MM" string
// into a hidden field so the server action keeps reading one value. Calendar
// popover uses react-day-picker; time uses the native <input type="time">.
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
          type="time"
          value={timePart}
          onChange={(e) => setValue(`${datePart}T${e.target.value}`)}
          className="w-28 rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
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
