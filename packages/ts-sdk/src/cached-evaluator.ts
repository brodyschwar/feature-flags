import { evaluate } from "@feature-flags/flag-evaluation";
import type { FlagDefinition } from "@feature-flags/flag-evaluation";
import type { FeatureFlagClient } from "./client.js";
import type { EvaluationContext } from "./types.js";
import { FeatureFlagError } from "./types.js";

export interface CachedFlagEvaluatorOptions<T extends string> {
  /** The HTTP client used to fetch flag definitions. */
  client: FeatureFlagClient;
  /**
   * The flag keys this service uses. Serves dual purpose:
   *
   * - **Runtime:** sent as `?keys=...` to `GET /flags/definitions`, so only
   *   the relevant flag definitions are fetched and cached.
   * - **Compile time:** with `as const`, TypeScript infers the literal union
   *   type `T` and constrains `evaluate()` to only accept those keys.
   *
   * Pass `as const` to get literal-type inference:
   *   flags: ["flag-a", "flag-b"] as const
   */
  flags: readonly T[];
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
  /**
   * When true, opens a persistent SSE connection to GET /flags/stream and
   * updates the cache immediately when the API pushes a flag_updated or
   * flag_deleted event. TTL polling continues to run as a backstop.
   *
   * Default: false.
   */
  liveUpdates?: boolean;
}

const DEFAULT_TTL = 30_000;

export class CachedFlagEvaluator<T extends string> {
  private readonly client: FeatureFlagClient;
  private readonly flagKeys: readonly T[];
  private readonly ttl: number;
  private readonly staleWhileRevalidate: boolean;

  private readonly liveUpdates: boolean;

  private cache: Map<string, FlagDefinition> = new Map();
  private etag: string | null = null;
  private fetchedAt: number | null = null;
  private inflightRefresh: Promise<void> | null = null;
  private abortController: AbortController | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay: number = 1_000;

  constructor(options: CachedFlagEvaluatorOptions<T>) {
    this.client = options.client;
    this.flagKeys = options.flags;
    this.ttl = options.ttl ?? DEFAULT_TTL;
    this.staleWhileRevalidate = options.staleWhileRevalidate ?? false;
    this.liveUpdates = options.liveUpdates ?? false;
  }

  /**
   * Evaluate a flag locally using the cached definition.
   *
   * `flagKey` is constrained to the union `T` — passing a key not in the
   * `flags` constructor option is a compile-time error.
   *
   * - Cold cache: fetches definitions for the configured keys before evaluating.
   * - Stale cache + default mode: awaits a refresh before evaluating.
   * - Stale cache + staleWhileRevalidate: returns the cached value immediately
   *   and triggers a background refresh for subsequent calls.
   * - Cache miss after bulk refresh: falls back to fetching the single flag.
   */
  async evaluate(flagKey: T, context?: EvaluationContext): Promise<boolean> {
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
   * Evaluate a flag, returning `defaultValue` instead of throwing on any error
   * (flag not found, flags API unreachable, etc.).
   *
   * Prefer this over evaluate() in production route handlers where a flag
   * outage should degrade gracefully rather than surface as a 5xx.
   */
  async safeEvaluate(
    flagKey: T,
    defaultValue: boolean,
    context?: EvaluationContext
  ): Promise<boolean> {
    return this.evaluate(flagKey, context).catch(() => defaultValue);
  }

  /**
   * Pre-populate the cache with all flag definitions.
   * Call once at startup to eliminate cold-start latency on the first evaluate().
   * When `liveUpdates` is true, also opens the SSE connection after the cache is populated.
   */
  async warm(): Promise<void> {
    await this.refresh();
    if (this.liveUpdates) {
      this.connect();
    }
  }

  /**
   * Open the SSE connection to receive live flag updates.
   * Idempotent — calling while already connected or in a reconnect cycle is a no-op.
   */
  connect(): void {
    if (this.abortController !== null) return;
    this.abortController = new AbortController();
    void this.startStream();
  }

  /**
   * Close the SSE connection and cancel any pending reconnect timer.
   * The cache is preserved; the evaluator falls back to TTL polling.
   * Safe to call when not connected.
   */
  disconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.abortController !== null) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.reconnectDelay = 1_000;
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

  private async startStream(): Promise<void> {
    const controller = this.abortController;
    if (!controller) return;

    // Obtain the iterator directly so we can call return() on abort.
    const iterator = this.client.streamDefinitions({
      keys: [...this.flagKeys],
      signal: controller.signal,
    })[Symbol.asyncIterator]();

    // When disconnect() aborts the signal, cancel the iterator so the
    // pending next() resolves immediately with done: true.
    const abortHandler = () => { void iterator.return?.(); };
    controller.signal.addEventListener("abort", abortHandler, { once: true });

    try {
      let result: IteratorResult<import("./types.js").FlagStreamEvent>;
      while (!(result = await iterator.next()).done) {
        const event = result.value;
        if (event.type === "flag_updated") {
          this.cache.set(event.definition.key, event.definition);
          this.fetchedAt = Date.now();
        } else if (event.type === "flag_deleted") {
          this.cache.delete(event.key);
        }
        // heartbeat: no-op
      }
    } catch {
      // Connection error — handled below.
    } finally {
      controller.signal.removeEventListener("abort", abortHandler);
    }

    // If the stream ended and we haven't been intentionally disconnected,
    // schedule a reconnect.
    if (this.abortController !== null && !controller.signal.aborted) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.abortController === null) return;

    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.abortController === null) return;

      // Refresh to fill any gap missed during the disconnect.
      try { await this.refresh(); } catch { /* best effort */ }

      if (this.abortController === null) return;

      // Reset backoff on successful reconnect and start a new stream.
      this.reconnectDelay = 1_000;
      this.abortController = new AbortController();
      void this.startStream();
    }, delay);
  }

  private isStale(): boolean {
    if (this.fetchedAt === null) return true;
    return Date.now() - this.fetchedAt > this.ttl;
  }

  private async doRefresh(): Promise<void> {
    const result = await this.client.getDefinitions({
      keys: [...this.flagKeys],
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
