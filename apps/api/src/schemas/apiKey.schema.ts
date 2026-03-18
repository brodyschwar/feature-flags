import { z } from 'zod';

export const ApiKeySchema = z.object({
  _id: z.string(),         // SHA-256 hash — used for lookups
  name: z.string().min(1),
  createdAt: z.number(),
  lastUsedAt: z.number().nullable(),
});

export type ApiKey = z.infer<typeof ApiKeySchema>;
