export default function GarageLayout({ children }: { children: React.ReactNode }) {
  return (
    // Fixed mobile-width column. The page is a phone screen ported to the
    // web: the cover bleeds edge to edge and the identity card sits on a
    // 4-unit margin, both of which stretch into nonsense on a desktop
    // viewport. Constraining here rather than inside PublicGarageView keeps
    // the cover bleeding to the column edge instead of the window edge.
    // Below 430px the column is simply full width, so phones are unaffected.
    //
    // app/not-found.tsx (the root 404) stays outside this route group and
    // wraps itself in the same column — see that file for why.
    <div className="mx-auto w-full max-w-[430px] min-h-screen bg-bg shadow-2xl">{children}</div>
  );
}
