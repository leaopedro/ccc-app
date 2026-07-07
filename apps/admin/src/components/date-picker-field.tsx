'use client';

import { format, parse } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useEffect, useRef, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';

export function DatePickerField({
  value,
  onChange,
  placeholder = 'Escolher data',
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = value ? parse(value, 'yyyy-MM-dd', new Date()) : undefined;
  const displayLabel = selected ? format(selected, 'dd/MM/yyyy', { locale: ptBR }) : placeholder;

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-xs text-left min-w-[7rem] ${
          value ? 'text-[color:var(--color-fg)]' : 'text-[color:var(--color-muted)]'
        }`}
      >
        {displayLabel}
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-20 mt-1 rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-2 shadow-lg">
          <DayPicker
            mode="single"
            locale={ptBR}
            selected={selected}
            onSelect={(d) => {
              if (!d) {
                onChange(null);
              } else {
                onChange(format(d, 'yyyy-MM-dd'));
              }
              setOpen(false);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
