import { z } from 'zod';

// ── Rules schemas ────────────────────────────────────────────────

export const BooleanRulesSchema = z.object({
  enabled: z.boolean(),
});

export const PercentageRulesSchema = z.object({
  percentage: z.number().int().min(0).max(100),
});

export const SegmentSchema = z.object({
  attribute: z.string().min(1),
  operator: z.enum(['eq', 'neq', 'in', 'not_in', 'contains', 'regex']),
  values: z.array(z.string()),
  result: z.boolean(),
});

export const UserSegmentedRulesSchema = z.object({
  segments: z.array(SegmentSchema),
  defaultValue: z.boolean(),
});

// ── Full flag (as stored / returned from API) ────────────────────

const FlagBaseSchema = z.object({
  id: z.string().uuid(),
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const FlagSchema = z.discriminatedUnion('type', [
  FlagBaseSchema.extend({ type: z.literal('boolean'), rules: BooleanRulesSchema }),
  FlagBaseSchema.extend({ type: z.literal('percentage'), rules: PercentageRulesSchema }),
  FlagBaseSchema.extend({ type: z.literal('user_segmented'), rules: UserSegmentedRulesSchema }),
]);

export type Flag = z.infer<typeof FlagSchema>;
export type BooleanRules = z.infer<typeof BooleanRulesSchema>;
export type PercentageRules = z.infer<typeof PercentageRulesSchema>;
export type UserSegmentedRules = z.infer<typeof UserSegmentedRulesSchema>;

// ── Create body (key/name/description/type/rules — no server fields) ──

const FlagBaseCreateSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
});

export const CreateFlagBodySchema = z.discriminatedUnion('type', [
  FlagBaseCreateSchema.extend({ type: z.literal('boolean'), rules: BooleanRulesSchema }),
  FlagBaseCreateSchema.extend({ type: z.literal('percentage'), rules: PercentageRulesSchema }),
  FlagBaseCreateSchema.extend({ type: z.literal('user_segmented'), rules: UserSegmentedRulesSchema }),
]);

export type CreateFlagBody = z.infer<typeof CreateFlagBodySchema>;

// ── Update body ──────────────────────────────────────────────────

export const UpdateFlagBodySchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  rules: z.union([BooleanRulesSchema, PercentageRulesSchema, UserSegmentedRulesSchema]).optional(),
}).refine(body => Object.keys(body).length > 0, { message: 'At least one field must be provided' });

// ── Evaluate body ────────────────────────────────────────────────

export const EvaluateBodySchema = z.object({
  context: z.object({
    userId: z.string().optional(),
    attributes: z.record(z.string()).optional(),
  }).optional(),
});

export type EvaluateContext = NonNullable<z.infer<typeof EvaluateBodySchema>['context']>;
