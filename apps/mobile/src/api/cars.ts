import {
  addCarPhotoSchema,
  type AddCarPhotoInput,
  type Car,
  carListResponseSchema,
  carSchema,
  type CarInput,
  carInputSchema,
  type CarUpdateInput,
  carUpdateSchema,
} from '@jdm/shared/cars';
import { z } from 'zod';

import { authedRequest } from './client';

export const listCars = async (): Promise<Car[]> => {
  const res = await authedRequest('/me/cars', carListResponseSchema);
  return res.cars;
};

export const getCar = (id: string): Promise<Car> => authedRequest(`/me/cars/${id}`, carSchema);

// The API allocator (allocateSpotForCar) decides slot precedence based on
// availability + spot source; the mobile client does not pass a spotId hint.
// Honoring a client-supplied spotId would require an API change (out of scope
// for TASK-D — see spec §3 allocation rules).
export const createCar = (input: CarInput): Promise<Car> =>
  authedRequest('/me/cars', carSchema, {
    method: 'POST',
    body: carInputSchema.parse(input),
  });

export const updateCar = (id: string, input: CarUpdateInput): Promise<Car> =>
  authedRequest(`/me/cars/${id}`, carSchema, {
    method: 'PATCH',
    body: carUpdateSchema.parse(input),
  });

export const deleteCar = (id: string): Promise<void> =>
  authedRequest(`/me/cars/${id}`, z.unknown(), { method: 'DELETE' }).then(() => undefined);

export const addCarPhoto = (id: string, input: AddCarPhotoInput): Promise<Car> =>
  authedRequest(`/me/cars/${id}/photos`, carSchema, {
    method: 'POST',
    body: addCarPhotoSchema.parse(input),
  });

export const removeCarPhoto = (carId: string, photoId: string): Promise<void> =>
  authedRequest(`/me/cars/${carId}/photos/${photoId}`, z.unknown(), { method: 'DELETE' }).then(
    () => undefined,
  );
