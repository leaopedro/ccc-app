export function withOrderIdParam(successUrl: string, orderId: string): string {
  try {
    const url = new URL(successUrl);
    url.searchParams.set('orderId', orderId);
    return url.toString();
  } catch {
    const separator = successUrl.includes('?') ? '&' : '?';
    return `${successUrl}${separator}orderId=${encodeURIComponent(orderId)}`;
  }
}
