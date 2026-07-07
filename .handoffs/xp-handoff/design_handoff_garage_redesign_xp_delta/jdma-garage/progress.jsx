// JDM Experience — Garagem · Profile Stats (XP + ranking + stats tiles)
// Gamification layer #2. XP is a transparent score that grows with
// in-app actions. Rank tiers are derived from XP. Stats tiles surface
// 4 specific counters underneath the XP scoreboard.
//
// CONTRACT — XP is server-computed and exposed on GarageOwner / GaragePublic.
// Client never sums it locally. Rank tier is also server-computed (so the
// thresholds can move without a client release) and travels as a label.

const { useState: progressUseState, useRef: progressUseRef, useEffect: progressUseEffect } = React;

// ─────────────────────────────────────────────────────────────
// XP rules table — what the tooltip renders. Server is source of
// truth; this exists in client copy purely for the explainer UI.
// ─────────────────────────────────────────────────────────────

const XP_RULES = [
  { points: 10, action: 'Check-in em um evento', icon: 'flag' },
  { points: 5, action: 'Adicionar um carro à garagem', icon: 'car' },
  { points: 2, action: 'Publicar um post no feed', icon: 'post' },
  { points: 1, action: 'Receber uma curtida', icon: 'fire' },
  { points: 25, action: 'Desbloquear conquista comum', icon: 'medal', tone: 'silver' },
  { points: 50, action: 'Desbloquear conquista rara', icon: 'medal', tone: 'gold' },
  { points: 100, action: 'Desbloquear conquista lendária', icon: 'medal', tone: 'brand' },
  { points: 200, action: 'Tornar-se Premium', icon: 'sparkle' },
];

// Rank tiers — purely cosmetic; thresholds live server-side.
// `next` is null on the top tier (Hall of Fame).
const RANK_TIERS = [
  { name: 'Iniciante', min: 0, next: 'Pilotador', nextAt: 100 },
  { name: 'Pilotador', min: 100, next: 'Veterano', nextAt: 500 },
  { name: 'Veterano', min: 500, next: 'Lendário', nextAt: 2000 },
  { name: 'Lendário', min: 2000, next: 'Hall of Fame', nextAt: 5000 },
  { name: 'Hall of Fame', min: 5000, next: null, nextAt: null },
];

// Sample data — Caio has 1,247 XP → Veterano, 753 to Lendário.
const SAMPLE_PROGRESS = {
  xp: 1247,
  rank: 'Veterano',
  nextRank: 'Lendário',
  xpInTier: 747, // xp - currentTier.min
  xpToNextRank: 753, // nextTier.min - xp
  tierSpan: 1500, // nextTier.min - currentTier.min
};

// Stats — server-computed counters.
const SAMPLE_STATS = {
  events: 8,
  posts: 23,
  likesReceived: 142,
  joinedAt: '2026-02-14',
};

// ─────────────────────────────────────────────────────────────
// XP tooltip (overlay-style popover, tap to open / outside to close)
// ─────────────────────────────────────────────────────────────

function XPTooltip({ onClose }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 70,
      }}
    >
      <div
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.55)',
          backdropFilter: 'blur(2px)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 16,
          right: 16,
          top: '50%',
          transform: 'translateY(-50%)',
          background: JDM.surface,
          border: `1px solid ${JDM.border}`,
          borderRadius: 16,
          padding: '16px 16px 16px',
          boxShadow: '0 16px 40px rgba(0,0,0,0.6)',
          maxHeight: '80%',
          overflowY: 'auto',
        }}
        className="jdm-hscroll"
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 8,
            marginBottom: 12,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontFamily: JDM.fontMono,
                fontSize: 10,
                color: JDM.brandSoft,
                letterSpacing: 1.4,
                textTransform: 'uppercase',
                marginBottom: 4,
              }}
            >
              Como ganhar XP
            </div>
            <div
              style={{
                fontFamily: JDM.fontDisplay,
                fontSize: 24,
                lineHeight: 1,
                color: JDM.text,
                letterSpacing: -0.5,
              }}
            >
              Pontos de Experiência
            </div>
            <div
              style={{
                fontFamily: JDM.fontSans,
                fontSize: 12,
                color: JDM.textMut,
                marginTop: 6,
                lineHeight: 1.45,
              }}
            >
              XP cresce a cada interação real no app. Cada ação rende a quantidade abaixo.
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              all: 'unset',
              cursor: 'pointer',
              width: 30,
              height: 30,
              borderRadius: 15,
              flexShrink: 0,
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

        <ul
          style={{
            margin: 0,
            padding: 0,
            listStyle: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {XP_RULES.map((rule, i) => {
            const tone =
              rule.tone === 'gold'
                ? JDM.gold
                : rule.tone === 'silver'
                  ? JDM.silver
                  : rule.tone === 'brand'
                    ? JDM.brand
                    : JDM.brandSoft;
            const Glyph = BadgeGlyph[rule.icon] || BadgeGlyph.medal;
            return (
              <li
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 10px',
                  borderRadius: 10,
                  background: JDM.surfaceDeep,
                  border: `1px solid ${JDM.border}`,
                }}
              >
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 7,
                    background: 'rgba(255,255,255,0.04)',
                    color: tone,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Glyph s={14} />
                </div>
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontFamily: JDM.fontSans,
                    fontSize: 12.5,
                    color: JDM.text,
                    lineHeight: 1.35,
                  }}
                >
                  {rule.action}
                </div>
                <div
                  style={{
                    fontFamily: JDM.fontMono,
                    fontWeight: 700,
                    fontSize: 13,
                    color: tone,
                    flexShrink: 0,
                  }}
                >
                  +{rule.points} XP
                </div>
              </li>
            );
          })}
        </ul>

        <div
          style={{
            marginTop: 12,
            padding: '8px 10px',
            borderRadius: 8,
            background: 'transparent',
            border: `1px dashed ${JDM.border}`,
            fontFamily: JDM.fontSans,
            fontSize: 11,
            color: JDM.textMut,
            lineHeight: 1.45,
          }}
        >
          XP não expira e não pode ser comprado. Premium dá um bônus único de +200 XP no momento da
          ativação.
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// XPScoreboard — the chamativo block. Big number, rank pill,
// progress bar with mono ticker, "?" trigger for the tooltip.
// ─────────────────────────────────────────────────────────────

function XPScoreboard({ progress, isTopRank = false, onHelp }) {
  const pct = isTopRank
    ? 100
    : Math.min(100, Math.round((progress.xpInTier / progress.tierSpan) * 100));
  // Ticker marks — 10 evenly-spaced hatches across the bar
  const ticks = Array.from({ length: 11 }).map((_, i) => i / 10);

  return (
    <div
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: `linear-gradient(135deg, rgba(225,6,0,0.10), transparent 60%), ${JDM.surface}`,
        border: `1px solid ${JDM.border}`,
        borderRadius: 14,
        padding: '14px 16px 14px',
      }}
    >
      {/* corner racing-stripe accent */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: 64,
          height: 4,
          background: `linear-gradient(90deg, transparent, ${JDM.brand})`,
        }}
      />

      {/* row 1 — label + rank pill */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontFamily: JDM.fontMono,
            fontSize: 10,
            color: JDM.textMut,
            letterSpacing: 1.6,
            textTransform: 'uppercase',
          }}
        >
          <span>XP</span>
          <button
            onClick={onHelp}
            aria-label="Como ganhar XP"
            style={{
              all: 'unset',
              cursor: 'pointer',
              width: 18,
              height: 18,
              borderRadius: 9,
              background: JDM.surfaceAlt,
              color: JDM.textSec,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: `1px solid ${JDM.border}`,
              fontFamily: JDM.fontSans,
              fontWeight: 700,
              fontSize: 11,
            }}
          >
            ?
          </button>
        </div>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '3px 9px',
            borderRadius: 4,
            background: JDM.brandTint,
            color: JDM.brandSoft,
            border: `1px solid rgba(225,6,0,0.45)`,
            fontFamily: JDM.fontSans,
            fontWeight: 700,
            fontSize: 10,
            letterSpacing: 1.6,
            textTransform: 'uppercase',
          }}
        >
          <Icon.Sparkle s={10} /> {progress.rank}
        </span>
      </div>

      {/* row 2 — BIG number */}
      <div
        style={{
          marginTop: 6,
          display: 'flex',
          alignItems: 'baseline',
          gap: 10,
        }}
      >
        <div
          style={{
            fontFamily: JDM.fontDisplay,
            fontSize: 46,
            lineHeight: 1,
            color: JDM.text,
            letterSpacing: -1.5,
            textShadow: '0 0 24px rgba(225,6,0,0.18)',
          }}
        >
          {progress.xp.toLocaleString('pt-BR')}
        </div>
        <div
          style={{
            fontFamily: JDM.fontMono,
            fontSize: 11,
            color: JDM.textMut,
            letterSpacing: 1,
            textTransform: 'uppercase',
          }}
        >
          pontos
        </div>
      </div>

      {/* row 3 — progress bar with mono ticks */}
      <div style={{ marginTop: 12 }}>
        <div
          style={{
            position: 'relative',
            height: 8,
            borderRadius: 4,
            background: JDM.surfaceDeep,
            border: `1px solid ${JDM.border}`,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: `${pct}%`,
              background: `linear-gradient(90deg, ${JDM.brandDeep}, ${JDM.brand})`,
              boxShadow: `0 0 12px rgba(225,6,0,0.5)`,
            }}
          />
          {/* ticker marks */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 2px',
              pointerEvents: 'none',
            }}
          >
            {ticks.map((p, i) => (
              <span
                key={i}
                style={{
                  width: 1,
                  height: i % 5 === 0 ? 8 : 4,
                  background: 'rgba(255,255,255,0.18)',
                  borderRadius: 1,
                }}
              />
            ))}
          </div>
        </div>
        <div
          style={{
            marginTop: 6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontFamily: JDM.fontMono,
            fontSize: 10,
            color: JDM.textMut,
            letterSpacing: 0.4,
          }}
        >
          <span>{progress.rank}</span>
          <span style={{ color: JDM.textSec }}>
            {isTopRank
              ? 'Topo do ranking'
              : `${progress.xpToNextRank.toLocaleString('pt-BR')} → ${progress.nextRank}`}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// StatsRow — 4 compact tiles. Wraps nicely on narrow widths.
// ─────────────────────────────────────────────────────────────

function StatsRow({ stats }) {
  const joinDate = new Date(stats.joinedAt);
  const joinDateStr = joinDate
    .toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })
    .replace('.', '');
  const items = [
    { value: stats.events, label: 'Eventos', icon: 'flag' },
    { value: stats.posts, label: 'Posts', icon: 'post' },
    { value: stats.likesReceived, label: 'Curtidas', icon: 'fire' },
    { value: joinDateStr, label: 'Desde', icon: 'pin', isText: true },
  ];
  return (
    <div
      style={{
        marginTop: 10,
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 8,
      }}
    >
      {items.map((it, i) => {
        const Glyph = BadgeGlyph[it.icon] || BadgeGlyph.flag;
        return (
          <div
            key={i}
            style={{
              background: JDM.surface,
              border: `1px solid ${JDM.border}`,
              borderRadius: 12,
              padding: '10px 8px 9px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 3,
            }}
          >
            <div
              style={{
                color: JDM.textMut,
                marginBottom: 2,
              }}
            >
              <Glyph s={14} />
            </div>
            <div
              style={{
                fontFamily: it.isText ? JDM.fontSans : JDM.fontMono,
                fontWeight: 700,
                fontSize: it.isText ? 13 : 17,
                color: JDM.text,
                letterSpacing: it.isText ? -0.1 : -0.4,
                lineHeight: 1,
                textTransform: it.isText ? 'capitalize' : 'none',
              }}
            >
              {it.value}
            </div>
            <div
              style={{
                fontFamily: JDM.fontMono,
                fontSize: 9,
                color: JDM.textMut,
                letterSpacing: 0.8,
                textTransform: 'uppercase',
              }}
            >
              {it.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ProfileStats — combined block. XP scoreboard + stats row +
// ? tooltip overlay. Place between IdentityCard and BadgeRow.
// ─────────────────────────────────────────────────────────────

function ProfileStats({ progress, stats, forceTooltipOpen = false }) {
  const [tooltipOpen, setTooltipOpen] = progressUseState(forceTooltipOpen);
  progressUseEffect(() => {
    setTooltipOpen(forceTooltipOpen);
  }, [forceTooltipOpen]);
  const isTopRank = progress.nextRank == null;

  return (
    <div style={{ margin: '12px 16px 0', position: 'relative' }}>
      <XPScoreboard progress={progress} isTopRank={isTopRank} onHelp={() => setTooltipOpen(true)} />
      <StatsRow stats={stats} />
      {tooltipOpen ? <XPTooltip onClose={() => setTooltipOpen(false)} /> : null}
    </div>
  );
}

Object.assign(window, {
  XP_RULES,
  RANK_TIERS,
  SAMPLE_PROGRESS,
  SAMPLE_STATS,
  XPScoreboard,
  StatsRow,
  XPTooltip,
  ProfileStats,
});
