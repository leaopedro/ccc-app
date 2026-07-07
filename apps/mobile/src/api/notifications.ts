import {
  notificationListQuerySchema,
  notificationListResponseSchema,
  notificationMarkReadResponseSchema,
  notificationUnreadCountResponseSchema,
  type NotificationListQuery,
  type NotificationListResponse,
  type NotificationMarkReadResponse,
  type NotificationUnreadCountResponse,
} from '@jdm/shared/notifications';

import { authedRequest } from './client';

export const listNotifications = (
  query: Partial<NotificationListQuery> = {},
): Promise<NotificationListResponse> => {
  const parsed = notificationListQuerySchema.parse(query);
  const params = new URLSearchParams();
  params.set('limit', String(parsed.limit));
  if (parsed.cursor) params.set('cursor', parsed.cursor);
  return authedRequest(`/me/notifications?${params.toString()}`, notificationListResponseSchema);
};

export const getUnreadCount = (): Promise<NotificationUnreadCountResponse> =>
  authedRequest('/me/notifications/unread-count', notificationUnreadCountResponseSchema);

export const markNotificationRead = (id: string): Promise<NotificationMarkReadResponse> =>
  authedRequest(`/me/notifications/${id}/read`, notificationMarkReadResponseSchema, {
    method: 'POST',
  });
