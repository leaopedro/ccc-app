// JDM Experience — Garagem · Badges (Conquistas)
// Gamification layer. Hex emblems with mono codes, 3 rarity tiers,
// 4 categories. Earned + locked states. Reusable in owner + public
// surfaces and in the dedicated drawer.
//
// CONTRACT — badges are awarded by the API, never derived client-side.
// This file defines the *visual* + *placement* system only. Earned
// state comes from `GarageOwner.badges` or `GaragePublic.badges`
// (allowlist-strict for public — see HANDOFF.md §11).

const { useState: badgesUseState, useMemo: badgesUseMemo } = React;

// ─────────────────────────────────────────────────────────────
// Badge catalog — server-controlled list. Client renders the
// visual; titles + descriptions could move to copy/badges.ts.
// ─────────────────────────────────────────────────────────────

const BADGE_CATALOG = [
  // EVENTOS
  {
    code: 'EVT-001',
    category: 'eventos',
    rarity: 'common',
    title: 'Primeiro Evento',
    sub: 'Foi no primeiro encontro.',
    criteria: 'Compareça a 1 evento.',
    icon: 'flag',
  },
  {
    code: 'EVT-002',
    category: 'eventos',
    rarity: 'rare',
    title: 'Sequência de 3',
    sub: 'Três encontros em sequência.',
    criteria: '3 eventos consecutivos.',
    icon: 'streak',
  },
  {
    code: 'EVT-003',
    category: 'eventos',
    rarity: 'legendary',
    title: 'Veterano',
    sub: 'Dez encontros documentados.',
    criteria: '10 eventos no total.',
    icon: 'medal',
  },
  // CARROS
  {
    code: 'CAR-001',
    category: 'carros',
    rarity: 'common',
    title: 'Primeiro Motor',
    sub: 'Cadastrou o primeiro carro.',
    criteria: 'Cadastre 1 carro.',
    icon: 'car',
  },
  {
    code: 'CAR-002',
    category: 'carros',
    rarity: 'rare',
    title: 'Garagem Cheia',
    sub: 'Preencheu todas as vagas grátis.',
    criteria: 'Preencha o limite grátis.',
    icon: 'garageFull',
  },
  {
    code: 'CAR-003',
    category: 'carros',
    rarity: 'legendary',
    title: 'Curador',
    sub: 'Coleção com cinco ou mais carros.',
    criteria: '5 carros cadastrados.',
    icon: 'curator',
  },
  // COMUNIDADE
  {
    code: 'COM-001',
    category: 'comunidade',
    rarity: 'common',
    title: 'Primeiro Post',
    sub: 'Publicou no feed de um evento.',
    criteria: 'Publique 1 post.',
    icon: 'post',
  },
  {
    code: 'COM-002',
    category: 'comunidade',
    rarity: 'rare',
    title: 'Iniciador',
    sub: 'Post com 10+ respostas.',
    criteria: 'Receba 10 comentários.',
    icon: 'chat',
  },
  {
    code: 'COM-003',
    category: 'comunidade',
    rarity: 'legendary',
    title: 'Volta Famosa',
    sub: 'Post com 50+ curtidas.',
    criteria: '50 curtidas em 1 post.',
    icon: 'fire',
  },
  // JDM
  {
    code: 'JDM-001',
    category: 'jdm',
    rarity: 'common',
    title: 'Curitibano',
    sub: 'Participou de um encontro em Curitiba.',
    criteria: '1 evento em Curitiba.',
    icon: 'pin',
  },
  {
    code: 'JDM-002',
    category: 'jdm',
    rarity: 'rare',
    title: 'Pista',
    sub: 'Participou de um track day.',
    criteria: '1 track day.',
    icon: 'flagCheck',
  },
  {
    code: 'JDM-003',
    category: 'jdm',
    rarity: 'legendary',
    title: 'Fundador',
    sub: 'Entrou antes do lançamento público.',
    criteria: 'Conta criada antes de 01/06/2026.',
    icon: 'founder',
  },
];

// Owner's earned set — sample data only. Shape mirrors GaragePublic.badges[]:
// { code, earnedAt }. For *owner*, also include `pinned: boolean` so they
// can mark up to 3 badges as featured on the public profile.
const SAMPLE_EARNED = [
  { code: 'EVT-001', earnedAt: '2026-02-14T19:00:00Z', pinned: true },
  { code: 'EVT-002', earnedAt: '2026-04-22T19:00:00Z', pinned: true },
  { code: 'CAR-001', earnedAt: '2026-02-10T11:30:00Z', pinned: false },
  { code: 'CAR-002', earnedAt: '2026-03-18T22:00:00Z', pinned: false },
  { code: 'COM-001', earnedAt: '2026-02-15T20:15:00Z', pinned: false },
  { code: 'JDM-001', earnedAt: '2026-02-14T19:00:00Z', pinned: true },
];

// ─────────────────────────────────────────────────────────────
// Helpers — rarity / category color tables
// ─────────────────────────────────────────────────────────────

function rarityColors(rarity) {
  if (rarity === 'legendary')
    return {
      main: JDM.brand,
      deep: JDM.brandDeep,
      tint: JDM.brandTint,
      fg: '#fff',
      label: 'Lendário',
    };
  if (rarity === 'rare')
    return { main: JDM.gold, deep: JDM.goldDeep, tint: JDM.goldTint, fg: '#0A0A0A', label: 'Raro' };
  return {
    main: JDM.silverDeep,
    deep: '#5C5F66',
    tint: 'rgba(214,216,220,0.08)',
    fg: JDM.textSec,
    label: 'Comum',
  };
}

function categoryMeta(category) {
  if (category === 'eventos') return { label: 'Eventos', accent: JDM.brand };
  if (category === 'carros') return { label: 'Carros', accent: JDM.gold };
  if (category === 'comunidade') return { label: 'Comunidade', accent: JDM.paintAdmin };
  if (category === 'jdm') return { label: 'JDM', accent: JDM.silver };
  return { label: '—', accent: JDM.textMut };
}

// ─────────────────────────────────────────────────────────────
// Badge glyphs — minimal SVG icons (don't overdraw)
// ─────────────────────────────────────────────────────────────

const BadgeGlyph = {
  flag: ({ s = 18 }) => (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 22V4" />
      <path d="M4 4h13l-2 4 2 4H4" />
    </svg>
  ),
  streak: ({ s = 18 }) => (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="6" cy="6" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
      <path d="M7.5 7.5l3 3M13.5 13.5l3 3" />
    </svg>
  ),
  medal: ({ s = 18 }) => (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="15" r="6" />
      <path d="M9 9 6 2h4l3 6" />
      <path d="m15 9 3-7h-4l-3 6" />
      <path d="M12 12v6" />
    </svg>
  ),
  car: ({ s = 18 }) => (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2" />
      <circle cx="7" cy="17" r="2" />
      <circle cx="17" cy="17" r="2" />
    </svg>
  ),
  garageFull: ({ s = 18 }) => (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 21V9l9-6 9 6v12" />
      <path d="M3 21h18" />
      <rect x="6" y="13" width="5" height="8" />
      <rect x="13" y="13" width="5" height="8" />
    </svg>
  ),
  curator: ({ s = 18 }) => (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="6" width="5" height="14" />
      <rect x="9.5" y="3" width="5" height="17" />
      <rect x="16" y="9" width="5" height="11" />
    </svg>
  ),
  post: ({ s = 18 }) => (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 5h18v12H7l-4 4z" />
    </svg>
  ),
  chat: ({ s = 18 }) => (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </svg>
  ),
  fire: ({ s = 18 }) => (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  ),
  pin: ({ s = 18 }) => (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  ),
  flagCheck: ({ s = 18 }) => (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 22V4" />
      <path d="M4 4h6v6H4z" />
      <path d="M10 4h6v6h-6z" fill="currentColor" stroke="none" />
      <path d="M4 10h6v6H4z" fill="currentColor" stroke="none" />
      <path d="M10 10h6v6h-6z" />
    </svg>
  ),
  founder: ({ s = 18 }) => (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2 4 6v6c0 5 3.5 9.5 8 10 4.5-.5 8-5 8-10V6Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  ),
  lock: ({ s = 18 }) => (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="18" height="11" x="3" y="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  ),
};

// ─────────────────────────────────────────────────────────────
// HexBadge — the canonical visual primitive. Flat-top hexagon
// with a rarity-tinted ring + center glyph + mono code chip.
// Sizes: sm (32) · md (52) · lg (96).
// ─────────────────────────────────────────────────────────────

function HexBadge({ code, earned = false, size = 'md', onPress, showLabel = false }) {
  const entry = BADGE_CATALOG.find((b) => b.code === code);
  if (!entry) return null;
  const r = rarityColors(entry.rarity);
  const dim = { sm: 32, md: 52, lg: 96 }[size];
  const ringW = { sm: 1.25, md: 1.5, lg: 2 }[size];
  const iconSize = { sm: 14, md: 22, lg: 38 }[size];
  const Glyph = BadgeGlyph[entry.icon] || BadgeGlyph.medal;
  const hexClip = 'polygon(25% 5%, 75% 5%, 100% 50%, 75% 95%, 25% 95%, 0% 50%)';

  const content = (
    <>
      {/* outer hex shell */}
      <div
        style={{
          width: dim,
          height: dim,
          position: 'relative',
          filter: earned ? 'none' : 'grayscale(1)',
        }}
      >
        {/* ring (slightly larger via padding) */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            clipPath: hexClip,
            background: earned ? r.main : 'transparent',
            opacity: earned ? 1 : 0.6,
          }}
        />
        {/* inner fill — sits one stroke inside */}
        <div
          style={{
            position: 'absolute',
            inset: ringW,
            clipPath: hexClip,
            background: earned ? JDM.surface : JDM.surfaceAlt,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* rarity tint plate */}
          {earned ? (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                clipPath: hexClip,
                background: `radial-gradient(60% 60% at 50% 60%, ${r.tint}, transparent 75%)`,
              }}
            />
          ) : (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                clipPath: hexClip,
                background:
                  'repeating-linear-gradient(135deg, rgba(255,255,255,0.025) 0 4px, transparent 4px 9px)',
              }}
            />
          )}
          {/* glyph */}
          <div
            style={{
              position: 'relative',
              color: earned ? r.main : JDM.textMut,
              opacity: earned ? 1 : 0.55,
            }}
          >
            {earned ? <Glyph s={iconSize} /> : <BadgeGlyph.lock s={iconSize} />}
          </div>
          {/* rarity star at top-right for legendary earned */}
          {earned && entry.rarity === 'legendary' && size !== 'sm' ? (
            <div
              style={{
                position: 'absolute',
                top: size === 'lg' ? 14 : 4,
                right: size === 'lg' ? 14 : 4,
                width: size === 'lg' ? 12 : 8,
                height: size === 'lg' ? 12 : 8,
                borderRadius: 999,
                background: r.main,
                boxShadow: `0 0 8px ${r.main}`,
              }}
            />
          ) : null}
        </div>
      </div>

      {/* label + code stack */}
      {showLabel ? (
        <div
          style={{
            marginTop: 6,
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2,
          }}
        >
          <span
            style={{
              fontFamily: JDM.fontSans,
              fontWeight: 700,
              fontSize: 11,
              color: earned ? JDM.text : JDM.textMut,
              lineHeight: 1.2,
              maxWidth: dim + 28,
              textWrap: 'pretty',
            }}
          >
            {entry.title}
          </span>
          <span
            style={{
              fontFamily: JDM.fontMono,
              fontSize: 9,
              color: JDM.textMut,
              letterSpacing: 0.6,
            }}
          >
            {entry.code}
          </span>
        </div>
      ) : null}
    </>
  );

  if (!onPress) {
    return (
      <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
        {content}
      </div>
    );
  }
  return (
    <button
      onClick={onPress}
      style={{
        all: 'unset',
        cursor: 'pointer',
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
      aria-label={`Conquista ${entry.title}${earned ? ', desbloqueada' : ', bloqueada'}`}
    >
      {content}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// BadgeRow — featured row. Owner sees their pinned/recent;
// public sees only pinned. Trailing "+N" chip opens drawer.
// ─────────────────────────────────────────────────────────────

function BadgeRow({ earned, isOwner, onOpenSheet, onBadgeTap }) {
  const totalEarned = earned.length;
  const totalCatalog = BADGE_CATALOG.length;
  // Show 4 pinned/recent if owner, 3 pinned only if public.
  const featured = isOwner ? earned.slice(0, 4) : earned.filter((e) => e.pinned).slice(0, 3);
  const more = Math.max(0, totalEarned - featured.length);

  return (
    <div
      style={{
        margin: '12px 16px 0',
        padding: '12px 12px 10px',
        background: JDM.surface,
        border: `1px solid ${JDM.border}`,
        borderRadius: 14,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span
            style={{
              fontFamily: JDM.fontSans,
              fontWeight: 700,
              fontSize: 13,
              color: JDM.text,
              letterSpacing: -0.1,
            }}
          >
            Conquistas
          </span>
          <span
            style={{
              fontFamily: JDM.fontMono,
              fontSize: 11,
              color: JDM.textMut,
            }}
          >
            {totalEarned}/{totalCatalog}
          </span>
        </div>
        <button
          onClick={onOpenSheet}
          style={{
            all: 'unset',
            cursor: 'pointer',
            fontFamily: JDM.fontSans,
            fontSize: 12,
            fontWeight: 600,
            color: JDM.brandSoft,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
          }}
        >
          Ver todas <Icon.ChevronRight s={12} />
        </button>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 14,
          overflowX: 'auto',
          overflowY: 'hidden',
          paddingBottom: 2,
        }}
        className="jdm-hscroll"
      >
        {featured.map((e) => (
          <HexBadge
            key={e.code}
            code={e.code}
            earned
            size="md"
            onPress={() => onBadgeTap && onBadgeTap(e.code)}
            showLabel
          />
        ))}
        {more > 0 ? (
          <button
            onClick={onOpenSheet}
            style={{
              all: 'unset',
              cursor: 'pointer',
              display: 'inline-flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              width: 52,
              height: 52,
              borderRadius: 8,
              border: `1px dashed ${JDM.border}`,
              background: JDM.surfaceDeep,
              color: JDM.textSec,
              fontFamily: JDM.fontSans,
              fontWeight: 700,
              fontSize: 13,
              alignSelf: 'flex-start',
            }}
          >
            +{more}
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// BadgesSheet — drawer with grid + category tabs + tap-to-detail.
// Drilldown lives inline (header swaps to "back" affordance).
// ─────────────────────────────────────────────────────────────

function BadgesSheet({ earned, garageName, isOwner, onClose }) {
  const [tab, setTab] = badgesUseState('all');
  const [detail, setDetail] = badgesUseState(null);
  const tabs = [
    { id: 'all', label: 'Todas' },
    { id: 'eventos', label: 'Eventos' },
    { id: 'carros', label: 'Carros' },
    { id: 'comunidade', label: 'Comunidade' },
    { id: 'jdm', label: 'JDM' },
  ];

  const earnedSet = badgesUseMemo(() => new Map(earned.map((e) => [e.code, e])), [earned]);
  const list = badgesUseMemo(
    () => BADGE_CATALOG.filter((b) => tab === 'all' || b.category === tab),
    [tab],
  );

  // Locked badges aren't shown for *other people's* profiles — public viewer
  // only sees a count + earned list. Owner sees all (locked + earned).
  const visibleList = isOwner ? list : list.filter((b) => earnedSet.has(b.code));

  if (detail) {
    return (
      <SheetShell title="" onClose={onClose}>
        <BadgeDetail
          code={detail}
          earnedEntry={earnedSet.get(detail)}
          isOwner={isOwner}
          onBack={() => setDetail(null)}
        />
      </SheetShell>
    );
  }

  return (
    <SheetShell
      title={isOwner ? 'Suas conquistas' : `Conquistas · ${garageName}`}
      onClose={onClose}
    >
      {/* summary */}
      <div
        style={{
          margin: '10px 16px 0',
          padding: '12px 14px',
          borderRadius: 12,
          background: JDM.surfaceDeep,
          border: `1px solid ${JDM.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div
          style={{
            fontFamily: JDM.fontDisplay,
            fontSize: 36,
            lineHeight: 1,
            color: JDM.text,
            letterSpacing: -1,
          }}
        >
          {earned.length}
          <span style={{ color: JDM.textMut, fontSize: 22 }}>/{BADGE_CATALOG.length}</span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: JDM.fontSans,
              fontWeight: 700,
              fontSize: 13,
              color: JDM.text,
            }}
          >
            {isOwner ? 'Conquistas desbloqueadas' : 'Visíveis'}
          </div>
          <div
            style={{
              fontFamily: JDM.fontSans,
              fontSize: 11.5,
              color: JDM.textMut,
              marginTop: 2,
              lineHeight: 1.4,
            }}
          >
            {isOwner
              ? 'Toque uma conquista para fixá-la na sua página pública.'
              : 'Apenas conquistas fixadas pelo dono aparecem aqui.'}
          </div>
        </div>
      </div>

      {/* tabs */}
      <div
        style={{
          margin: '12px 0 0',
          padding: '0 12px',
          display: 'flex',
          gap: 6,
          overflowX: 'auto',
          overflowY: 'hidden',
        }}
        className="jdm-hscroll"
      >
        {tabs.map((tt) => (
          <button
            key={tt.id}
            onClick={() => setTab(tt.id)}
            style={{
              all: 'unset',
              cursor: 'pointer',
              flexShrink: 0,
              padding: '7px 12px',
              borderRadius: 999,
              background: tab === tt.id ? JDM.brand : 'transparent',
              border: `1px solid ${tab === tt.id ? JDM.brand : JDM.border}`,
              color: tab === tt.id ? '#fff' : JDM.textSec,
              fontFamily: JDM.fontSans,
              fontWeight: 600,
              fontSize: 12,
            }}
          >
            {tt.label}
          </button>
        ))}
      </div>

      {/* grid */}
      <div
        style={{
          padding: '14px 16px 18px',
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 14,
        }}
      >
        {visibleList.map((b) => (
          <HexBadge
            key={b.code}
            code={b.code}
            earned={earnedSet.has(b.code)}
            size="md"
            showLabel
            onPress={() => setDetail(b.code)}
          />
        ))}
        {visibleList.length === 0 ? (
          <div
            style={{
              gridColumn: '1 / -1',
              padding: '20px 8px',
              textAlign: 'center',
              fontFamily: JDM.fontSans,
              fontSize: 12,
              color: JDM.textMut,
            }}
          >
            Nenhuma conquista nesta categoria ainda.
          </div>
        ) : null}
      </div>
    </SheetShell>
  );
}

// ─────────────────────────────────────────────────────────────
// BadgeDetail — drilldown view inside BadgesSheet.
// Earned: large hex + title + description + earned date + pin toggle.
// Locked: large hex (locked) + title + criteria + (deferred) progress bar.
// ─────────────────────────────────────────────────────────────

function BadgeDetail({ code, earnedEntry, isOwner, onBack }) {
  const entry = BADGE_CATALOG.find((b) => b.code === code);
  if (!entry) return null;
  const r = rarityColors(entry.rarity);
  const cat = categoryMeta(entry.category);
  const earned = Boolean(earnedEntry);
  const [pinned, setPinned] = badgesUseState(Boolean(earnedEntry?.pinned));
  const dt = earnedEntry?.earnedAt ? new Date(earnedEntry.earnedAt) : null;
  const earnedDateStr = dt
    ? dt.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
    : '';

  return (
    <div style={{ padding: '6px 16px 18px' }}>
      <button
        onClick={onBack}
        style={{
          all: 'unset',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 0',
          color: JDM.textSec,
          fontFamily: JDM.fontSans,
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        <Icon.Back s={14} /> Voltar
      </button>

      {/* big hex hero */}
      <div
        style={{
          marginTop: 8,
          padding: '20px 16px 18px',
          borderRadius: 16,
          background: `radial-gradient(80% 60% at 50% 35%, ${r.tint}, transparent 70%), ${JDM.surfaceDeep}`,
          border: `1px solid ${JDM.border}`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <HexBadge code={code} earned={earned} size="lg" />
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            marginTop: 2,
            padding: '3px 8px',
            borderRadius: 999,
            background: r.tint,
            color: r.main,
            border: `1px solid ${r.main}55`,
            fontFamily: JDM.fontSans,
            fontWeight: 700,
            fontSize: 10,
            letterSpacing: 1.6,
            textTransform: 'uppercase',
          }}
        >
          {r.label} · {cat.label}
        </div>
        <div
          style={{
            fontFamily: JDM.fontDisplay,
            fontSize: 30,
            lineHeight: 1,
            color: JDM.text,
            letterSpacing: -0.5,
            textAlign: 'center',
            marginTop: 2,
          }}
        >
          {entry.title}
        </div>
        <div
          style={{
            fontFamily: JDM.fontMono,
            fontSize: 11,
            color: JDM.textMut,
            letterSpacing: 0.6,
          }}
        >
          {entry.code}
        </div>
        <p
          style={{
            margin: '4px 0 0',
            fontFamily: JDM.fontSans,
            fontSize: 13,
            color: JDM.textSec,
            lineHeight: 1.5,
            textAlign: 'center',
            maxWidth: 280,
          }}
        >
          {entry.sub}
        </p>
      </div>

      {/* state row */}
      <div
        style={{
          marginTop: 12,
          padding: '10px 14px',
          borderRadius: 12,
          background: JDM.surface,
          border: `1px solid ${JDM.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: earned ? 'rgba(34,197,94,0.12)' : JDM.surfaceAlt,
            color: earned ? '#5DE08A' : JDM.textMut,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {earned ? <Icon.Check s={16} /> : <Icon.Lock s={14} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: JDM.fontSans,
              fontWeight: 700,
              fontSize: 13,
              color: JDM.text,
            }}
          >
            {earned ? `Conquistado em ${earnedDateStr}` : 'Bloqueado'}
          </div>
          <div
            style={{
              fontFamily: JDM.fontSans,
              fontSize: 12,
              color: JDM.textMut,
              marginTop: 2,
              lineHeight: 1.45,
            }}
          >
            {earned ? 'Aparece no seu perfil quando fixada.' : entry.criteria}
          </div>
        </div>
      </div>

      {/* owner-only pin control */}
      {earned && isOwner ? (
        <button
          onClick={() => setPinned(!pinned)}
          style={{
            all: 'unset',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginTop: 10,
            padding: '12px 14px',
            borderRadius: 12,
            background: pinned ? JDM.brandTint : JDM.surface,
            border: `1px solid ${pinned ? 'rgba(225,6,0,0.45)' : JDM.border}`,
            width: '100%',
            boxSizing: 'border-box',
          }}
          aria-pressed={pinned}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 14,
              background: pinned ? JDM.brand : JDM.surfaceAlt,
              color: pinned ? '#fff' : JDM.textMut,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {pinned ? <Icon.Check s={14} /> : <Icon.Plus s={14} />}
          </div>
          <div style={{ flex: 1, textAlign: 'left' }}>
            <div
              style={{ fontFamily: JDM.fontSans, fontWeight: 700, fontSize: 13, color: JDM.text }}
            >
              {pinned ? 'Fixada no perfil público' : 'Fixar no perfil público'}
            </div>
            <div
              style={{
                fontFamily: JDM.fontSans,
                fontSize: 11.5,
                color: JDM.textMut,
                marginTop: 1,
                lineHeight: 1.4,
              }}
            >
              Você pode fixar até 3 conquistas.
            </div>
          </div>
        </button>
      ) : null}
    </div>
  );
}

Object.assign(window, {
  BADGE_CATALOG,
  SAMPLE_EARNED,
  BadgeGlyph,
  HexBadge,
  BadgeRow,
  BadgesSheet,
  BadgeDetail,
  rarityColors,
  categoryMeta,
});
