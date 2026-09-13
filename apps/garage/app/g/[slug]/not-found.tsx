import { NotFoundShell } from '~/components/not-found-shell';

const LockIcon = ({ size = 28 }: { size?: number }) => (
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
    <rect width="18" height="11" x="3" y="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

// Copy is deliberately vague about WHY the garage is missing. §C9: an unknown
// slug and a private garage must be indistinguishable, so this page can never
// hint at which case it is.
export default function PublicGarageNotFound() {
  return (
    <NotFoundShell
      icon={<LockIcon size={28} />}
      title="Garagem não encontrada"
      description="Este link pode ter sido removido, estar privado ou nunca ter existido."
      code={<>HTTP 404 · /g/{'<slug>'}</>}
    />
  );
}
