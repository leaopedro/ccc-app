'use client';

import { useState } from 'react';

import { presignBoxImageAction } from '~/lib/box-admin-actions';

type Kind = 'box_item' | 'partner_logo' | 'partner_module';

export const BoxImageUploader = ({
  kind,
  name,
  initialKey,
  initialUrl,
}: {
  kind: Kind;
  name: string;
  initialKey: string | null;
  initialUrl: string | null;
}) => {
  const [objectKey, setObjectKey] = useState<string | null>(initialKey);
  const [previewUrl, setPreviewUrl] = useState<string | null>(initialUrl);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Formato invalido.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const presign = await presignBoxImageAction(kind, {
        contentType: file.type,
        size: file.size,
      });
      const put = await fetch(presign.uploadUrl, {
        method: 'PUT',
        headers: presign.headers,
        body: file,
      });
      if (!put.ok) throw new Error(`PUT ${put.status}`);
      setObjectKey(presign.objectKey);
      setPreviewUrl(presign.publicUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha no upload.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm text-[color:var(--color-muted)]">Imagem</span>
      {previewUrl ? (
        <img src={previewUrl} alt="preview" className="h-24 w-auto rounded object-cover" />
      ) : null}
      <input
        type="file"
        accept="image/*"
        disabled={busy}
        onChange={(e) => {
          void onChange(e);
        }}
      />
      <input type="hidden" name={name} value={objectKey ?? ''} />
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
    </div>
  );
};
