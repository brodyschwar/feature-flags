export interface FeatureFlagClientOptions {
  /** Base URL of the feature flags API, no trailing slash. */
  baseUrl: string;
  /** ff_ prefixed API key. */
  apiKey: string;
}

export interface EvaluationContext {
  /** Required for percentage flags. Ignored by boolean flags. */
  userId?: string;
  /** Arbitrary key-value pairs for user_segmented flags. */
  attributes?: Record<string, string>;
}

export class FeatureFlagError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "FeatureFlagError";
  }
}
