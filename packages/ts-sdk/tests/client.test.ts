import { beforeEach, describe, expect, it, vi } from "vitest";
import { FeatureFlagClient } from "../src/client.js";
import { FeatureFlagError } from "../src/types.js";

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
