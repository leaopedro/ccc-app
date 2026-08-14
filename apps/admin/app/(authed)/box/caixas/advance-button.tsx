'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { ADVANCE_LABEL } from './status-labels';

import { advanceBoxFulfillmentAction, type BoxFormState } from '~/lib/box-admin-actions';

const initial: BoxFormState = { error: null };

const Submit = ({ label }: { label: string }) => {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded border border-[color:var(--color-border)] px-2 py-1 text-xs hover:bg-[color:var(--color-border)] disabled:opacity-50"
    >
      {pending ? 'Salvando…' : label}
    </button>
  );
};

export const AdvanceButton = ({
  boxId,
  to,
}: {
  boxId: string;
  to: 'packed' | 'shipped' | 'delivered';
}) => {
  const action = advanceBoxFulfillmentAction.bind(null, boxId);
  const [state, dispatch] = useActionState(action, initial);
  return (
    <form action={dispatch} className="flex flex-col items-end gap-1">
      <input type="hidden" name="to" value={to} />
      <Submit label={ADVANCE_LABEL[to]} />
      {state.error ? <span className="text-xs text-red-400">{state.error}</span> : null}
    </form>
  );
};
