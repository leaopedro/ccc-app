import { NotFoundShell } from '~/components/not-found-shell';

const CompassIcon = ({ size = 28 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="m15.5 8.5-2.1 4.9-4.9 2.1 2.1-4.9z" />
  </svg>
);

// Root 404: everything that is not /g/:slug lands here, including the bare
// domain. This host serves public garage profiles and nothing else, so there
// is no home page to offer — the way out is the main site.
//
// This file renders inside the ROOT layout, not the (garage) route group's
// layout, so it carries its own copy of the 430px column: a not-found inside
// the group would miss unmatched URLs entirely, and leaving this page
// unwrapped would stretch NotFoundShell's max-w-xs across the desktop
// viewport.
export default function RootNotFound() {
  return (
    <div className="mx-auto w-full max-w-[430px] min-h-screen bg-bg shadow-2xl">
      <NotFoundShell
        icon={<CompassIcon size={28} />}
        title="Página não encontrada"
        description="Este endereço hospeda apenas perfis públicos de garagem."
        code="HTTP 404"
      />
    </div>
  );
}
