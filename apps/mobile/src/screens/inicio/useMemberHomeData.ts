// Hook agregador da home do membro logado (task-11).
//
// Junta seis fontes independentes com um useState por fonte, nunca
// Promise.all: a falha de uma nunca cancela nem esconde as outras. Cada
// fonte carrega uma vez na montagem, em paralelo (cada `load*` dispara sem
// esperar as demais).
//
// Fase 2 — getBox(): só é chamado depois que `getGarage()` responde com
// `garage.garage.isPremiumActive` verdadeiro. Chamar para quem não é
// assinante gera 4xx previsível e ruído no Sentry (ver brief). O gate lê
// `garage.data`, que é estado do useState (identidade estável entre
// renders, só muda quando o fetch de fato resolve) — nunca um literal novo
// por render, que reprisaria o loop do task-9.
//
// Nenhuma chamada a captureException aqui: falha de leitura esperada vira
// estado (`error: true`), igual ao padrão de useHomeContent/useClubStats e
// do welcome.tsx atual — não é reportada como exceção.

import { useCallback, useEffect, useRef, useState } from 'react';

import type { BoxView } from '@ccc/shared/box';
import type { EventSummary } from '@ccc/shared/events';
import type { PublicProfile } from '@ccc/shared/profile';
import type { MyTicket } from '@ccc/shared/tickets';

import { getBox } from '~/api/box';
import { listEvents } from '~/api/events';
import { getGarage, type GarageReadResponse } from '~/api/garage';
import { getPremiumStatus, type PremiumStatusResponse } from '~/api/premium';
import { getProfile } from '~/api/profile';
import { listMyTickets } from '~/api/tickets';

export type SourceState<T> = {
  data: T | null;
  loading: boolean;
  error: boolean;
};

const initialSource = <T>(): SourceState<T> => ({ data: null, loading: true, error: false });

// Hoisted to module scope. Building this inline in the hook body would give
// it a fresh identity every render; passed into a dependency array that
// would re-fire the effect every render, exactly the task-9 loop trap.
const NEXT_EVENT_QUERY = { window: 'upcoming' as const, limit: 1 };

export type MemberHomeData = {
  profile: SourceState<PublicProfile>;
  nextEvent: SourceState<EventSummary>;
  tickets: SourceState<MyTicket[]>;
  garage: SourceState<GarageReadResponse>;
  premium: SourceState<PremiumStatusResponse>;
  box: SourceState<BoxView>;
  refreshAll: () => Promise<void>;
};

export function useMemberHomeData(): MemberHomeData {
  const [profile, setProfile] = useState<SourceState<PublicProfile>>(initialSource);
  const [nextEvent, setNextEvent] = useState<SourceState<EventSummary>>(initialSource);
  const [tickets, setTickets] = useState<SourceState<MyTicket[]>>(initialSource);
  const [garage, setGarage] = useState<SourceState<GarageReadResponse>>(initialSource);
  const [premium, setPremium] = useState<SourceState<PremiumStatusResponse>>(initialSource);
  const [box, setBox] = useState<SourceState<BoxView>>(initialSource);

  // Guards the box phase so it fires at most once per premium-eligible
  // garage response, never again on unrelated re-renders.
  const boxRequestedRef = useRef(false);

  const loadProfile = useCallback(async () => {
    setProfile((s) => ({ ...s, loading: true, error: false }));
    try {
      const data = await getProfile();
      setProfile({ data, loading: false, error: false });
    } catch {
      setProfile({ data: null, loading: false, error: true });
    }
  }, []);

  const loadNextEvent = useCallback(async () => {
    setNextEvent((s) => ({ ...s, loading: true, error: false }));
    try {
      const res = await listEvents(NEXT_EVENT_QUERY);
      setNextEvent({ data: res.items[0] ?? null, loading: false, error: false });
    } catch {
      setNextEvent({ data: null, loading: false, error: true });
    }
  }, []);

  const loadTickets = useCallback(async () => {
    setTickets((s) => ({ ...s, loading: true, error: false }));
    try {
      const res = await listMyTickets();
      setTickets({ data: res.items, loading: false, error: false });
    } catch {
      setTickets({ data: null, loading: false, error: true });
    }
  }, []);

  const loadGarage = useCallback(async () => {
    setGarage((s) => ({ ...s, loading: true, error: false }));
    try {
      const data = await getGarage();
      setGarage({ data, loading: false, error: false });
    } catch {
      setGarage({ data: null, loading: false, error: true });
    }
  }, []);

  const loadPremium = useCallback(async () => {
    setPremium((s) => ({ ...s, loading: true, error: false }));
    try {
      const data = await getPremiumStatus();
      setPremium({ data, loading: false, error: false });
    } catch {
      setPremium({ data: null, loading: false, error: true });
    }
  }, []);

  const loadBox = useCallback(async () => {
    setBox((s) => ({ ...s, loading: true, error: false }));
    try {
      const data = await getBox();
      setBox({ data, loading: false, error: false });
    } catch {
      setBox({ data: null, loading: false, error: true });
    }
  }, []);

  // Phase 1: five independent sources, fired once on mount. Each `load*` has
  // an empty dependency array (no captured value ever changes identity), so
  // this effect's own dependency array is the five stable callbacks — it
  // runs exactly once.
  useEffect(() => {
    void loadProfile();
    void loadNextEvent();
    void loadTickets();
    void loadGarage();
    void loadPremium();
  }, [loadProfile, loadNextEvent, loadTickets, loadGarage, loadPremium]);

  // Phase 2: getBox() only once garage confirms isPremiumActive. `garage`
  // (the useState value, read via the outer closure) only changes identity
  // when loadGarage's setGarage actually resolves, so this does not loop.
  //
  // Fix round 1 (Important 4 + Minor 5). Two things this effect must do
  // that the original version did not:
  //
  // 1. Wait for `garage.loading` to be false before reading the gate at
  //    all. Without this, `refreshAll()` resetting `boxRequestedRef` to
  //    false races the fresh `getGarage()` call: `loadGarage`'s own
  //    `setGarage((s) => ({ ...s, loading: true }))` preserves the STALE
  //    `data` while flipping `loading` to true, so reading the gate at
  //    that instant would fire `getBox()` off the previous (possibly
  //    lapsed) premium flag. Bailing while `garage.loading` is true means
  //    the gate is only ever read once garage has actually settled with
  //    fresh data.
  // 2. Resolve `box` out of its initial `loading: true` state on the
  //    negative branch (non-premium, or garage failed). Without this,
  //    `box.loading` stays true forever for a non-subscriber — the
  //    `MemberHomeData` contract would then be lying to any future
  //    consumer that renders a skeleton on `box.loading`, even though
  //    `getBox()` is deliberately never going to be called for them.
  useEffect(() => {
    if (garage.loading) return;
    if (boxRequestedRef.current) return;
    if (garage.data?.garage.isPremiumActive) {
      boxRequestedRef.current = true;
      void loadBox();
    } else {
      setBox((s) => (s.loading ? { data: null, loading: false, error: false } : s));
    }
  }, [garage, loadBox]);

  const refreshAll = useCallback(async () => {
    boxRequestedRef.current = false;
    await Promise.allSettled([
      loadProfile(),
      loadNextEvent(),
      loadTickets(),
      loadGarage(),
      loadPremium(),
    ]);
  }, [loadProfile, loadNextEvent, loadTickets, loadGarage, loadPremium]);

  return { profile, nextEvent, tickets, garage, premium, box, refreshAll };
}
