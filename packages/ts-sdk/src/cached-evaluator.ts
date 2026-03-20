import { evaluate } from "@feature-flags/flag-evaluation";
import type { FlagDefinition } from "@feature-flags/flag-evaluation";
import type { FeatureFlagClient } from "./client.js";
import type { EvaluationContext } from "./types.js";
import { FeatureFlagError } from "./types.js";

export interface CachedFlagEvaluatorOptions {
  /** The HTTP client used to fetch flag definitions. */
  client: FeatureFlagClient;
  /**
   * How long (ms) cached definitions are considered fresh before a refresh
   * is triggered. Default: 30_000 (30 seconds).
   */
  ttl?: number;
  /**
   * When true, serve the last-known cached value while a refresh runs in
   * the background. Callers receive a result immediately but may briefly see
   * a stale value after TTL expiry.
   *
   * When false (default), callers await the refresh before receiving a result.
   * Use false when evaluation accuracy is critical.
   */
  staleWhileRevalidate?: boolean;
}

const DEFAULT_TTL = 30_000;

export class CachedFlagEvaluator {
  private readonly client: FeatureFlagClient;
  private readonly ttl: number;
  private readonly staleWhileRevalidate: boolean;

  private cache: Map<string, FlagDefinition> = new Map();
  private etag: string | null = null;
  private fetchedAt: number | null = null;
  private inflightRefresh: Promise<void> | null = null;

  constructor(options: CachedFlagEvaluatorOptions) {
    this.client = options.client;
    this.ttl = options.ttl ?? DEFAULT_TTL;
    this.staleWhileRevalidate = options.staleWhileRevalidate ?? false;
  }

  /**
   * Evaluate a flag locally using the cached definition.
   *
   * - Cold cache: fetches all definitions before evaluating.
   * - Stale cache + default mode: awaits a refresh before evaluating.
   * - Stale cache + staleWhileRevalidate: returns the cached value immediately
   *   and triggers a background refresh for subsequent calls.
   * - Cache miss after bulk refresh: falls back to fetching the single flag.
   */
  async evaluate(flagKey: string, context?: EvaluationContext): Promise<boolean> {
    if (this.isStale()) {
      if (this.staleWhileRevalidate && this.fetchedAt !== null) {
        // Cache is warm but stale — serve immediately, refresh in background.
        void this.refresh();
      } else {
        // Cold cache or blocking mode — must be fresh before evaluating.
        await this.refresh();
      }
    }

    let definition = this.cache.get(flagKey);

    if (!definition) {
      // Flag not found in the bulk cache — may have been created after the last
      // refresh. Fetch it individually.
      const result = await this.client.getDefinition(flagKey);
      if (!result) {
        throw new FeatureFlagError(`Flag "${flagKey}" not found`);
      }
      this.cache.set(flagKey, result.flag);
      definition = result.flag;
    }

    return evaluate(definition, context);
  }

  /**
   * Pre-populate the cache with all flag definitions.
   * Call once at startup to eliminate cold-start latency on the first evaluate().
   */
  async warm(): Promise<void> {
    await this.refresh();
  }

  /**
   * Force an immediate cache refresh, bypassing the TTL.
   *
   * Single-flight: if a refresh is already in progress, returns the same
   * Promise rather than issuing a second request.
   */
  refresh(): Promise<void> {
    if (this.inflightRefresh) return this.inflightRefresh;
    this.inflightRefresh = this.doRefresh().finally(() => {
      this.inflightRefresh = null;
    });
    return this.inflightRefresh;
  }

  private isStale(): boolean {
    if (this.fetchedAt === null) return true;
    return Date.now() - this.fetchedAt > this.ttl;
  }

  private async doRefresh(): Promise<void> {
    const result = await this.client.getDefinitions({
      ifNoneMatch: this.etag ?? undefined,
    });

    // Always reset fetchedAt so the TTL window restarts, even on 304.
    this.fetchedAt = Date.now();

    if (result === null) return; // 304 — definitions unchanged, keep existing cache.

    this.etag = result.etag;
    this.cache.clear();
    for (const flag of result.flags) {
      this.cache.set(flag.key, flag);
    }
  }
}
