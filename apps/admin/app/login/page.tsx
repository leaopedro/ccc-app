'use client';

import { useState } from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { brand } from '~/brand';
import {
  loginAction,
  mfaVerifyAction,
  mfaRecoveryAction,
  type LoginState,
} from '~/lib/auth-actions';

const initial: LoginState = { error: null };

const SubmitButton = ({ label, pendingLabel }: { label: string; pendingLabel: string }) => {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-[color:var(--color-accent)] px-4 py-2 font-semibold disabled:opacity-50"
    >
      {pending ? pendingLabel : label}
    </button>
  );
};

const LoginForm = ({ onMfaRequired }: { onMfaRequired: (mfaToken: string) => void }) => {
  const [state, formAction] = useActionState(async (prev: LoginState, formData: FormData) => {
    const result = await loginAction(prev, formData);
    if (result.mfaToken) {
      onMfaRequired(result.mfaToken);
    }
    return result;
  }, initial);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-sm text-[color:var(--color-muted)]">Email</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm text-[color:var(--color-muted)]">Senha</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
        />
      </label>
      {state.error ? <p className="text-sm text-red-400">{state.error}</p> : null}
      <SubmitButton label="Entrar" pendingLabel="Entrando…" />
    </form>
  );
};

const MfaForm = ({ mfaToken }: { mfaToken: string }) => {
  const [useRecovery, setUseRecovery] = useState(false);
  const action = useRecovery ? mfaRecoveryAction : mfaVerifyAction;
  const [state, formAction] = useActionState(action, { error: null, mfaToken });

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="mfaToken" value={state.mfaToken ?? mfaToken} />
      <label className="flex flex-col gap-1">
        <span className="text-sm text-[color:var(--color-muted)]">
          {useRecovery ? 'Código de recuperação' : 'Código de autenticação'}
        </span>
        <input
          name="code"
          type="text"
          autoComplete="one-time-code"
          inputMode={useRecovery ? 'text' : 'numeric'}
          placeholder={useRecovery ? 'XXXX-XXXX-XXXX' : '000000'}
          required
          className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2 text-center font-mono text-lg tracking-widest"
        />
      </label>
      {state.error ? <p className="text-sm text-red-400">{state.error}</p> : null}
      <SubmitButton label="Verificar" pendingLabel="Verificando…" />
      <button
        type="button"
        onClick={() => setUseRecovery(!useRecovery)}
        className="text-sm text-[color:var(--color-muted)] underline"
      >
        {useRecovery ? 'Usar código do app' : 'Usar código de recuperação'}
      </button>
    </form>
  );
};

export default function LoginPage() {
  const [mfaToken, setMfaToken] = useState<string | null>(null);

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-bold">
        {mfaToken ? 'Verificação em duas etapas' : `${brand.shortName} Admin · Entrar`}
      </h1>
      {mfaToken ? <MfaForm mfaToken={mfaToken} /> : <LoginForm onMfaRequired={setMfaToken} />}
      <footer className="border-t border-[color:var(--color-border)] pt-4 text-center text-xs text-[color:var(--color-muted)]">
        <a href="/privacidade" className="underline hover:text-[color:var(--color-foreground)]">
          Política de privacidade
        </a>
        {' · '}
        <a
          href={`mailto:${brand.contact.privacyEmail}`}
          className="underline hover:text-[color:var(--color-foreground)]"
        >
          {brand.contact.privacyEmail}
        </a>
      </footer>
    </main>
  );
}
