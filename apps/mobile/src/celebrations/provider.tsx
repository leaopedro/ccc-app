import { BadgeCelebration } from '@ccc/ui';
import { isCelebrationHeld, subscribeCelebrationHold } from '@ccc/ui/celebration-hold';
import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, AppState, Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ackCelebrations, getMyBadges, listCelebrations } from '~/api/garage';
import { useAuth } from '~/auth/context';
import { badgesCopy } from '~/copy/badges';
import { captureException } from '~/lib/sentry';

import { resolveEntries, type ResolveResult } from './queue';
import { subscribeCelebrationRefresh } from './refresh-bus';

// Cinco minutos, não sessenta segundos. Com o gatilho de escrita no lugar, o
// timer só cobre check-in e grant de admin. Um timer global de 60s seriam 1440
// requisições por usuário por dia para um evento que acontece meia dúzia de
// vezes na vida de uma conta.
const POLL_INTERVAL_MS = 5 * 60_000;

export const BadgeCelebrationProvider = ({ children }: { children: ReactNode }) => {
  const { status } = useAuth();
  const authed = status === 'authenticated';
  const insets = useSafeAreaInsets();

  const [queue, setQueue] = useState<ResolveResult['entries']>([]);
  const [held, setHeld] = useState(() => isCelebrationHeld());
  const [reduceMotion, setReduceMotion] = useState(false);

  // Bloqueia GET concorrente. Sem isto, dois pushes seguidos disparam dois
  // GETs e o segundo resolve DEPOIS do ack, ressuscitando a conquista que o
  // usuário acabou de fechar.
  const inFlight = useRef(false);
  // Códigos já acked NESTE ciclo de app. Filtra toda resposta, inclusive a de
  // um GET que já estava em voo quando o ack saiu. Também é o que impede o
  // loop quando o POST de ack falha: o ack é 20/min e o GET é 60/min, então
  // sem isto uma conexão ruim vira overlay de tela cheia a cada tick, sem
  // auto-dismiss e sem como desligar.
  const ackedLocally = useRef<Set<string>>(new Set());
  const visibleRef = useRef(false);
  visibleRef.current = queue.length > 0;

  const refresh = useCallback(async () => {
    if (!authed || inFlight.current) return;
    // Com o overlay na tela, refazer o fetch só reiniciaria a animação por
    // baixo do usuário: o ack só sai no fechamento, então a lista é a mesma.
    if (visibleRef.current) return;
    inFlight.current = true;
    try {
      const res = await listCelebrations();
      if (!res.enabled || res.pending.length === 0) return;

      let catalog = null;
      try {
        const badges = await getMyBadges();
        catalog = badges.enabled ? badges.catalog : null;
      } catch (err) {
        captureException(err, 'celebrations.catalog');
        catalog = null;
      }

      const pending = res.pending.filter((p) => !ackedLocally.current.has(p.code));
      const resolved = resolveEntries(pending, catalog, badgesCopy.badges.catalog);
      if (!resolved.resolvable) return;

      if (resolved.ackOnly.length > 0) {
        for (const code of resolved.ackOnly) ackedLocally.current.add(code);
        void ackCelebrations(resolved.ackOnly).catch((err) =>
          captureException(err, 'celebrations.ack-unknown'),
        );
      }
      if (resolved.entries.length > 0) setQueue(resolved.entries);
    } catch (err) {
      captureException(err, 'celebrations.fetch');
    } finally {
      inFlight.current = false;
    }
  }, [authed]);

  // Ack no FECHAMENTO, não na abertura. Se o app morrer no meio da animação,
  // ela volta na próxima abertura. Repetir é melhor que perder.
  const close = useCallback(() => {
    const codes = queue.map((e) => e.code);
    setQueue([]);
    for (const code of codes) ackedLocally.current.add(code);
    if (codes.length > 0) {
      void ackCelebrations(codes).catch((err) => captureException(err, 'celebrations.ack'));
    }
  }, [queue]);

  useEffect(() => subscribeCelebrationHold(setHeld), []);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  useEffect(() => {
    if (!authed) return;
    void refresh();

    const offBus = subscribeCelebrationRefresh(() => void refresh());
    const appSub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refresh();
    });
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);

    // Na web `addNotificationReceivedListener` é um stub que só avisa no
    // console. Guarda explícita, igual a `use-push-open-handler.ts:22`.
    const pushSub =
      Platform.OS === 'web'
        ? null
        : Notifications.addNotificationReceivedListener(() => void refresh());

    return () => {
      offBus();
      appSub.remove();
      clearInterval(timer);
      pushSub?.remove();
    };
  }, [authed, refresh]);

  // Buscar pode a qualquer momento; EXIBIR é que espera o hold.
  const show = queue.length > 0 && !held;

  return (
    <View style={{ flex: 1 }}>
      {children}
      {show ? (
        <BadgeCelebration
          entries={queue}
          copy={{
            titleOne: badgesCopy.badges.celebration.titleOne,
            titleMany: badgesCopy.badges.celebration.titleMany,
            close: badgesCopy.badges.celebration.close,
            more: badgesCopy.badges.celebration.more,
          }}
          onClose={close}
          reduceMotion={reduceMotion}
          insetBottom={insets.bottom}
        />
      ) : null}
    </View>
  );
};
