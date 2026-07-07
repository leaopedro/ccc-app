'use client';

import type { AdminStoreProductPhoto } from '@jdm/shared/admin';
import { useState, useTransition } from 'react';

import { addProductPhotoAction, removeProductPhotoAction } from '~/lib/store-actions';
import { presignProductPhotoAction } from '~/lib/upload-actions';

export const PhotoGallery = ({
  productId,
  photos,
}: {
  productId: string;
  photos: AdminStoreProductPhoto[];
}) => {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Formato inválido.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const presign = await presignProductPhotoAction({
        contentType: file.type,
        size: file.size,
      });
      const put = await fetch(presign.uploadUrl, {
        method: 'PUT',
        headers: presign.headers,
        body: file,
      });
      if (!put.ok) throw new Error(`PUT ${put.status}`);
      const nextSort = photos.length;
      const result = await addProductPhotoAction(productId, {
        objectKey: presign.objectKey,
        sortOrder: nextSort,
      });
      if (result.error) setError(result.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha no upload.');
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  };

  const onRemove = (photoId: string) => {
    startTransition(() => {
      void removeProductPhotoAction(productId, photoId).then((res) => {
        if (res.error) setError(res.error);
      });
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Fotos</h2>
      <div className="flex flex-wrap gap-3">
        {photos.map((photo) => (
          <figure
            key={photo.id}
            className="flex flex-col items-center gap-1 rounded border border-[color:var(--color-border)] p-2"
          >
            <img
              src={photo.url}
              alt={`Foto do produto (${photo.sortOrder + 1})`}
              className="h-32 w-32 rounded object-cover"
            />
            <button
              type="button"
              onClick={() => {
                onRemove(photo.id);
              }}
              className="rounded border border-[color:var(--color-border)] px-2 py-0.5 text-xs"
            >
              Remover
            </button>
          </figure>
        ))}
        {photos.length === 0 ? (
          <p className="text-sm text-[color:var(--color-muted)]">Nenhuma foto ainda.</p>
        ) : null}
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-sm text-[color:var(--color-muted)]">Adicionar foto</span>
        <input
          type="file"
          accept="image/*"
          disabled={busy}
          onChange={(e) => {
            void onUpload(e);
          }}
        />
      </label>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
    </div>
  );
};
