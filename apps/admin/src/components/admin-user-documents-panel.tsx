'use client';

import type { AdminUserDetailDocument } from '@ccc/shared/admin';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';

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
  // The whole surface is admin-only: /admin/documents/* is requireRole('admin')
  // on the API, so an organizer's "Ver arquivo" click would just 403, and
  // showing document type/status/rejection reason to an organizer contradicts
  // the PII-gating decision already made for the panel below it.
  if (!isAdmin) return null;
  return (
    <div>
      <h2 className="mb-2 text-lg font-semibold">Documento de identidade</h2>
      {documents.length === 0 ? (
        <p className="text-sm text-[color:var(--color-muted)]">Nenhum documento enviado.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {documents.map((d) => (
            <DocumentCard key={d.id} userId={userId} doc={d} isAdmin={isAdmin} />
          ))}
        </div>
      )}
    </div>
  );
}

function DocumentCard({
  userId,
  doc,
  isAdmin,
}: {
  userId: string;
  doc: AdminUserDetailDocument;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState(doc.status);
  const [reviewedAt, setReviewedAt] = useState(doc.reviewedAt);
  const [rejectionReason, setRejectionReason] = useState(doc.rejectionReason);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  // React's isPending flips asynchronously, so two clicks fired back-to-back
  // (double-click) can both pass the `disabled={isPending}` check before the
  // first re-render lands. This ref is set synchronously, closing that gap:
  // the second click bails out before ever calling the server action, so we
  // never race the API's guarded updateMany into a spurious 409.
  const submittingRef = useRef(false);

  const handleViewFile = () => {
    setFileError(null);
    setIsLoadingFile(true);
    // window.open must be called synchronously, inside the click's user-gesture
    // task, or the browser silently blocks the popup: a Server Action always
    // round-trips over the network (Next.js docs, mutating-data.md: "You can
    // call them from the client through a network request"), so by the time
    // the awaited result below comes back we are no longer inside that
    // gesture window. Open a blank tab now and point it at the file URL once
    // we have it. `tab.opener = null` replaces the `noopener` feature string
    // here, since passing `noopener` to window.open makes it return null,
    // which would leave nothing to navigate later.
    const tab = window.open();
    if (tab) tab.opener = null;
    void (async () => {
      const result = await getAdminDocumentFileUrlAction(doc.id);
      setIsLoadingFile(false);
      if (result.ok) {
        if (tab) {
          tab.location.href = result.url;
        } else {
          setFileError('Não foi possível abrir uma nova aba. Verifique o bloqueador de pop-ups.');
        }
      } else {
        tab?.close();
        setFileError(result.error);
      }
    })();
  };

  const handleApprove = () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const result = await approveAdminDocumentAction(userId, doc.id);
        if (result.ok) {
          setStatus(result.status);
          setReviewedAt(result.reviewedAt);
          setRejectionReason(result.rejectionReason);
          router.refresh();
        } else {
          setError(result.error);
        }
      } finally {
        submittingRef.current = false;
      }
    });
  };

  const handleReject = () => {
    if (!reason.trim()) {
      setError('Informe o motivo da rejeição.');
      return;
    }
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const result = await rejectAdminDocumentAction(userId, doc.id, reason);
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
      } finally {
        submittingRef.current = false;
      }
    });
  };

  return (
    <div className="rounded border border-[color:var(--color-border)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{documentTypeLabel[doc.type] ?? doc.type}</span>
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
          <div className="text-sm">{fmtDate(doc.sentAt)}</div>
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
