// JDM Experience — Garagem · Screens
// Composes atoms into the canonical screens enumerated in the brief:
//
//   OwnerGarage         — /garage (owner view) · §1 of brief
//   PublicGarage        — /g/:slug              · §2
//   GarageEmptyWelcome  — fresh-signup empty state (UX-Audit A.1)
//   PremiumSheet        — tappable badge sheet (UX-Audit E.4)
//   CoverPickerSheet    — preset gallery + upload (new visual direction)
//   BuySpotSheet        — buy-flow preview (UX-Audit D.3 — quicker loop)
//
// Each screen is a single React component rendered inside an IOSDevice
// (392×848) by the canvas. Tweaks rerender all screens in lockstep.

const { useState, useMemo } = React;

// ─────────────────────────────────────────────────────────────
// Identity card — the floating overlay that sits on the cover.
// Mirrors LinkedIn cover/avatar pattern, but uses the garage's
// premium tier to drive the accent ring + (optional) badge.
// ─────────────────────────────────────────────────────────────

function IdentityCard({
  garage,
  carCount,
  badgeVariant,
  nearExpiry,
  daysLeft,
  isOwner,
  editing,
  onEdit,
  onShare,
  onBadgePress,
  onCoverEdit,
}) {
  const t = tierColors(garage.premiumTier);
  return (
    <div
      style={{
        margin: '-44px 16px 0',
        position: 'relative',
        zIndex: 2,
        background: JDM.surface,
        border: `1px solid ${JDM.border}`,
        borderRadius: 16,
        padding: '14px 16px 14px',
        boxShadow: '0 12px 36px rgba(0,0,0,0.5)',
      }}
    >
      {/* premium-tier accent line on top */}
      {garage.isPremiumActive ? (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 16,
            right: 16,
            height: 2,
            background: `linear-gradient(90deg, ${t.main}, transparent 80%)`,
            borderRadius: 2,
          }}
        />
      ) : null}

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        {/* garage glyph — replaces avatar; consistent with brand vocabulary */}
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: 12,
            flexShrink: 0,
            background: garage.isPremiumActive ? t.tint : JDM.surfaceAlt,
            border: `1px solid ${garage.isPremiumActive ? t.main + '55' : JDM.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: garage.isPremiumActive ? t.main : JDM.textSec,
          }}
        >
          <Icon.Garage s={26} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h1
              style={{
                margin: 0,
                fontFamily: JDM.fontSans,
                fontWeight: 700,
                fontSize: 17,
                color: JDM.text,
                letterSpacing: -0.2,
                lineHeight: 1.2,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {garage.name}
              {isOwner ? (
                <span style={{ color: JDM.textMut, display: 'inline-flex' }}>
                  <Icon.Pencil s={13} />
                </span>
              ) : null}
            </h1>
            {garage.isPremiumActive ? (
              <PremiumBadge
                variant={badgeVariant}
                tier={garage.premiumTier}
                size="sm"
                nearExpiry={nearExpiry}
                daysLeft={daysLeft}
                onPress={onBadgePress}
              />
            ) : null}
          </div>

          <div
            style={{
              marginTop: 3,
              fontFamily: JDM.fontMono,
              fontSize: 11.5,
              color: JDM.textMut,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            {garage.isPublic ? <Icon.Globe s={11} /> : <Icon.Lock s={11} />}
            <span>jdmexp.app/g/{garage.slug}</span>
          </div>
        </div>
      </div>

      {garage.description ? (
        <p
          style={{
            margin: '10px 0 0',
            fontFamily: JDM.fontSans,
            fontSize: 13,
            lineHeight: 1.5,
            color: JDM.textSec,
            textWrap: 'pretty',
          }}
        >
          {garage.description}
        </p>
      ) : null}

      <div
        style={{
          marginTop: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <Pill mono>
          <Icon.Garage s={11} /> {carCount} {carCount === 1 ? 'CARRO' : 'CARROS'}
        </Pill>
        {garage.isPublic ? (
          <Pill tone="success">
            <Icon.Globe s={10} /> Pública
          </Pill>
        ) : (
          <Pill>
            <Icon.Lock s={10} /> Privada
          </Pill>
        )}

        <div style={{ flex: 1 }} />

        {isOwner ? (
          <>
            <button
              onClick={onCoverEdit}
              style={{
                all: 'unset',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '6px 10px',
                borderRadius: 999,
                border: `1px solid ${JDM.border}`,
                background: 'transparent',
                color: JDM.textSec,
                fontFamily: JDM.fontSans,
                fontWeight: 600,
                fontSize: 12,
              }}
            >
              <Icon.Image s={13} /> Capa
            </button>
            <button
              onClick={onEdit}
              style={{
                all: 'unset',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '6px 10px',
                borderRadius: 999,
                border: `1px solid ${JDM.borderStrong}`,
                background: JDM.surfaceAlt,
                color: JDM.text,
                fontFamily: JDM.fontSans,
                fontWeight: 600,
                fontSize: 12,
              }}
            >
              <Icon.Pencil s={12} /> Editar
            </button>
          </>
        ) : null}

        {garage.isPublic && !isOwner ? (
          <button
            onClick={onShare}
            style={{
              all: 'unset',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 12px',
              borderRadius: 999,
              background: JDM.brand,
              color: '#fff',
              fontFamily: JDM.fontSans,
              fontWeight: 700,
              fontSize: 12,
              boxShadow: '0 0 18px rgba(225,6,0,0.35)',
            }}
          >
            <Icon.Share s={13} /> Compartilhar
          </button>
        ) : null}
        {isOwner && garage.isPublic ? (
          <button
            onClick={onShare}
            style={{
              all: 'unset',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '6px 10px',
              borderRadius: 999,
              background: JDM.brand,
              color: '#fff',
              fontFamily: JDM.fontSans,
              fontWeight: 700,
              fontSize: 12,
            }}
          >
            <Icon.Share s={12} /> Link
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Top app bar — back button + optional title
// ─────────────────────────────────────────────────────────────

function AppBar({ title, transparent = false, onBack }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 44,
        left: 0,
        right: 0,
        height: 44,
        zIndex: 10,
        display: 'flex',
        alignItems: 'center',
        padding: '0 12px',
        background: transparent ? 'transparent' : JDM.bg,
        borderBottom: transparent ? 'none' : `1px solid ${JDM.border}`,
      }}
    >
      <button
        onClick={onBack}
        aria-label="Voltar"
        style={{
          all: 'unset',
          cursor: 'pointer',
          width: 36,
          height: 36,
          borderRadius: 18,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: transparent ? 'rgba(10,10,10,0.55)' : 'transparent',
          backdropFilter: transparent ? 'blur(8px)' : 'none',
          color: JDM.text,
        }}
      >
        <Icon.Back />
      </button>
      {title ? (
        <div
          style={{
            flex: 1,
            textAlign: 'center',
            fontFamily: JDM.fontSans,
            fontWeight: 600,
            fontSize: 15,
            color: JDM.text,
            marginRight: 36,
          }}
        >
          {title}
        </div>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// OwnerGarage — /garage (owner view)
// ─────────────────────────────────────────────────────────────

function OwnerGarage({
  garage,
  cars,
  freeLimit,
  badgeVariant,
  nearExpiry,
  daysLeft,
  state, // 'fresh' | 'partial' | 'at-cap' | 'unlimited' | 'mixed' | 'expired'
  earned = [],
  onOpenBadgesSheet,
  onBadgeTap,
  progress,
  stats,
  forceXpTooltip = false,
  onBadgePress,
  onCoverEdit,
  onEdit,
  onShare,
  onAddCar,
  onBuySpot,
}) {
  // Build slot list based on state. Free limit defaults to 2 for the prototype.
  const slots = useMemo(() => buildSlots({ cars, freeLimit, state }), [cars, freeLimit, state]);
  const isEmpty = cars.length === 0 && (state === 'fresh' || state === 'unlimited');

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: JDM.bg,
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <StatusBar light />
      <AppBar transparent onBack={() => undefined} />

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          paddingTop: 0,
          paddingBottom: 24,
        }}
        className="jdm-hscroll"
      >
        {/* cover */}
        <div style={{ paddingTop: 44 }}>
          <GarageCover presetSlug={garage.coverPreset} height={168} />
        </div>

        {/* identity card */}
        <IdentityCard
          garage={garage}
          carCount={cars.length}
          badgeVariant={badgeVariant}
          nearExpiry={nearExpiry}
          daysLeft={daysLeft}
          isOwner
          editing={false}
          onEdit={onEdit}
          onShare={onShare}
          onBadgePress={onBadgePress}
          onCoverEdit={onCoverEdit}
        />

        {/* profile stats — XP scoreboard + 4 stat tiles. Hidden on fresh
            signup; appears once the user has earned XP. */}
        {progress && state !== 'fresh' ? (
          <ProfileStats
            progress={progress}
            stats={stats || SAMPLE_STATS}
            forceTooltipOpen={forceXpTooltip}
          />
        ) : null}

        {/* badge row — hidden for fresh signup (no badges yet) */}
        {earned && earned.length > 0 ? (
          <BadgeRow
            earned={earned}
            isOwner
            onOpenSheet={onOpenBadgesSheet}
            onBadgeTap={onBadgeTap}
          />
        ) : null}

        {/* welcome banner — fresh signup */}
        {state === 'fresh' ? (
          <div
            style={{
              margin: '14px 16px 0',
              padding: '12px 14px',
              borderRadius: 12,
              background: JDM.brandTint,
              border: `1px solid rgba(225,6,0,0.35)`,
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
            }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                flexShrink: 0,
                background: 'rgba(225,6,0,0.18)',
                color: JDM.brandSoft,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon.Sparkle s={14} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{ fontFamily: JDM.fontSans, fontWeight: 700, fontSize: 13, color: JDM.text }}
              >
                Bem-vindo à sua Garagem
              </div>
              <div
                style={{
                  fontFamily: JDM.fontSans,
                  fontSize: 12,
                  color: JDM.textSec,
                  marginTop: 2,
                  lineHeight: 1.45,
                }}
              >
                Toque numa vaga abaixo para adicionar seu primeiro carro. Você tem{' '}
                {freeLimit ?? '∞'} {freeLimit === 1 ? 'vaga grátis' : 'vagas grátis'}.
              </div>
            </div>
          </div>
        ) : null}

        {/* section header */}
        <div
          style={{
            padding: '14px 16px 8px',
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <h2
              style={{
                margin: 0,
                fontFamily: JDM.fontSans,
                fontWeight: 700,
                fontSize: 15,
                color: JDM.text,
                letterSpacing: -0.1,
              }}
            >
              Vagas
            </h2>
            <span
              style={{
                fontFamily: JDM.fontMono,
                fontSize: 12,
                color: JDM.textMut,
              }}
            >
              {cars.length}/
              {freeLimit === null ? '∞' : (freeLimit ?? '—') + (state === 'mixed' ? '+1' : '')}
            </span>
          </div>
          <span
            style={{
              fontFamily: JDM.fontMono,
              fontSize: 10,
              color: JDM.textMut,
              letterSpacing: 1,
              textTransform: 'uppercase',
            }}
          >
            {state === 'unlimited'
              ? 'Ilimitado'
              : state === 'mixed'
                ? 'Grátis + Extra'
                : state === 'at-cap'
                  ? 'No limite'
                  : 'Grátis'}
          </span>
        </div>

        {/* slot list */}
        <div
          style={{
            padding: '0 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {slots.map((slot, i) => {
            const slotNumber = i + 1;
            if (slot.kind === 'filled') {
              return (
                <FilledStallCard
                  key={`f-${slot.car.id}`}
                  car={slot.car}
                  slotNumber={slotNumber}
                  source={slot.source}
                  premiumActive={garage.isPremiumActive}
                  premiumTier={garage.premiumTier}
                  badgeVariant={badgeVariant}
                  onPress={() => undefined}
                  onBadgePress={onBadgePress}
                />
              );
            }
            if (slot.kind === 'empty') {
              return (
                <EmptyStallCard
                  key={`e-${i}`}
                  slotNumber={slotNumber}
                  source={slot.source}
                  onPress={onAddCar}
                />
              );
            }
            if (slot.kind === 'buy') {
              return (
                <BuySpotStallCard
                  key="buy"
                  slotNumber={slotNumber}
                  priceLabel="R$ 9,90"
                  onPress={onBuySpot}
                />
              );
            }
            return null;
          })}
        </div>

        {/* premium expired notice */}
        {state === 'expired' ? (
          <div
            style={{
              margin: '14px 16px 0',
              padding: '12px 14px',
              borderRadius: 12,
              background: 'rgba(245,158,11,0.08)',
              border: `1px solid rgba(245,158,11,0.35)`,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 4,
              }}
            >
              <Icon.Clock s={14} />
              <div
                style={{
                  fontFamily: JDM.fontSans,
                  fontWeight: 700,
                  fontSize: 13,
                  color: '#FFC04A',
                }}
              >
                Seu Premium expirou
              </div>
            </div>
            <div
              style={{
                fontFamily: JDM.fontSans,
                fontSize: 12,
                color: JDM.textSec,
                lineHeight: 1.45,
              }}
            >
              Sua garagem continua acessível, mas o selo Premium e a capa personalizada foram
              desativados. Renove para reativá-los.
            </div>
          </div>
        ) : null}

        {/* footer breathing room */}
        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Slot builder — mirrors apps/mobile/src/screens/garage/garage-slots.ts
// but for prototype data shape.
// ─────────────────────────────────────────────────────────────

function buildSlots({ cars, freeLimit, state }) {
  const slots = [];
  if (state === 'fresh') {
    // N empty free slots, no cars.
    for (let i = 0; i < (freeLimit ?? 2); i++) {
      slots.push({ kind: 'empty', source: 'default_free' });
    }
    return slots;
  }
  if (state === 'unlimited') {
    cars.forEach((c) => slots.push({ kind: 'filled', car: c, source: 'default_free' }));
    slots.push({ kind: 'empty', source: 'default_free' });
    return slots;
  }
  if (state === 'partial') {
    cars.forEach((c) => slots.push({ kind: 'filled', car: c, source: 'default_free' }));
    const remaining = Math.max(0, (freeLimit ?? 2) - cars.length);
    for (let i = 0; i < remaining; i++) slots.push({ kind: 'empty', source: 'default_free' });
    return slots;
  }
  if (state === 'at-cap') {
    cars.forEach((c) => slots.push({ kind: 'filled', car: c, source: 'default_free' }));
    slots.push({ kind: 'buy' });
    return slots;
  }
  if (state === 'mixed') {
    // free cars + 1 purchased empty + buy card
    cars.forEach((c, i) =>
      slots.push({ kind: 'filled', car: c, source: i === 0 ? 'admin_grant' : 'default_free' }),
    );
    slots.push({ kind: 'empty', source: 'purchase' });
    slots.push({ kind: 'buy' });
    return slots;
  }
  if (state === 'expired') {
    cars.forEach((c) => slots.push({ kind: 'filled', car: c, source: 'default_free' }));
    return slots;
  }
  // populated default
  cars.forEach((c) => slots.push({ kind: 'filled', car: c, source: 'default_free' }));
  return slots;
}

// ─────────────────────────────────────────────────────────────
// PublicGarage — /g/:slug
// Identical cover + identity card, but no edit affordances.
// Cars render WITHOUT slot numbers (the spot concept is internal);
// the public consumer just sees a clean grid of car cards.
// ─────────────────────────────────────────────────────────────

function PublicGarage({
  garage,
  cars,
  badgeVariant,
  nearExpiry,
  daysLeft,
  earned = [],
  progress,
  stats,
  forceXpTooltip = false,
  onOpenBadgesSheet,
  onBadgeTap,
  onBadgePress,
  onShare,
  onBack,
  empty,
}) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: JDM.bg,
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <StatusBar light />
      <AppBar transparent onBack={onBack} />

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          paddingBottom: 24,
        }}
        className="jdm-hscroll"
      >
        <div style={{ paddingTop: 44 }}>
          <GarageCover presetSlug={garage.coverPreset} height={168} />
        </div>

        <IdentityCard
          garage={garage}
          carCount={cars.length}
          badgeVariant={badgeVariant}
          nearExpiry={nearExpiry}
          daysLeft={daysLeft}
          isOwner={false}
          onShare={onShare}
          onBadgePress={onBadgePress}
        />

        {progress ? (
          <ProfileStats
            progress={progress}
            stats={stats || SAMPLE_STATS}
            forceTooltipOpen={forceXpTooltip}
          />
        ) : null}

        {earned && earned.filter((e) => e.pinned).length > 0 ? (
          <BadgeRow
            earned={earned}
            isOwner={false}
            onOpenSheet={onOpenBadgesSheet}
            onBadgeTap={onBadgeTap}
          />
        ) : null}

        <div style={{ padding: '16px 16px 8px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <h2
              style={{
                margin: 0,
                fontFamily: JDM.fontSans,
                fontWeight: 700,
                fontSize: 15,
                color: JDM.text,
              }}
            >
              Coleção
            </h2>
            <span style={{ fontFamily: JDM.fontMono, fontSize: 12, color: JDM.textMut }}>
              {cars.length}
            </span>
          </div>
        </div>

        {empty || cars.length === 0 ? (
          <div
            style={{
              margin: '0 16px',
              padding: '24px 16px',
              borderRadius: 14,
              border: `1px dashed ${JDM.border}`,
              background: JDM.surface,
              textAlign: 'center',
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                margin: '0 auto 10px',
                background: JDM.surfaceAlt,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: JDM.textMut,
              }}
            >
              <Icon.Garage s={20} />
            </div>
            <div
              style={{ fontFamily: JDM.fontSans, fontWeight: 700, fontSize: 14, color: JDM.text }}
            >
              Nenhum carro publicado
            </div>
            <div
              style={{ fontFamily: JDM.fontSans, fontSize: 12, color: JDM.textMut, marginTop: 4 }}
            >
              {garage.name} ainda não publicou carros.
            </div>
          </div>
        ) : (
          <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {cars.map((car, i) => (
              <FilledStallCard
                key={car.id}
                car={car}
                slotNumber={i + 1}
                source="default_free"
                premiumActive={garage.isPremiumActive}
                premiumTier={garage.premiumTier}
                badgeVariant={badgeVariant}
                onPress={() => undefined}
                onBadgePress={onBadgePress}
              />
            ))}
          </div>
        )}

        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 404 — anti-enumeration (identical for private + unknown slug)
// ─────────────────────────────────────────────────────────────

function PublicGarage404({ onBack }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: JDM.bg,
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 32px',
      }}
    >
      <StatusBar light />
      <AppBar transparent onBack={onBack} />
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          marginBottom: 16,
          background: JDM.surfaceAlt,
          border: `1px solid ${JDM.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: JDM.textMut,
        }}
      >
        <Icon.Lock s={28} />
      </div>
      <div
        style={{
          fontFamily: JDM.fontSans,
          fontWeight: 700,
          fontSize: 18,
          color: JDM.text,
          textAlign: 'center',
        }}
      >
        Garagem não encontrada
      </div>
      <div
        style={{
          fontFamily: JDM.fontSans,
          fontSize: 13,
          color: JDM.textMut,
          textAlign: 'center',
          marginTop: 6,
          lineHeight: 1.5,
        }}
      >
        Este link pode ter sido removido, estar privado ou nunca ter existido.
      </div>
      <div
        style={{
          marginTop: 16,
          padding: '6px 10px',
          borderRadius: 6,
          background: JDM.surfaceAlt,
          border: `1px solid ${JDM.border}`,
          fontFamily: JDM.fontMono,
          fontSize: 10,
          color: JDM.textMut,
          letterSpacing: 1,
        }}
      >
        HTTP 404 · /g/{'<slug>'}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Sheets — bottom sheets used as overlays
// ─────────────────────────────────────────────────────────────

function SheetShell({ title, onClose, children, height = 'auto' }) {
  return (
    <>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.55)',
          backdropFilter: 'blur(2px)',
          zIndex: 60,
        }}
        onClick={onClose}
      />
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          background: JDM.surface,
          borderTop: `1px solid ${JDM.border}`,
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
          zIndex: 65,
          maxHeight: '88%',
          overflow: 'hidden',
          boxShadow: '0 -16px 36px rgba(0,0,0,0.6)',
          height,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            padding: '10px 16px 8px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            borderBottom: `1px solid ${JDM.border}`,
          }}
        >
          <div
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              background: JDM.borderStrong,
              margin: '0 auto',
              position: 'absolute',
              top: 6,
              left: 0,
              right: 0,
            }}
          />
          <div
            style={{
              flex: 1,
              fontFamily: JDM.fontSans,
              fontWeight: 700,
              fontSize: 15,
              color: JDM.text,
            }}
          >
            {title}
          </div>
          <button
            onClick={onClose}
            style={{
              all: 'unset',
              cursor: 'pointer',
              width: 30,
              height: 30,
              borderRadius: 15,
              background: JDM.surfaceAlt,
              color: JDM.textSec,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon.Close s={16} />
          </button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }} className="jdm-hscroll">
          {children}
        </div>
      </div>
    </>
  );
}

// Premium explainer sheet — "O que é Premium?"
function PremiumSheet({ tier = 'gold', isPremiumActive = true, daysLeft, nearExpiry, onClose }) {
  const t = tierColors(tier);
  const benefits = [
    {
      icon: Icon.Image,
      title: 'Capas personalizadas',
      sub: 'Escolha entre 8 cenários ou envie a sua.',
    },
    { icon: Icon.Sparkle, title: 'Selo Premium', sub: 'Aparece nos seus carros em todo o app.' },
    {
      icon: Icon.Garage,
      title: 'Garagem em destaque',
      sub: 'Suas publicações ganham mais visibilidade no feed.',
    },
    {
      icon: Icon.Globe,
      title: 'Página pública premium',
      sub: 'Sem rodapé promocional em /g/<slug>.',
    },
  ];
  return (
    <SheetShell title="O que é Premium?" onClose={onClose}>
      <div style={{ padding: '14px 16px 18px' }}>
        {/* hero */}
        <div
          style={{
            background: `linear-gradient(135deg, ${t.tint}, transparent 80%)`,
            border: `1px solid ${t.main}44`,
            borderRadius: 14,
            padding: '14px 14px 16px',
            marginBottom: 14,
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              color: t.main,
              fontFamily: JDM.fontSans,
              fontWeight: 700,
              fontSize: 11,
              letterSpacing: 1.6,
              textTransform: 'uppercase',
            }}
          >
            <Icon.Sparkle s={12} /> {tier.toUpperCase()} TIER
          </div>
          <div
            style={{
              marginTop: 6,
              fontFamily: JDM.fontDisplay,
              fontSize: 28,
              lineHeight: 1,
              color: JDM.text,
              letterSpacing: -0.5,
            }}
          >
            JDM Premium
          </div>
          <div
            style={{
              marginTop: 6,
              fontFamily: JDM.fontSans,
              fontSize: 12.5,
              lineHeight: 1.5,
              color: JDM.textSec,
            }}
          >
            Premium é uma membresia da sua conta. Aplica-se à garagem inteira — todos os carros
            recebem o selo automaticamente.
          </div>
          {isPremiumActive && nearExpiry ? (
            <div
              style={{
                marginTop: 10,
                padding: '8px 10px',
                borderRadius: 8,
                background: 'rgba(245,158,11,0.10)',
                border: `1px solid rgba(245,158,11,0.35)`,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Icon.Clock s={14} />
              <div
                style={{
                  fontFamily: JDM.fontSans,
                  fontSize: 12,
                  color: '#FFC04A',
                }}
              >
                Expira em {daysLeft} {daysLeft === 1 ? 'dia' : 'dias'} · Renove para manter sua
                capa.
              </div>
            </div>
          ) : null}
        </div>

        {/* benefits */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {benefits.map((b, i) => {
            const I = b.icon;
            return (
              <div
                key={i}
                style={{
                  display: 'flex',
                  gap: 12,
                  padding: '10px 12px',
                  borderRadius: 12,
                  background: JDM.surfaceDeep,
                  border: `1px solid ${JDM.border}`,
                }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    flexShrink: 0,
                    background: t.tint,
                    color: t.main,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <I s={16} />
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
                    {b.title}
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
                    {b.sub}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* footer note — premium does NOT gate functional access */}
        <div
          style={{
            marginTop: 14,
            padding: '10px 12px',
            borderRadius: 10,
            background: 'transparent',
            border: `1px dashed ${JDM.border}`,
            fontFamily: JDM.fontSans,
            fontSize: 11.5,
            color: JDM.textMut,
            lineHeight: 1.5,
          }}
        >
          O Premium <strong style={{ color: JDM.textSec }}>nunca</strong> limita o uso da sua
          garagem. Carros, ingressos e check-in continuam grátis.
        </div>
      </div>
    </SheetShell>
  );
}

// Cover picker sheet — preset gallery + upload tile
function CoverPickerSheet({ currentSlug, isPremium, onSelect, onClose, onUpload }) {
  return (
    <SheetShell title="Capa da Garagem" onClose={onClose}>
      <div style={{ padding: '12px 16px 18px' }}>
        <div
          style={{
            fontFamily: JDM.fontSans,
            fontSize: 12,
            color: JDM.textMut,
            marginBottom: 12,
            lineHeight: 1.5,
          }}
        >
          {isPremium
            ? 'Escolha entre os 8 cenários curados ou envie sua imagem (máx. 4 MB, 1600×600 mín).'
            : 'Você está usando a capa padrão. Assinaturas Premium desbloqueiam 8 cenários curados e upload.'}
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 10,
          }}
        >
          {COVER_PRESETS.map((p) => {
            const locked = p.premium && !isPremium;
            const selected = p.slug === currentSlug;
            return (
              <button
                key={p.slug}
                onClick={() => (locked ? null : onSelect(p.slug))}
                disabled={locked}
                style={{
                  all: 'unset',
                  cursor: locked ? 'not-allowed' : 'pointer',
                  display: 'block',
                  borderRadius: 12,
                  overflow: 'hidden',
                  position: 'relative',
                  border: `1.5px solid ${selected ? JDM.brand : JDM.border}`,
                  opacity: locked ? 0.45 : 1,
                }}
                aria-label={p.label}
              >
                <div style={{ position: 'relative', height: 80 }}>
                  <GarageCover presetSlug={p.slug} height={80} />
                  {selected ? (
                    <div
                      style={{
                        position: 'absolute',
                        top: 6,
                        right: 6,
                        width: 22,
                        height: 22,
                        borderRadius: 11,
                        background: JDM.brand,
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 0 12px rgba(225,6,0,0.6)',
                      }}
                    >
                      <Icon.Check s={12} />
                    </div>
                  ) : null}
                  {locked ? (
                    <div
                      style={{
                        position: 'absolute',
                        top: 6,
                        right: 6,
                        padding: '3px 6px',
                        borderRadius: 4,
                        background: 'rgba(232,179,57,0.18)',
                        border: `1px solid ${JDM.gold}55`,
                        color: JDM.gold,
                        fontFamily: JDM.fontSans,
                        fontWeight: 700,
                        fontSize: 9,
                        letterSpacing: 1.4,
                        textTransform: 'uppercase',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 3,
                      }}
                    >
                      <Icon.Lock s={9} /> Premium
                    </div>
                  ) : null}
                </div>
                <div
                  style={{
                    padding: '6px 10px 8px',
                    background: JDM.surfaceDeep,
                    borderTop: `1px solid ${JDM.border}`,
                  }}
                >
                  <div
                    style={{
                      fontFamily: JDM.fontSans,
                      fontWeight: 600,
                      fontSize: 12,
                      color: JDM.text,
                    }}
                  >
                    {p.label}
                  </div>
                  <div
                    style={{
                      fontFamily: JDM.fontMono,
                      fontSize: 10,
                      color: JDM.textMut,
                      marginTop: 1,
                    }}
                  >
                    {p.slug}
                  </div>
                </div>
              </button>
            );
          })}

          {/* Upload tile */}
          <button
            onClick={isPremium ? onUpload : null}
            disabled={!isPremium}
            style={{
              all: 'unset',
              cursor: isPremium ? 'pointer' : 'not-allowed',
              display: 'block',
              borderRadius: 12,
              overflow: 'hidden',
              position: 'relative',
              border: `1.5px dashed ${JDM.border}`,
              opacity: isPremium ? 1 : 0.45,
              minHeight: 116,
            }}
          >
            <div
              style={{
                height: 80,
                background: JDM.surfaceDeep,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'column',
                gap: 4,
                color: isPremium ? JDM.text : JDM.textMut,
              }}
            >
              <Icon.Upload s={20} />
              <span style={{ fontFamily: JDM.fontSans, fontWeight: 600, fontSize: 12 }}>
                Enviar imagem
              </span>
            </div>
            <div
              style={{
                padding: '6px 10px 8px',
                background: JDM.surface,
                borderTop: `1px solid ${JDM.border}`,
              }}
            >
              <div
                style={{ fontFamily: JDM.fontSans, fontWeight: 600, fontSize: 12, color: JDM.text }}
              >
                Personalizada
              </div>
              <div
                style={{ fontFamily: JDM.fontMono, fontSize: 10, color: JDM.textMut, marginTop: 1 }}
              >
                r2://garage-cover/...
              </div>
            </div>
          </button>
        </div>
      </div>
    </SheetShell>
  );
}

// Buy-spot sheet — quick-confirm before going to /cart
function BuySpotSheet({ priceLabel = 'R$ 9,90', onClose, onCheckout }) {
  return (
    <SheetShell title="Comprar vaga adicional" onClose={onClose}>
      <div style={{ padding: '14px 16px 18px' }}>
        <div
          style={{
            background: JDM.surfaceDeep,
            border: `1px solid ${JDM.border}`,
            borderRadius: 12,
            padding: '14px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 12,
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              background: JDM.brandTint,
              color: JDM.brandSoft,
              border: `1px solid rgba(225,6,0,0.35)`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon.Garage s={20} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{ fontFamily: JDM.fontSans, fontWeight: 700, fontSize: 14, color: JDM.text }}
            >
              Vaga adicional
            </div>
            <div
              style={{ fontFamily: JDM.fontSans, fontSize: 12, color: JDM.textMut, marginTop: 2 }}
            >
              +1 espaço permanente na sua garagem.
            </div>
          </div>
          <div style={{ fontFamily: JDM.fontMono, fontWeight: 700, fontSize: 15, color: JDM.text }}>
            {priceLabel}
          </div>
        </div>

        <ul
          style={{
            margin: '0 0 14px',
            padding: 0,
            listStyle: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {[
            'Pagamento único (não é assinatura).',
            'A vaga aparece em até 60s após a confirmação.',
            'Você volta para a garagem automaticamente.',
          ].map((line, i) => (
            <li
              key={i}
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
                fontFamily: JDM.fontSans,
                fontSize: 12,
                color: JDM.textSec,
                lineHeight: 1.45,
              }}
            >
              <span style={{ color: JDM.success, marginTop: 1 }}>
                <Icon.Check s={13} />
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ul>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
          <button
            onClick={onCheckout}
            style={{
              all: 'unset',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 7,
              padding: '12px 0',
              borderRadius: 12,
              background: JDM.brand,
              color: '#fff',
              fontFamily: JDM.fontSans,
              fontWeight: 700,
              fontSize: 13,
              boxShadow: '0 0 18px rgba(225,6,0,0.35)',
            }}
          >
            <Icon.Pix s={14} /> Pix
          </button>
          <button
            onClick={onCheckout}
            style={{
              all: 'unset',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 7,
              padding: '12px 0',
              borderRadius: 12,
              background: JDM.surfaceAlt,
              color: JDM.text,
              border: `1px solid ${JDM.borderStrong}`,
              fontFamily: JDM.fontSans,
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            <Icon.ShoppingCart s={14} /> Cartão
          </button>
        </div>

        <div
          style={{
            padding: '8px 0 0',
            fontFamily: JDM.fontSans,
            fontSize: 11,
            color: JDM.textMut,
            textAlign: 'center',
            lineHeight: 1.45,
          }}
        >
          Você pode cancelar antes de finalizar o pagamento.
        </div>
      </div>
    </SheetShell>
  );
}

// Inline-edit sheet — exposes the edit affordance the current GarageHeader lacks
function EditGarageSheet({ garage, onClose, onSave }) {
  const [name, setName] = useState(garage.name);
  const [slug, setSlug] = useState(garage.slug);
  const [description, setDescription] = useState(garage.description ?? '');
  const [isPublic, setIsPublic] = useState(garage.isPublic);
  return (
    <SheetShell title="Editar Garagem" onClose={onClose}>
      <div style={{ padding: '14px 16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Nome">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={50}
            style={inputStyle}
          />
          <Counter v={name.length} max={50} />
        </Field>

        <Field label="URL pública" hint="Apenas letras minúsculas, números e hífens.">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              borderRadius: 10,
              background: JDM.surfaceDeep,
              border: `1px solid ${JDM.border}`,
            }}
          >
            <span
              style={{
                padding: '10px 8px 10px 12px',
                fontFamily: JDM.fontMono,
                fontSize: 13,
                color: JDM.textMut,
              }}
            >
              /g/
            </span>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              maxLength={40}
              style={{
                ...inputStyle,
                border: 'none',
                background: 'transparent',
                flex: 1,
                padding: '10px 12px 10px 0',
              }}
            />
          </div>
        </Field>

        <Field label="Descrição">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="Conte sobre sua garagem (opcional)"
            style={{ ...inputStyle, resize: 'none', minHeight: 72 }}
          />
          <Counter v={description.length} max={500} />
        </Field>

        <div
          style={{
            padding: 12,
            borderRadius: 12,
            background: JDM.surfaceDeep,
            border: `1px solid ${JDM.border}`,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{ fontFamily: JDM.fontSans, fontWeight: 600, fontSize: 13, color: JDM.text }}
            >
              Tornar pública
            </div>
            <div
              style={{
                fontFamily: JDM.fontSans,
                fontSize: 11.5,
                color: JDM.textMut,
                marginTop: 2,
                lineHeight: 1.45,
              }}
            >
              {isPublic
                ? `Qualquer pessoa pode ver sua garagem em jdmexp.app/g/${slug}.`
                : 'Apenas você vê esta garagem.'}
            </div>
          </div>
          <Switch value={isPublic} onChange={setIsPublic} />
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button
            onClick={onClose}
            style={{
              all: 'unset',
              cursor: 'pointer',
              flex: 1,
              textAlign: 'center',
              padding: '12px 0',
              borderRadius: 12,
              background: JDM.surfaceAlt,
              color: JDM.text,
              border: `1px solid ${JDM.borderStrong}`,
              fontFamily: JDM.fontSans,
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            Cancelar
          </button>
          <button
            onClick={() => onSave({ name, slug, description, isPublic })}
            style={{
              all: 'unset',
              cursor: 'pointer',
              flex: 1,
              textAlign: 'center',
              padding: '12px 0',
              borderRadius: 12,
              background: JDM.brand,
              color: '#fff',
              fontFamily: JDM.fontSans,
              fontWeight: 700,
              fontSize: 13,
              boxShadow: '0 0 18px rgba(225,6,0,0.35)',
            }}
          >
            Salvar
          </button>
        </div>
      </div>
    </SheetShell>
  );
}

const inputStyle = {
  display: 'block',
  width: '100%',
  boxSizing: 'border-box',
  background: JDM.surfaceDeep,
  border: `1px solid ${JDM.border}`,
  borderRadius: 10,
  padding: '10px 12px',
  fontFamily: JDM.fontSans,
  fontSize: 13,
  color: JDM.text,
  outline: 'none',
};

function Field({ label, hint, children }) {
  return (
    <div>
      <div
        style={{
          fontFamily: JDM.fontSans,
          fontWeight: 600,
          fontSize: 12,
          color: JDM.textSec,
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      {children}
      {hint ? (
        <div style={{ fontFamily: JDM.fontSans, fontSize: 11, color: JDM.textMut, marginTop: 4 }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function Counter({ v, max }) {
  const near = v / max > 0.9;
  return (
    <div
      style={{
        fontFamily: JDM.fontMono,
        fontSize: 10,
        color: near ? JDM.warning : JDM.textMut,
        marginTop: 4,
        textAlign: 'right',
      }}
    >
      {v}/{max}
    </div>
  );
}

function Switch({ value, onChange }) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        all: 'unset',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        width: 44,
        height: 26,
        borderRadius: 13,
        background: value ? JDM.success : JDM.surfaceAlt,
        border: `1px solid ${value ? '#22C55E66' : JDM.border}`,
        padding: 2,
        position: 'relative',
        transition: 'background 120ms',
      }}
      role="switch"
      aria-checked={value}
    >
      <span
        style={{
          width: 20,
          height: 20,
          borderRadius: 10,
          background: '#fff',
          transform: `translateX(${value ? 18 : 0}px)`,
          transition: 'transform 120ms',
          boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
        }}
      />
    </button>
  );
}

Object.assign(window, {
  OwnerGarage,
  PublicGarage,
  PublicGarage404,
  IdentityCard,
  AppBar,
  PremiumSheet,
  CoverPickerSheet,
  BuySpotSheet,
  EditGarageSheet,
  SheetShell,
  buildSlots,
});
