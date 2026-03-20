import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CachedFlagEvaluator } from "../src/cached-evaluator.js";
import type { FeatureFlagClient } from "../src/client.js";
import type { FlagStreamEvent } from "../src/types.js";
import type { FlagDefinition } from "@feature-flags/flag-evaluation";

// ── Controllable async iterable ───────────────────────────────────────────────

interface StreamController {
  emit: (event: FlagStreamEvent) => void;
  error: (err: Error) => void;
  end: () => void;
}

function makeControllableStream(): { controller: StreamController; iterable: AsyncIterable<FlagStreamEvent> } {
  type QueueItem =
    | { kind: "event"; value: FlagStreamEvent }
    | { kind: "error"; value: Error }
    | { kind: "end" };

  const queue: QueueItem[] = [];
  let waiting: {
    resolve: (r: IteratorResult<FlagStreamEvent>) => void;
    reject: (err: unknown) => void;
  } | null = null;

  const flush = () => {
    if (!waiting || queue.length === 0) return;
    const item = queue.shift()!;
    const w = waiting;
    waiting = null;
    if (item.kind === "event") w.resolve({ value: item.value, done: false });
    else if (item.kind === "error") w.reject(item.value);
    else w.resolve({ value: undefined as unknown as FlagStreamEvent, done: true });
  };

  const controller: StreamController = {
    emit(event) { queue.push({ kind: "event", value: event }); flush(); },
    error(err) { queue.push({ kind: "error", value: err }); flush(); },
    end() { queue.push({ kind: "end" }); flush(); },
  };

  const iterable: AsyncIterable<FlagStreamEvent> = {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<FlagStreamEvent>> {
          if (queue.length > 0) {
            const item = queue.shift()!;
            if (item.kind === "event") return Promise.resolve({ value: item.value, done: false });
            if (item.kind === "error") return Promise.reject(item.value);
            return Promise.resolve({ value: undefined as unknown as FlagStreamEvent, done: true });
          }
          return new Promise((resolve, reject) => { waiting = { resolve, reject }; });
        },
        return(): Promise<IteratorResult<FlagStreamEvent>> {
          // Resolve any pending next() so the for-await loop exits cleanly.
          if (waiting) {
            const w = waiting;
            waiting = null;
            w.resolve({ value: undefined as unknown as FlagStreamEvent, done: true });
          }
          return Promise.resolve({ value: undefined as unknown as FlagStreamEvent, done: true });
        },
      };
    },
  };

  return { controller, iterable };
}

// ── Mock client factory ───────────────────────────────────────────────────────

const boolFlag: FlagDefinition = { key: "flag-a", type: "boolean", rules: { enabled: true } };

function makeMockClient(
  flagDefs: FlagDefinition[] = [boolFlag],
  streamFactory?: () => AsyncIterable<FlagStreamEvent>,
) {
  const getDefinitions = vi.fn().mockResolvedValue({ flags: flagDefs, etag: "etag-1" });
  const getDefinition = vi.fn();
  const { controller: defaultController, iterable: defaultIterable } = makeControllableStream();
  const streamDefinitions = vi.fn().mockImplementation(
    streamFactory ?? (() => defaultIterable),
  );

  return {
    client: { getDefinitions, getDefinition, streamDefinitions } as unknown as FeatureFlagClient,
    getDefinitions,
    getDefinition,
    streamDefinitions,
    defaultController,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Flush the microtask queue by awaiting Promise.resolve() several times.
 * Works even when vi.useFakeTimers fakes setImmediate.
 */
async function flushMicrotasks(ticks = 20) {
  for (let i = 0; i < ticks; i++) await Promise.resolve();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CachedFlagEvaluator — live updates (liveUpdates: true)", () => {
  // Only fake setTimeout/clearTimeout so setImmediate and Promises are unaffected.
  beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("warm() calls connect() after cache is populated", async () => {
    const { client, getDefinitions, streamDefinitions, defaultController } = makeMockClient();

    const evaluator = new CachedFlagEvaluator({
      client,
      flags: ["flag-a"] as const,
      liveUpdates: true,
    });

    await evaluator.warm();
    await flushMicrotasks();

    expect(getDefinitions).toHaveBeenCalledOnce();
    expect(streamDefinitions).toHaveBeenCalledOnce();

    evaluator.disconnect();
    defaultController.end();
  });

  it("connect() is a no-op when already connected", async () => {
    const { client, streamDefinitions, defaultController } = makeMockClient();

    const evaluator = new CachedFlagEvaluator({
      client,
      flags: ["flag-a"] as const,
      liveUpdates: true,
    });

    await evaluator.warm();
    await flushMicrotasks();

    evaluator.connect(); // second call — no-op
    evaluator.connect(); // third call — no-op

    expect(streamDefinitions).toHaveBeenCalledOnce();

    evaluator.disconnect();
    defaultController.end();
  });

  it("flag_updated event updates the cache immediately without an additional HTTP call", async () => {
    const { client, getDefinitions, defaultController } = makeMockClient();

    const evaluator = new CachedFlagEvaluator({
      client,
      flags: ["flag-a"] as const,
      liveUpdates: true,
    });

    await evaluator.warm();
    await flushMicrotasks();

    expect(await evaluator.evaluate("flag-a")).toBe(true);

    const disabledDef: FlagDefinition = { key: "flag-a", type: "boolean", rules: { enabled: false } };
    defaultController.emit({ type: "flag_updated", definition: disabledDef });
    await flushMicrotasks();

    expect(await evaluator.evaluate("flag-a")).toBe(false);
    // Only the initial warm() caused an HTTP call — the update arrived via SSE.
    expect(getDefinitions).toHaveBeenCalledOnce();

    evaluator.disconnect();
  });

  it("flag_deleted event removes the flag; next evaluate() falls back to getDefinition()", async () => {
    const { client, getDefinition, defaultController } = makeMockClient();
    getDefinition.mockResolvedValue(null); // simulate 404 after deletion

    const evaluator = new CachedFlagEvaluator({
      client,
      flags: ["flag-a"] as const,
      liveUpdates: true,
    });

    await evaluator.warm();
    await flushMicrotasks();

    defaultController.emit({ type: "flag_deleted", key: "flag-a" });
    await flushMicrotasks();

    await expect(evaluator.evaluate("flag-a")).rejects.toMatchObject({
      name: "FeatureFlagError",
      message: 'Flag "flag-a" not found',
    });
    expect(getDefinition).toHaveBeenCalledWith("flag-a");

    evaluator.disconnect();
  });

  it("heartbeat event causes no cache change and no additional HTTP call", async () => {
    const { client, getDefinitions, getDefinition, defaultController } = makeMockClient();

    const evaluator = new CachedFlagEvaluator({
      client,
      flags: ["flag-a"] as const,
      liveUpdates: true,
    });

    await evaluator.warm();
    await flushMicrotasks();

    defaultController.emit({ type: "heartbeat" });
    defaultController.emit({ type: "heartbeat" });
    await flushMicrotasks();

    expect(await evaluator.evaluate("flag-a")).toBe(true);
    expect(getDefinitions).toHaveBeenCalledOnce();
    expect(getDefinition).not.toHaveBeenCalled();

    evaluator.disconnect();
  });

  it("rapid successive flag_updated events for the same key leave the last value in cache", async () => {
    const { client, defaultController } = makeMockClient();

    const evaluator = new CachedFlagEvaluator({
      client,
      flags: ["flag-a"] as const,
      liveUpdates: true,
    });

    await evaluator.warm();
    await flushMicrotasks();

    const disabled: FlagDefinition = { key: "flag-a", type: "boolean", rules: { enabled: false } };
    const enabled: FlagDefinition = { key: "flag-a", type: "boolean", rules: { enabled: true } };

    defaultController.emit({ type: "flag_updated", definition: disabled });
    defaultController.emit({ type: "flag_updated", definition: enabled });
    defaultController.emit({ type: "flag_updated", definition: disabled }); // last one wins
    await flushMicrotasks();

    expect(await evaluator.evaluate("flag-a")).toBe(false);

    evaluator.disconnect();
  });

  it("disconnect() cancels any pending reconnect timer and aborts the stream", async () => {
    let streamController!: StreamController;
    const streamDefinitions = vi.fn().mockImplementation(() => {
      const { controller, iterable } = makeControllableStream();
      streamController = controller;
      return iterable;
    });
    const getDefinitions = vi.fn().mockResolvedValue({ flags: [boolFlag], etag: "etag-1" });
    const client = { getDefinitions, getDefinition: vi.fn(), streamDefinitions } as unknown as FeatureFlagClient;

    const evaluator = new CachedFlagEvaluator({
      client,
      flags: ["flag-a"] as const,
      liveUpdates: true,
      ttl: 60_000,
    });

    await evaluator.warm();
    await flushMicrotasks();

    // Trigger a connection error — this schedules a reconnect timer.
    streamController.error(new Error("connection dropped"));
    await flushMicrotasks();

    // Disconnect before the timer fires.
    evaluator.disconnect();

    // Advance well past the reconnect delay — no new stream should open.
    await vi.runAllTimersAsync();
    await flushMicrotasks();

    expect(streamDefinitions).toHaveBeenCalledOnce();
  });

  it("connection error preserves the cache and schedules a reconnect", async () => {
    let streamController!: StreamController;
    const streamDefinitions = vi.fn().mockImplementation(() => {
      const { controller, iterable } = makeControllableStream();
      streamController = controller;
      return iterable;
    });
    const getDefinitions = vi.fn().mockResolvedValue({ flags: [boolFlag], etag: "etag-1" });
    const client = { getDefinitions, getDefinition: vi.fn(), streamDefinitions } as unknown as FeatureFlagClient;

    const evaluator = new CachedFlagEvaluator({
      client,
      flags: ["flag-a"] as const,
      liveUpdates: true,
      ttl: 60_000,
    });

    await evaluator.warm();
    await flushMicrotasks();

    // Trigger a connection error.
    streamController.error(new Error("ECONNRESET"));
    await flushMicrotasks();

    // Cache is still valid — evaluate() works without a new HTTP call.
    expect(await evaluator.evaluate("flag-a")).toBe(true);
    expect(getDefinitions).toHaveBeenCalledOnce();

    // Advance past the 1s reconnect delay.
    await vi.advanceTimersByTimeAsync(1_000);
    await flushMicrotasks();

    // A second stream was opened (the reconnect).
    expect(streamDefinitions).toHaveBeenCalledTimes(2);
    // refresh() was called before the new stream opened.
    expect(getDefinitions).toHaveBeenCalledTimes(2);

    evaluator.disconnect();
    streamController.end();
  });

  it("reconnect uses exponential backoff capped at 30s", async () => {
    let streamController!: StreamController;
    const streamDefinitions = vi.fn().mockImplementation(() => {
      const { controller, iterable } = makeControllableStream();
      streamController = controller;
      return iterable;
    });
    const getDefinitions = vi.fn().mockResolvedValue({ flags: [boolFlag], etag: "etag-1" });
    const client = { getDefinitions, getDefinition: vi.fn(), streamDefinitions } as unknown as FeatureFlagClient;

    const evaluator = new CachedFlagEvaluator({
      client,
      flags: ["flag-a"] as const,
      liveUpdates: true,
      ttl: 60_000,
    });

    await evaluator.warm();
    await flushMicrotasks();
    expect(streamDefinitions).toHaveBeenCalledTimes(1);

    const triggerErrorAndAdvance = async (delayMs: number) => {
      streamController.error(new Error("dropped"));
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(delayMs);
      await flushMicrotasks();
    };

    await triggerErrorAndAdvance(1_000);  // delay 1s
    expect(streamDefinitions).toHaveBeenCalledTimes(2);

    await triggerErrorAndAdvance(2_000);  // delay 2s
    expect(streamDefinitions).toHaveBeenCalledTimes(3);

    await triggerErrorAndAdvance(4_000);  // delay 4s
    expect(streamDefinitions).toHaveBeenCalledTimes(4);

    await triggerErrorAndAdvance(8_000);  // delay 8s
    expect(streamDefinitions).toHaveBeenCalledTimes(5);

    await triggerErrorAndAdvance(16_000); // delay 16s
    expect(streamDefinitions).toHaveBeenCalledTimes(6);

    await triggerErrorAndAdvance(30_000); // delay capped at 30s
    expect(streamDefinitions).toHaveBeenCalledTimes(7);

    await triggerErrorAndAdvance(30_000); // still capped at 30s
    expect(streamDefinitions).toHaveBeenCalledTimes(8);

    evaluator.disconnect();
  });

  it("backoff resets to 1s after a successful reconnect", async () => {
    let failCount = 0;
    let streamController!: StreamController;

    const streamDefinitions = vi.fn().mockImplementation(() => {
      const { controller, iterable } = makeControllableStream();
      streamController = controller;
      failCount++;
      return iterable;
    });
    const getDefinitions = vi.fn().mockResolvedValue({ flags: [boolFlag], etag: "etag-1" });
    const client = { getDefinitions, getDefinition: vi.fn(), streamDefinitions } as unknown as FeatureFlagClient;

    const evaluator = new CachedFlagEvaluator({
      client,
      flags: ["flag-a"] as const,
      liveUpdates: true,
      ttl: 60_000,
    });

    await evaluator.warm();
    await flushMicrotasks();

    // First stream: fail immediately → 1s reconnect
    streamController.error(new Error("dropped"));
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(1_000);
    await flushMicrotasks();
    expect(streamDefinitions).toHaveBeenCalledTimes(2);

    // Second stream: fail immediately → 2s reconnect
    streamController.error(new Error("dropped"));
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(2_000);
    await flushMicrotasks();
    expect(streamDefinitions).toHaveBeenCalledTimes(3);

    // Third stream: stays open (backoff should have reset to 1s)
    // Trigger error — next reconnect should use 1s again.
    streamController.error(new Error("dropped again"));
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(1_000); // 1s — if backoff reset correctly, this is enough
    await flushMicrotasks();
    expect(streamDefinitions).toHaveBeenCalledTimes(4);

    evaluator.disconnect();
    streamController.end();
  });

  it("refresh() is called before the new stream opens on reconnect", async () => {
    let streamController!: StreamController;
    const callOrder: string[] = [];

    const streamDefinitions = vi.fn().mockImplementation(() => {
      callOrder.push("streamDefinitions");
      const { controller, iterable } = makeControllableStream();
      streamController = controller;
      return iterable;
    });
    const getDefinitions = vi.fn().mockImplementation(async () => {
      callOrder.push("getDefinitions");
      return { flags: [boolFlag], etag: "etag-1" };
    });
    const client = { getDefinitions, getDefinition: vi.fn(), streamDefinitions } as unknown as FeatureFlagClient;

    const evaluator = new CachedFlagEvaluator({
      client,
      flags: ["flag-a"] as const,
      liveUpdates: true,
      ttl: 60_000,
    });

    await evaluator.warm();
    await flushMicrotasks();

    streamController.error(new Error("dropped"));
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(1_000);
    await flushMicrotasks();

    expect(callOrder).toEqual([
      "getDefinitions",    // warm() → refresh()
      "streamDefinitions", // warm() → connect()
      "getDefinitions",    // reconnect → refresh()
      "streamDefinitions", // reconnect → new stream
    ]);

    evaluator.disconnect();
    streamController.end();
  });
});
