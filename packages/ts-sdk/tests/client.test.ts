import { beforeEach, describe, expect, it, vi } from "vitest";
import { FeatureFlagClient } from "../src/client.js";
import { FeatureFlagError } from "../src/types.js";
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
