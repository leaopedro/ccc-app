'use client';

import { brand } from '@jdm/design';
import { PRIVACY_POLICY_VERSION } from '@jdm/shared/legal';
import { useCallback, useEffect, useState } from 'react';

import { recordCookieConsent } from '~/lib/consent-actions';

const STORAGE_KEY = `${brand.app.storagePrefix}_cookie_consent`;

export type StoredConsent = {
  version: string;
  analytics: boolean;
};

export function parseStoredConsent(raw: string | null): StoredConsent | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'version' in parsed &&
      'analytics' in parsed &&
      typeof (parsed as { version: unknown }).version === 'string' &&
      typeof (parsed as { analytics: unknown }).analytics === 'boolean'
    ) {
      return parsed as StoredConsent;
    }
    return null;
  } catch {
    return null;
  }
}

export function needsBanner(raw: string | null): boolean {
  const stored = parseStoredConsent(raw);
  if (!stored) return true;
  return stored.version !== PRIVACY_POLICY_VERSION;
}

export function CookieBanner() {
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [analyticsChecked, setAnalyticsChecked] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (needsBanner(raw)) setVisible(true);
  }, []);

  const persist = useCallback(async (acceptAnalytics: boolean) => {
    setSaving(true);
    try {
      await recordCookieConsent(acceptAnalytics);
      const record: StoredConsent = { version: PRIVACY_POLICY_VERSION, analytics: acceptAnalytics };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
      setVisible(false);
    } finally {
      setSaving(false);
    }
  }, []);

  const handleAcceptAll = () => {
    void persist(true);
  };
  const handleRejectNonEssential = () => {
    void persist(false);
  };
  const handleSavePreferences = () => {
    void persist(analyticsChecked);
  };

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Preferências de cookies"
      aria-modal="false"
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-gray-200 bg-white p-4 shadow-lg sm:p-6"
    >
      <div className="mx-auto max-w-5xl">
        <p className="mb-1 text-sm font-semibold text-gray-900">Cookies e privacidade</p>
        <p className="mb-4 text-sm text-gray-600">
          Usamos cookies estritamente necessários para o funcionamento do painel. Cookies analíticos
          (Sentry Session Replay) são opcionais e exigem seu consentimento. Consulte nossa{' '}
          <a href="/privacidade" className="underline" target="_blank" rel="noopener noreferrer">
            Política de Privacidade
          </a>
          .
        </p>

        {expanded && (
          <div className="mb-4 rounded border border-gray-100 bg-gray-50 p-3">
            <fieldset>
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Categorias
              </legend>
              <div className="flex items-start gap-2">
                <input type="checkbox" disabled checked readOnly id="cookie-necessary" />
                <label htmlFor="cookie-necessary" className="text-sm text-gray-700">
                  <span className="font-medium">Estritamente necessários</span> — sessão, CSRF
                  (sempre ativos)
                </label>
              </div>
              <div className="mt-2 flex items-start gap-2">
                <input
                  type="checkbox"
                  id="cookie-analytics"
                  checked={analyticsChecked}
                  onChange={(e) => setAnalyticsChecked(e.target.checked)}
                />
                <label htmlFor="cookie-analytics" className="text-sm text-gray-700">
                  <span className="font-medium">Analíticos</span> — Sentry Session Replay
                </label>
              </div>
            </fieldset>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleRejectNonEssential}
            disabled={saving}
            className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            Rejeitar não essenciais
          </button>
          <button
            type="button"
            onClick={handleAcceptAll}
            disabled={saving}
            className="rounded border border-gray-700 bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60"
          >
            Aceitar tudo
          </button>
          {expanded ? (
            <button
              type="button"
              onClick={handleSavePreferences}
              disabled={saving}
              className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              Salvar preferências
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="px-4 py-2 text-sm text-gray-500 underline hover:text-gray-700"
            >
              Gerenciar preferências
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
