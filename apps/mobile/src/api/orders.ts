import {
  cancelMyOrderResponseSchema,
  createOrderRequestSchema,
  createOrderResponseSchema,
  createPixOrderResponseSchema,
  createWebCheckoutRequestSchema,
  createWebCheckoutResponseSchema,
  getOrderResponseSchema,
  myOrdersResponseSchema,
  resumeOrderResponseSchema,
} from '@jdm/shared/orders';
import type {
  CancelMyOrderResponse,
  CreateOrderRequest,
  CreateOrderResponse,
  CreatePixOrderResponse,
  CreateWebCheckoutRequest,
  CreateWebCheckoutResponse,
  GetOrderResponse,
  MyOrdersResponse,
  ResumeOrderResponse,
} from '@jdm/shared/orders';

import { authedRequest } from './client';

export const createOrder = (input: CreateOrderRequest): Promise<CreateOrderResponse> => {
  return authedRequest('/orders', createOrderResponseSchema, {
    method: 'POST',
    body: createOrderRequestSchema.parse(input),
  });
};

export const createWebCheckout = (
  input: CreateWebCheckoutRequest,
): Promise<CreateWebCheckoutResponse> => {
  return authedRequest('/orders/checkout', createWebCheckoutResponseSchema, {
    method: 'POST',
    body: createWebCheckoutRequestSchema.parse(input),
  });
};

export const createPixOrder = (
  input: Omit<CreateOrderRequest, 'method'>,
): Promise<CreatePixOrderResponse> => {
  return authedRequest('/orders', createPixOrderResponseSchema, {
    method: 'POST',
    body: createOrderRequestSchema.parse({ ...input, method: 'pix' }),
  });
};

export const getOrder = (orderId: string): Promise<GetOrderResponse> => {
  return authedRequest(`/orders/${orderId}`, getOrderResponseSchema);
};

export const listMyOrders = (): Promise<MyOrdersResponse> => {
  return authedRequest('/me/orders', myOrdersResponseSchema);
};

export const cancelMyOrder = (orderId: string): Promise<CancelMyOrderResponse> => {
  return authedRequest(`/me/orders/${orderId}/cancel`, cancelMyOrderResponseSchema, {
    method: 'POST',
  });
};

export const resumeOrder = (orderId: string): Promise<ResumeOrderResponse> => {
  return authedRequest(`/orders/${orderId}/resume`, resumeOrderResponseSchema);
};
