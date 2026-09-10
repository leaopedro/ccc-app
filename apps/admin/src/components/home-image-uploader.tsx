'use client';

import { useState } from 'react';

import { presignHomeImageAction } from '~/lib/home-content-actions';

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

export const HomeImageUploader = ({
  label,
  removeLabel,
  objectKey,
  previewUrl,
  onChange,
}: {
  label: string;
  removeLabel: string;
  objectKey: string | null;
  previewUrl: string | null;
  onChange: (next: { objectKey: string | null; previewUrl: string | null }) => void;
}) => {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) {
      setError('Formato inválido. Use JPG, PNG ou WebP.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const presign = await presignHomeImageAction({ contentType: file.type, size: file.size });
      const put = await fetch(presign.uploadUrl, {
        method: 'PUT',
        headers: presign.headers,
        body: file,
      });
      if (!put.ok) throw new Error(`PUT ${put.status}`);
      onChange({ objectKey: presign.objectKey, previewUrl: presign.publicUrl });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha no upload.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm text-[color:var(--color-muted)]">{label}</span>
      {previewUrl ? (
        <img src={previewUrl} alt={label} className="h-24 w-auto rounded object-cover" />
      ) : null}
      <input
        type="file"
        accept="image/*"
        aria-label={label}
        disabled={busy}
        onChange={(e) => {
          void onFile(e);
        }}
      />
      {objectKey ? (
        <button
          type="button"
          className="self-start text-sm underline"
          onClick={() => onChange({ objectKey: null, previewUrl: null })}
        >
          {removeLabel}
        </button>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
};
