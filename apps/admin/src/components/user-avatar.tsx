const sizeClasses = {
  sm: 'h-8 w-8 text-xs',
  lg: 'h-16 w-16 text-xl',
} as const;

export function UserAvatar({
  name,
  size = 'sm',
}: {
  name: string;
  size?: keyof typeof sizeClasses;
}) {
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-[color:var(--color-border)] font-semibold ${sizeClasses[size]}`}
    >
      {initials}
    </span>
  );
}
