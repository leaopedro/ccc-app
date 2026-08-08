'use client';

import type { AdminUserDetailDocument } from '@ccc/shared/admin';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  approveAdminDocumentAction,
  getAdminDocumentFileUrlAction,
  rejectAdminDocumentAction,
} from '~/lib/admin-document-actions';

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

const documentTypeLabel: Record<string, string> = {
  cnh: 'CNH',
  rg: 'RG',
};

const documentStatusLabel: Record<string, string> = {
  pending: 'Pendente',
  approved: 'Aprovado',
  rejected: 'Rejeitado',
};

const inputCls =
  'w-full rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2 py-1.5 text-sm text-[color:var(--color-fg)]';

interface PanelProps {
  userId: string;
  documents: AdminUserDetailDocument[];
  isAdmin: boolean;
}

export function AdminUserDocumentsPanel({ userId, documents, isAdmin }: PanelProps) {
  return (
    <div>
      <h2 className="mb-2 text-lg font-semibold">Documento de identidade</h2>
      {documents.length === 0 ? (
        <p className="text-sm text-[color:var(--color-muted)]">Nenhum documento enviado.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {documents.map((doc) => (
            <DocumentCard key={doc.id} userId={userId} document={doc} isAdmin={isAdmin} />
          ))}
        </div>
      )}
    </div>
  );
}

function DocumentCard({
  userId,
  document,
  isAdmin,
}: {
  userId: string;
  document: AdminUserDetailDocument;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState(document.status);
  const [reviewedAt, setReviewedAt] = useState(document.reviewedAt);
  const [rejectionReason, setRejectionReason] = useState(document.rejectionReason);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isLoadingFile, setIsLoadingFile] = useState(false);

  const handleViewFile = () => {
    setFileError(null);
    setIsLoadingFile(true);
    void (async () => {
      const result = await getAdminDocumentFileUrlAction(document.id);
      setIsLoadingFile(false);
      if (result.ok) {
        window.open(result.url, '_blank', 'noopener,noreferrer');
      } else {
        setFileError(result.error);
      }
    })();
  };

  const handleApprove = () => {
    setError(null);
    startTransition(async () => {
      const result = await approveAdminDocumentAction(userId, document.id);
      if (result.ok) {
        setStatus(result.status);
        setReviewedAt(result.reviewedAt);
        setRejectionReason(result.rejectionReason);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  };

  const handleReject = () => {
    if (!reason.trim()) {
      setError('Informe o motivo da rejeição.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await rejectAdminDocumentAction(userId, document.id, reason);
      if (result.ok) {
        setStatus(result.status);
        setReviewedAt(result.reviewedAt);
        setRejectionReason(result.rejectionReason);
        setRejecting(false);
        setReason('');
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <div className="rounded border border-[color:var(--color-border)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">
            {documentTypeLabel[document.type] ?? document.type}
          </span>
          <span className="rounded bg-[color:var(--color-border)] px-2 py-0.5 text-xs font-semibold">
            {documentStatusLabel[status] ?? status}
          </span>
        </div>
        <button
          type="button"
          onClick={handleViewFile}
          disabled={isLoadingFile}
          className="rounded border border-[color:var(--color-border)] px-3 py-1.5 text-sm hover:bg-[color:var(--color-border)] disabled:opacity-50"
        >
          {isLoadingFile ? '...' : 'Ver arquivo'}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <div className="text-xs text-[color:var(--color-muted)]">Enviado em</div>
          <div className="text-sm">{fmtDate(document.sentAt)}</div>
        </div>
        <div>
          <div className="text-xs text-[color:var(--color-muted)]">Revisado em</div>
          <div className="text-sm">{reviewedAt ? fmtDate(reviewedAt) : '—'}</div>
        </div>
      </div>

      {rejectionReason ? (
        <p className="mt-3 text-sm text-red-400">Motivo da rejeição: {rejectionReason}</p>
      ) : null}

      {fileError ? (
        <p role="alert" className="mt-3 text-sm text-red-400">
          {fileError}
        </p>
      ) : null}

      {isAdmin && status === 'pending' ? (
        <div className="mt-3 flex flex-col gap-2">
          {error ? (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          ) : null}

          {rejecting ? (
            <div className="flex flex-col gap-2">
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={200}
                rows={2}
                placeholder="Motivo da rejeição"
                aria-label="motivo da rejeição"
                className={inputCls}
                disabled={isPending}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleReject}
                  disabled={isPending || !reason.trim()}
                  className="rounded bg-red-800 px-3 py-1.5 text-sm font-semibold text-red-50 disabled:opacity-50"
                >
                  {isPending ? '...' : 'Confirmar rejeição'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRejecting(false);
                    setReason('');
                    setError(null);
                  }}
                  disabled={isPending}
                  className="rounded border border-[color:var(--color-border)] px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleApprove}
                disabled={isPending}
                className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-emerald-50 hover:bg-emerald-600 disabled:opacity-50"
              >
                {isPending ? '...' : 'Aprovar'}
              </button>
              <button
                type="button"
                onClick={() => setRejecting(true)}
                disabled={isPending}
                className="rounded bg-red-800 px-3 py-1.5 text-sm font-semibold text-red-50 hover:bg-red-700 disabled:opacity-50"
              >
                Rejeitar
              </button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
