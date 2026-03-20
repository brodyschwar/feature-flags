import { FeatureFlagClient, CachedFlagEvaluator } from "@feature-flags/ts-sdk";

const client = new FeatureFlagClient({
  baseUrl: process.env.FLAGS_API_URL!,
  apiKey: process.env.FLAGS_API_KEY!,
});

export const flags = new CachedFlagEvaluator({
  client,
  flags: ["show-favorite-number", "extended-color-palette", "pro-number-range"] as const,
  ttl: 30_000,
});
