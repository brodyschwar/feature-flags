import { afterEach, describe, expect, it, vi } from "vitest";
import { CachedFlagEvaluator } from "../src/cached-evaluator.js";
import type { FeatureFlagClient } from "../src/client.js";
import { FeatureFlagError } from "../src/types.js";
import type { FlagDefinition } from "@feature-flags/flag-evaluation";

// ── Fixtures ─────────────────────────────────────────────────────

const boolFlag: FlagDefinition = {
  key: "bool-flag",
  type: "boolean",
  rules: { enabled: true },
};

const pctFlag: FlagDefinition = {
  key: "pct-flag",
  type: "percentage",
  rules: { percentage: 100 }, // always enabled for any userId
};

// ── Helpers ───────────────────────────────────────────────────────

/** Build a mock FeatureFlagClient whose getDefinitions() resolves immediately. */
function makeClient(
  flags: FlagDefinition[] = [boolFlag],
  etag = '"v1"'
): FeatureFlagClient {
  return {
    getDefinitions: vi.fn().mockResolvedValue({ flags, etag }),
    getDefinition: vi.fn().mockResolvedValue({ flag: boolFlag, etag: '"v1"' }),
  } as unknown as FeatureFlagClient;
}

/** Deferred promise — lets tests control exactly when an async operation resolves. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Flush the microtask queue so background (void) refresh promises settle. */
async function flushMicrotasks() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

// ── Tests ─────────────────────────────────────────────────────────

afterEach(() => {
  vi.useRealTimers();
});

// ── Cold cache ────────────────────────────────────────────────────

describe("cold cache", () => {
  it("fetches definitions on first evaluate()", async () => {
    const client = makeClient([boolFlag]);
    const evaluator = new CachedFlagEvaluator({ client });

    const result = await evaluator.evaluate("bool-flag");

    expect(client.getDefinitions).toHaveBeenCalledTimes(1);
    expect(result).toBe(true);
  });

  it("evaluates locally — does not call the /evaluate endpoint", async () => {
    // pctFlag at 100% → always true for any userId
    const client = makeClient([pctFlag]);
    const evaluator = new CachedFlagEvaluator({ client });

    const result = await evaluator.evaluate("pct-flag", { userId: "user-1" });

    expect(result).toBe(true);
    // getDefinitions was called; there is no 'evaluate' method on the mock client
    expect(client.getDefinitions).toHaveBeenCalledTimes(1);
  });
});

// ── Warm cache within TTL ─────────────────────────────────────────

describe("warm cache within TTL", () => {
  it("does not call getDefinitions() again while cache is fresh", async () => {
    const client = makeClient([boolFlag]);
    const evaluator = new CachedFlagEvaluator({ client, ttl: 30_000 });

    await evaluator.evaluate("bool-flag");
    await evaluator.evaluate("bool-flag");
    await evaluator.evaluate("bool-flag");

    expect(client.getDefinitions).toHaveBeenCalledTimes(1);
  });
});

// ── Stale cache — blocking mode (default) ─────────────────────────

describe("stale cache — blocking mode", () => {
  it("awaits a fresh fetch before returning when TTL has expired", async () => {
    vi.useFakeTimers();
    const client = makeClient([boolFlag]);
    const evaluator = new CachedFlagEvaluator({ client, ttl: 1_000 });

    await evaluator.evaluate("bool-flag");
    expect(client.getDefinitions).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1_001);
    await evaluator.evaluate("bool-flag");

    expect(client.getDefinitions).toHaveBeenCalledTimes(2);
  });

  it("returns the refreshed value, not the stale one", async () => {
    vi.useFakeTimers();
    const updatedFlag: FlagDefinition = {
      key: "bool-flag",
      type: "boolean",
      rules: { enabled: false },
    };
    const client = {
      getDefinitions: vi.fn()
        .mockResolvedValueOnce({ flags: [boolFlag], etag: '"v1"' })
        .mockResolvedValueOnce({ flags: [updatedFlag], etag: '"v2"' }),
      getDefinition: vi.fn(),
    } as unknown as FeatureFlagClient;

    const evaluator = new CachedFlagEvaluator({ client, ttl: 1_000 });

    expect(await evaluator.evaluate("bool-flag")).toBe(true);
    vi.advanceTimersByTime(1_001);
    expect(await evaluator.evaluate("bool-flag")).toBe(false);
  });
});

// ── Stale cache — staleWhileRevalidate ────────────────────────────

describe("stale cache — staleWhileRevalidate mode", () => {
  it("returns the stale value immediately then serves the fresh value after background refresh", async () => {
    vi.useFakeTimers();
    const updatedFlag: FlagDefinition = {
      key: "bool-flag",
      type: "boolean",
      rules: { enabled: false },
    };
    const client = {
      getDefinitions: vi.fn()
        .mockResolvedValueOnce({ flags: [boolFlag], etag: '"v1"' })
        .mockResolvedValueOnce({ flags: [updatedFlag], etag: '"v2"' }),
      getDefinition: vi.fn(),
    } as unknown as FeatureFlagClient;

    const evaluator = new CachedFlagEvaluator({
      client,
      ttl: 1_000,
      staleWhileRevalidate: true,
    });

    await evaluator.warm();
    vi.advanceTimersByTime(1_001);

    // Returns stale value immediately — does not block
    const staleResult = await evaluator.evaluate("bool-flag");
    expect(staleResult).toBe(true);

    // Background refresh fires; let it settle
    await flushMicrotasks();

    // Subsequent call reflects refreshed cache
    expect(await evaluator.evaluate("bool-flag")).toBe(false);
    expect(client.getDefinitions).toHaveBeenCalledTimes(2);
  });

  it("does NOT use staleWhileRevalidate for a cold cache — still blocks", async () => {
    const client = makeClient([boolFlag]);
    const evaluator = new CachedFlagEvaluator({
      client,
      ttl: 30_000,
      staleWhileRevalidate: true,
    });

    // Cold cache (fetchedAt === null) must always block regardless of the flag
    const result = await evaluator.evaluate("bool-flag");
    expect(result).toBe(true);
    expect(client.getDefinitions).toHaveBeenCalledTimes(1);
  });
});

// ── 304 Not Modified ──────────────────────────────────────────────

describe("304 Not Modified on refresh", () => {
  it("keeps existing definitions and resets fetchedAt", async () => {
    vi.useFakeTimers();
    const client = {
      getDefinitions: vi.fn()
        .mockResolvedValueOnce({ flags: [boolFlag], etag: '"v1"' })
        .mockResolvedValueOnce(null), // 304
      getDefinition: vi.fn(),
    } as unknown as FeatureFlagClient;

    const evaluator = new CachedFlagEvaluator({ client, ttl: 1_000 });
    await evaluator.warm();

    vi.advanceTimersByTime(1_001);

    // Should still evaluate correctly using the preserved cache
    const result = await evaluator.evaluate("bool-flag");
    expect(result).toBe(true);
    expect(client.getDefinitions).toHaveBeenCalledTimes(2);
  });

  it("sends the stored ETag as If-None-Match on subsequent refreshes", async () => {
    vi.useFakeTimers();
    const client = {
      getDefinitions: vi.fn()
        .mockResolvedValueOnce({ flags: [boolFlag], etag: '"abc123"' })
        .mockResolvedValueOnce(null),
      getDefinition: vi.fn(),
    } as unknown as FeatureFlagClient;

    const evaluator = new CachedFlagEvaluator({ client, ttl: 1_000 });
    await evaluator.warm();
    vi.advanceTimersByTime(1_001);
    await evaluator.evaluate("bool-flag");

    expect(client.getDefinitions).toHaveBeenLastCalledWith({
      ifNoneMatch: '"abc123"',
    });
  });

  it("resets the TTL after a 304 so the next call within TTL does not re-fetch", async () => {
    vi.useFakeTimers();
    const client = {
      getDefinitions: vi.fn()
        .mockResolvedValueOnce({ flags: [boolFlag], etag: '"v1"' })
        .mockResolvedValueOnce(null), // 304
      getDefinition: vi.fn(),
    } as unknown as FeatureFlagClient;

    const evaluator = new CachedFlagEvaluator({ client, ttl: 1_000 });
    await evaluator.warm();
    vi.advanceTimersByTime(1_001);
    await evaluator.evaluate("bool-flag"); // triggers refresh (304)

    // fetchedAt was reset — another call within TTL should NOT fetch again
    await evaluator.evaluate("bool-flag");
    expect(client.getDefinitions).toHaveBeenCalledTimes(2);
  });
});

// ── Single-flight coalescing ──────────────────────────────────────

describe("single-flight coalescing", () => {
  it("issues exactly one request when concurrent evaluate() calls race on a cold cache", async () => {
    const { promise, resolve } = deferred<{ flags: FlagDefinition[]; etag: string }>();
    const client = {
      getDefinitions: vi.fn().mockReturnValue(promise),
      getDefinition: vi.fn(),
    } as unknown as FeatureFlagClient;

    const evaluator = new CachedFlagEvaluator({ client });

    // All three start before the fetch resolves
    const p1 = evaluator.evaluate("bool-flag");
    const p2 = evaluator.evaluate("bool-flag");
    const p3 = evaluator.evaluate("bool-flag");

    resolve({ flags: [boolFlag], etag: '"v1"' });

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    expect(client.getDefinitions).toHaveBeenCalledTimes(1);
    expect(r1).toBe(true);
    expect(r2).toBe(true);
    expect(r3).toBe(true);
  });

  it("refresh() called while a refresh is in flight returns the same Promise", async () => {
    const { promise, resolve } = deferred<{ flags: FlagDefinition[]; etag: string }>();
    const client = {
      getDefinitions: vi.fn().mockReturnValue(promise),
      getDefinition: vi.fn(),
    } as unknown as FeatureFlagClient;

    const evaluator = new CachedFlagEvaluator({ client });

    const r1 = evaluator.refresh();
    const r2 = evaluator.refresh();
    const r3 = evaluator.refresh();

    expect(r1).toBe(r2);
    expect(r2).toBe(r3);

    resolve({ flags: [boolFlag], etag: '"v1"' });
    await r1;

    expect(client.getDefinitions).toHaveBeenCalledTimes(1);
  });
});

// ── Cache miss fallback ───────────────────────────────────────────

describe("cache miss fallback to getDefinition()", () => {
  it("calls getDefinition() for a key absent from the bulk cache", async () => {
    const otherFlag: FlagDefinition = {
      key: "other-flag",
      type: "boolean",
      rules: { enabled: false },
    };
    const client = {
      getDefinitions: vi.fn().mockResolvedValue({ flags: [boolFlag], etag: '"v1"' }),
      getDefinition: vi.fn().mockResolvedValue({ flag: otherFlag, etag: '"v2"' }),
    } as unknown as FeatureFlagClient;

    const evaluator = new CachedFlagEvaluator({ client });
    await evaluator.warm();

    const result = await evaluator.evaluate("other-flag");

    expect(client.getDefinition).toHaveBeenCalledWith("other-flag");
    expect(result).toBe(false);
  });

  it("caches the individually-fetched flag for subsequent calls", async () => {
    const otherFlag: FlagDefinition = {
      key: "other-flag",
      type: "boolean",
      rules: { enabled: true },
    };
    const client = {
      getDefinitions: vi.fn().mockResolvedValue({ flags: [], etag: '"v1"' }),
      getDefinition: vi.fn().mockResolvedValue({ flag: otherFlag, etag: '"v2"' }),
    } as unknown as FeatureFlagClient;

    const evaluator = new CachedFlagEvaluator({ client });
    await evaluator.evaluate("other-flag"); // miss → fetches
    await evaluator.evaluate("other-flag"); // hit → no second call

    expect(client.getDefinition).toHaveBeenCalledTimes(1);
  });

  it("throws FeatureFlagError when getDefinition() rejects with 404", async () => {
    const client = {
      getDefinitions: vi.fn().mockResolvedValue({ flags: [], etag: '"v1"' }),
      getDefinition: vi.fn().mockRejectedValue(
        new FeatureFlagError("Flag not found", 404)
      ),
    } as unknown as FeatureFlagClient;

    const evaluator = new CachedFlagEvaluator({ client });

    await expect(evaluator.evaluate("missing-flag")).rejects.toMatchObject({
      name: "FeatureFlagError",
      status: 404,
    });
  });
});

// ── safeEvaluate() ────────────────────────────────────────────────

describe("safeEvaluate()", () => {
  it("returns the flag value when evaluation succeeds", async () => {
    const client = makeClient([boolFlag]);
    const evaluator = new CachedFlagEvaluator({ client });

    expect(await evaluator.safeEvaluate("bool-flag", false)).toBe(true);
  });

  it("returns defaultValue when the flag does not exist", async () => {
    const client = makeClient([]); // empty — "missing-flag" not in cache
    // getDefinition falls back and rejects with 404
    (client.getDefinition as ReturnType<typeof vi.fn>).mockRejectedValue(
      new FeatureFlagError("Flag not found", 404)
    );
    const evaluator = new CachedFlagEvaluator({ client });

    expect(await evaluator.safeEvaluate("missing-flag", true)).toBe(true);
    expect(await evaluator.safeEvaluate("missing-flag", false)).toBe(false);
  });

  it("returns defaultValue when the flags API is unreachable", async () => {
    const client = {
      getDefinitions: vi.fn().mockRejectedValue(new FeatureFlagError("ECONNREFUSED")),
      getDefinition: vi.fn(),
    } as unknown as FeatureFlagClient;
    const evaluator = new CachedFlagEvaluator({ client });

    expect(await evaluator.safeEvaluate("bool-flag", true)).toBe(true);
  });
});

// ── warm() ────────────────────────────────────────────────────────

describe("warm()", () => {
  it("pre-populates the cache so subsequent evaluate() calls need no fetch", async () => {
    const client = makeClient([boolFlag, pctFlag]);
    const evaluator = new CachedFlagEvaluator({ client });

    await evaluator.warm();
    expect(client.getDefinitions).toHaveBeenCalledTimes(1);

    await evaluator.evaluate("bool-flag");
    await evaluator.evaluate("pct-flag", { userId: "u" });

    expect(client.getDefinitions).toHaveBeenCalledTimes(1); // no additional fetches
  });
});
