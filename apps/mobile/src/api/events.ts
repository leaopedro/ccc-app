import {
  type ConfirmedCarsResponse,
  confirmedCarsResponseSchema,
  type EventDetailCommerce,
  eventDetailCommerceSchema,
  type EventDetailPublic,
  eventDetailPublicSchema,
  type EventListQuery,
  type EventListResponse,
  eventListResponseSchema,
} from '@jdm/shared/events';

import { authedRequest, request } from './client';

const buildQueryString = (q: Partial<EventListQuery>): string => {
  const params = new URLSearchParams();
  if (q.window) params.set('window', q.window);
  if (q.type) params.set('type', q.type);
  if (q.stateCode) params.set('stateCode', q.stateCode);
  if (q.city) params.set('city', q.city);
  if (q.cursor) params.set('cursor', q.cursor);
  if (q.limit) params.set('limit', String(q.limit));
  const s = params.toString();
  return s ? `?${s}` : '';
};

export const listEvents = (q: Partial<EventListQuery> = {}): Promise<EventListResponse> =>
  request(`/events${buildQueryString(q)}`, eventListResponseSchema);

export const getEvent = (slug: string): Promise<EventDetailPublic> =>
  request(`/events/${encodeURIComponent(slug)}`, eventDetailPublicSchema);

export const getEventById = (id: string): Promise<EventDetailPublic> =>
  request(`/events/by-id/${encodeURIComponent(id)}`, eventDetailPublicSchema);

export const getEventCommerce = (slug: string): Promise<EventDetailCommerce> =>
  authedRequest(`/events/${encodeURIComponent(slug)}/commerce`, eventDetailCommerceSchema);

export const getEventCommerceById = (id: string): Promise<EventDetailCommerce> =>
  authedRequest(`/events/by-id/${encodeURIComponent(id)}/commerce`, eventDetailCommerceSchema);

export const getConfirmedCars = (slug: string): Promise<ConfirmedCarsResponse> =>
  request(`/events/${encodeURIComponent(slug)}/confirmed-cars`, confirmedCarsResponseSchema);
