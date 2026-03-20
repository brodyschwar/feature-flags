import { FeatureFlagClient, CachedFlagEvaluator } from "@feature-flags/ts-sdk";
import type { EvaluationContext } from "@feature-flags/ts-sdk";

const client = new FeatureFlagClient({
  baseUrl: process.env.FLAGS_API_URL!,
  apiKey: process.env.FLAGS_API_KEY!,
});

export const flags = new CachedFlagEvaluator({
  client,
  ttl: 30_000,
});

/**
 * Evaluate a flag, returning `defaultValue` on any error (flag missing,
 * flags API unreachable, etc.). Prevents flag outages from crashing user-
 * facing routes.
 */
export async function safeEvaluate(
  key: string,
  defaultValue: boolean,
  context?: EvaluationContext
): Promise<boolean> {
  try {
    return await flags.evaluate(key, context);
  } catch {
    console.warn(`[flags] Failed to evaluate "${key}", using default (${defaultValue})`);
    return defaultValue;
  }
}
