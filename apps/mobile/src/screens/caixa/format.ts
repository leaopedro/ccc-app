export const formatBRL = (cents: number): string => {
  const value = (Math.round(cents) / 100).toFixed(2); // "1234.56"
  const [intPart, dec] = value.split('.');
  const withThousands = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `R$ ${withThousands},${dec}`;
};

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const formatCountdown = (msRemaining: number): string => {
  const ms = Math.max(0, msRemaining);
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  const minutes = Math.floor((ms % HOUR) / (60 * 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  if (days > 0) return `${days}d ${pad(hours)}h ${pad(minutes)}m`;
  return `${pad(hours)}h ${pad(minutes)}m`;
};

export const isUrgent = (msRemaining: number): boolean => msRemaining <= DAY && msRemaining >= 0;
