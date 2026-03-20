export interface BooleanRules {
  enabled: boolean;
}

export interface PercentageRules {
  /** 0–100 inclusive */
  percentage: number;
}

export type SegmentOperator = 'eq' | 'neq' | 'in' | 'not_in' | 'contains' | 'regex';

export interface Segment {
  attribute: string;
  operator: SegmentOperator;
  /** For eq/neq/contains/regex: values[0] is used. For in/not_in: entire array. */
  values: string[];
  result: boolean;
}

export interface UserSegmentedRules {
  segments: Segment[];
  defaultValue: boolean;
}

/**
 * The evaluation-only representation of a flag — everything needed to
 * evaluate locally, nothing more. Intentionally excludes metadata fields
 * like name, description, createdAt, and updatedAt.
 */
export type FlagDefinition =
  | { key: string; type: 'boolean'; rules: BooleanRules }
  | { key: string; type: 'percentage'; rules: PercentageRules }
  | { key: string; type: 'user_segmented'; rules: UserSegmentedRules };

export interface EvaluationContext {
  /** Required for percentage flags. Ignored by boolean flags. */
  userId?: string;
  /** Arbitrary key-value pairs matched against user_segmented segments. */
  attributes?: Record<string, string>;
}
