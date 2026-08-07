import { z } from 'zod';

import { authedRequest } from './client';

const createExportResponseSchema = z.object({
  id: z.string(),
  status: z.string(),
  message: z.string().optional(),
});
export type CreateExportResponse = z.infer<typeof createExportResponseSchema>;

const exportJobSchema = z.object({
  id: z.string(),
  status: z.string(),
  downloadUrl: z.string().nullable(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  error: z.string().optional(),
});
export type ExportJob = z.infer<typeof exportJobSchema>;

// Requests an LGPD data export. Returns the job id; poll getDataExport until the
// status is 'completed' and a short-lived signed downloadUrl is available.
export const createDataExport = (): Promise<CreateExportResponse> =>
  authedRequest('/me/data-export', createExportResponseSchema, { method: 'POST' });

export const getDataExport = (id: string): Promise<ExportJob> =>
  authedRequest(`/me/data-export/${id}`, exportJobSchema);
