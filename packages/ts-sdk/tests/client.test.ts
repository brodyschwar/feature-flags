import { beforeEach, describe, expect, it, vi } from "vitest";
import { FeatureFlagClient } from "../src/client.js";
import { FeatureFlagError } from "../src/types.js";
import type { FlagStreamEvent } from "../src/types.js";
import type { FlagDefinition } from "@feature-flags/flag-evaluation";

const BASE_URL = "http://localhost:3001";
const API_KEY = "ff_test";

function makeClient() {
  return new FeatureFlagClient({ baseUrl: BASE_URL, apiKey: API_KEY });
}

describe("FeatureFlagClient.evaluate", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns true when the API responds with result: true", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ key: "my-flag", result: true }),
    });

    expect(await makeClient().evaluate("my-flag")).toBe(true);
  });

  it("returns false when the API responds with result: false", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ key: "my-flag", result: false }),
    });

    expect(await makeClient().evaluate("my-flag")).toBe(false);
  });

  it("sends userId and attributes in the request body", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ key: "my-flag", result: true }),
    });

    await makeClient().evaluate("my-flag", {
      userId: "user_123",
      attributes: { plan: "pro" },
    });

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.context).toEqual({ userId: "user_123", attributes: { plan: "pro" } });
  });

  it("throws FeatureFlagError with status on non-2xx response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "Flag not found" }),
    });

    await expect(makeClient().evaluate("missing-flag")).rejects.toMatchObject({
      name: "FeatureFlagError",
      status: 404,
      message: "Flag not found",
    });
  });

  it("throws FeatureFlagError with no status on network failure", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(makeClient().evaluate("my-flag")).rejects.toMatchObject({
      name: "FeatureFlagError",
      status: undefined,
      message: "ECONNREFUSED",
    });
  });
});

describe("FeatureFlagClient.safeEvaluate", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("returns the flag value when evaluation succeeds", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ key: "my-flag", result: true }),
    });

    expect(await makeClient().safeEvaluate("my-flag", false)).toBe(true);
  });

  it("returns defaultValue on non-2xx response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "Flag not found" }),
    });

    expect(await makeClient().safeEvaluate("missing-flag", true)).toBe(true);
    expect(await makeClient().safeEvaluate("missing-flag", false)).toBe(false);
  });

  it("returns defaultValue on network failure", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    expect(await makeClient().safeEvaluate("my-flag", true)).toBe(true);
  });
});

// ── FeatureFlagClient.getDefinitions ─────────────────────────────

const stubFlag: FlagDefinition = { key: "bool-flag", type: "boolean", rules: { enabled: true } };

function makeDefinitionsResponse(flags: FlagDefinition[], etag = '"v1"') {
  return {
    ok: true,
    status: 200,
    headers: { get: (h: string) => h === "ETag" ? etag : null },
    json: async () => ({ flags }),
  };
}

describe("FeatureFlagClient.getDefinitions", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("returns { flags, etag } on 200", async () => {
    global.fetch = vi.fn().mockResolvedValue(makeDefinitionsResponse([stubFlag]));

    const result = await makeClient().getDefinitions();
    expect(result).toEqual({ flags: [stubFlag], etag: '"v1"' });
  });

  it("returns null on 304", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 304,
      headers: { get: () => null },
      json: async () => ({}),
    });

    expect(await makeClient().getDefinitions()).toBeNull();
  });

  it("sends Authorization header", async () => {
    global.fetch = vi.fn().mockResolvedValue(makeDefinitionsResponse([]));

    await makeClient().getDefinitions();
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers["Authorization"]).toBe("Bearer ff_test");
  });

  it("sends If-None-Match header when ifNoneMatch is provided", async () => {
    global.fetch = vi.fn().mockResolvedValue(makeDefinitionsResponse([]));

    await makeClient().getDefinitions({ ifNoneMatch: '"abc"' });
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers["If-None-Match"]).toBe('"abc"');
  });

  it("does not send If-None-Match when ifNoneMatch is not provided", async () => {
    global.fetch = vi.fn().mockResolvedValue(makeDefinitionsResponse([]));

    await makeClient().getDefinitions();
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers["If-None-Match"]).toBeUndefined();
  });

  it("appends ?type= query param when type is provided", async () => {
    global.fetch = vi.fn().mockResolvedValue(makeDefinitionsResponse([]));

    await makeClient().getDefinitions({ type: "boolean" });
    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("?type=boolean");
  });

  it("appends ?keys= query param when keys are provided", async () => {
    global.fetch = vi.fn().mockResolvedValue(makeDefinitionsResponse([]));

    await makeClient().getDefinitions({ keys: ["flag-a", "flag-b"] });
    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("keys=flag-a%2Cflag-b");
  });

  it("does not append ?keys= when keys is not provided", async () => {
    global.fetch = vi.fn().mockResolvedValue(makeDefinitionsResponse([]));

    await makeClient().getDefinitions();
    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).not.toContain("keys=");
  });

  it("throws FeatureFlagError with status on non-2xx", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 500,
      headers: { get: () => null },
      json: async () => ({ error: "Internal server error" }),
    });

    await expect(makeClient().getDefinitions()).rejects.toMatchObject({
      name: "FeatureFlagError",
      status: 500,
      message: "Internal server error",
    });
  });

  it("throws FeatureFlagError with no status on network failure", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("timeout"));

    await expect(makeClient().getDefinitions()).rejects.toMatchObject({
      name: "FeatureFlagError",
      status: undefined,
      message: "timeout",
    });
  });
});

// ── FeatureFlagClient.getDefinition ──────────────────────────────

describe("FeatureFlagClient.getDefinition", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("returns { flag, etag } on 200", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      headers: { get: (h: string) => h === "ETag" ? '"v1"' : null },
      json: async () => stubFlag,
    });

    const result = await makeClient().getDefinition("bool-flag");
    expect(result).toEqual({ flag: stubFlag, etag: '"v1"' });
  });

  it("returns null on 304", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 304,
      headers: { get: () => null },
      json: async () => ({}),
    });

    expect(await makeClient().getDefinition("bool-flag")).toBeNull();
  });

  it("calls the correct URL", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      headers: { get: () => '"v1"' },
      json: async () => stubFlag,
    });

    await makeClient().getDefinition("my-flag");
    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`${BASE_URL}/flags/my-flag/definition`);
  });

  it("sends Authorization header", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      headers: { get: () => '"v1"' },
      json: async () => stubFlag,
    });

    await makeClient().getDefinition("my-flag");
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers["Authorization"]).toBe("Bearer ff_test");
  });

  it("sends If-None-Match header when ifNoneMatch is provided", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      headers: { get: () => '"v2"' },
      json: async () => stubFlag,
    });

    await makeClient().getDefinition("my-flag", { ifNoneMatch: '"v1"' });
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers["If-None-Match"]).toBe('"v1"');
  });

  it("throws FeatureFlagError with status on non-2xx", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 404,
      headers: { get: () => null },
      json: async () => ({ error: "Flag not found" }),
    });

    await expect(makeClient().getDefinition("missing")).rejects.toMatchObject({
      name: "FeatureFlagError",
      status: 404,
      message: "Flag not found",
    });
  });
});

// ── FeatureFlagClient.streamDefinitions ──────────────────────────

const flagDef: FlagDefinition = { key: "flag-a", type: "boolean", rules: { enabled: true } };

function makeSSEStream(chunks: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function sseMessage(eventType: string, data: unknown) {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function collectEvents(client: FeatureFlagClient, signal?: AbortSignal): Promise<FlagStreamEvent[]> {
  const events: FlagStreamEvent[] = [];
  for await (const event of client.streamDefinitions({ signal })) {
    events.push(event);
  }
  return events;
}

describe("FeatureFlagClient.streamDefinitions", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("yields flag_updated events", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      body: makeSSEStream([sseMessage("flag_updated", flagDef)]),
    });

    const events = await collectEvents(makeClient());
    expect(events).toEqual([{ type: "flag_updated", definition: flagDef }]);
  });

  it("yields flag_deleted events", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      body: makeSSEStream([sseMessage("flag_deleted", { key: "flag-a" })]),
    });

    const events = await collectEvents(makeClient());
    expect(events).toEqual([{ type: "flag_deleted", key: "flag-a" }]);
  });

  it("yields heartbeat events", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      body: makeSSEStream([sseMessage("heartbeat", {})]),
    });

    const events = await collectEvents(makeClient());
    expect(events).toEqual([{ type: "heartbeat" }]);
  });

  it("yields multiple events from a single stream", async () => {
    const updatedDef = { ...flagDef, rules: { enabled: false } };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      body: makeSSEStream([
        sseMessage("flag_updated", flagDef),
        sseMessage("heartbeat", {}),
        sseMessage("flag_deleted", { key: "flag-a" }),
        sseMessage("flag_updated", updatedDef),
      ]),
    });

    const events = await collectEvents(makeClient());
    expect(events).toHaveLength(4);
    expect(events[0]).toEqual({ type: "flag_updated", definition: flagDef });
    expect(events[1]).toEqual({ type: "heartbeat" });
    expect(events[2]).toEqual({ type: "flag_deleted", key: "flag-a" });
    expect(events[3]).toEqual({ type: "flag_updated", definition: updatedDef });
  });

  it("yields events split across multiple chunks", async () => {
    const msg = sseMessage("flag_updated", flagDef);
    const mid = Math.floor(msg.length / 2);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      body: makeSSEStream([msg.slice(0, mid), msg.slice(mid)]),
    });

    const events = await collectEvents(makeClient());
    expect(events).toEqual([{ type: "flag_updated", definition: flagDef }]);
  });

  it("sends Authorization and Accept headers", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      body: makeSSEStream([]),
    });

    await collectEvents(makeClient());
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers["Authorization"]).toBe("Bearer ff_test");
    expect(init.headers["Accept"]).toBe("text/event-stream");
  });

  it("appends ?keys= query param when keys are provided", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      body: makeSSEStream([]),
    });

    for await (const _ of makeClient().streamDefinitions({ keys: ["flag-a", "flag-b"] })) { /* drain */ }
    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("keys=flag-a%2Cflag-b");
  });

  it("throws FeatureFlagError on non-2xx initial response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 401,
      json: async () => ({ error: "Unauthorized" }),
    });

    const gen = makeClient().streamDefinitions();
    await expect(gen.next()).rejects.toMatchObject({
      name: "FeatureFlagError",
      status: 401,
      message: "Unauthorized",
    });
  });

  it("ends the iterable cleanly when the signal is aborted before the stream starts", async () => {
    const abortController = new AbortController();
    abortController.abort();

    global.fetch = vi.fn().mockRejectedValue(Object.assign(new Error("AbortError"), { name: "AbortError" }));

    const events = await collectEvents(makeClient(), abortController.signal);
    expect(events).toHaveLength(0);
  });
});
