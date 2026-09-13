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

export default function PublicGarageNotFound() {
  return (
    <div className="min-h-screen bg-bg flex flex-col items-center justify-center px-8 text-center">
      <div className="w-18 h-18 rounded-full bg-surface-alt border border-border flex items-center justify-center text-muted mb-4">
        <LockIcon size={28} />
      </div>
      <h1 className="text-fg text-lg font-bold">Garagem não encontrada</h1>
      <p className="text-muted text-sm mt-1 leading-relaxed max-w-xs">
        Este link pode ter sido removido, estar privado ou nunca ter existido.
      </p>
      <div className="mt-4 px-2.5 py-1.5 rounded bg-surface-alt border border-border text-muted text-[10px] tracking-wider font-mono">
        HTTP 404 · /g/{'<slug>'}
      </div>
    </div>
  );
}
