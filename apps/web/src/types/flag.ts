export interface FlagBase {
  id: string;
  key: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
}

export type BooleanFlag = FlagBase & {
  type: 'boolean';
  rules: { enabled: boolean };
};

export type PercentageFlag = FlagBase & {
  type: 'percentage';
  rules: { percentage: number };
};

export type Segment = {
  attribute: string;
  operator: 'eq' | 'neq' | 'in' | 'not_in' | 'contains' | 'regex';
  values: string[];
  result: boolean;
};

export type UserSegmentedFlag = FlagBase & {
  type: 'user_segmented';
  rules: {
    segments: Segment[];
    defaultValue: boolean;
  };
};

export type Flag = BooleanFlag | PercentageFlag | UserSegmentedFlag;
export type FlagType = Flag['type'];

export interface ApiKey {
  _id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
}
