export const formatBRL = (cents: number): string =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const dateFmt = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export const formatEventDateRange = (startsAtIso: string, endsAtIso: string): string => {
  const start = new Date(startsAtIso);
  const end = new Date(endsAtIso);
  const sameDay = start.toDateString() === end.toDateString();
  if (sameDay) {
    const timeFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return `${dateFmt.format(start)} – ${timeFmt.format(end)}`;
  }
  return `${dateFmt.format(start)} – ${dateFmt.format(end)}`;
};
