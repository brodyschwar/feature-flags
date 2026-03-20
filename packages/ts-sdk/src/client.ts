import type { FlagDefinition } from "@feature-flags/flag-evaluation";
import type { EvaluationContext, FeatureFlagClientOptions } from "./types.js";
import { FeatureFlagError } from "./types.js";

export class FeatureFlagClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(options: FeatureFlagClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
  }

  async evaluate(flagKey: string, context?: EvaluationContext): Promise<boolean> {
    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}/flags/${flagKey}/evaluate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ context }),
      });
    } catch (err) {
      throw new FeatureFlagError(
        err instanceof Error ? err.message : "Network request failed"
      );
    }

    if (!response.ok) {
      let message = `Request failed with status ${response.status}`;
      try {
        const body = await response.json();
        if (typeof body?.error === "string") message = body.error;
      } catch {
        // ignore parse errors — use the default message
      }
      throw new FeatureFlagError(message, response.status);
    }

    const data = await response.json() as { key: string; result: boolean };
    return data.result;
  }

  /**
   * Evaluate a flag, returning `defaultValue` instead of throwing on any error
   * (flag not found, API unreachable, non-2xx response, etc.).
   *
   * Prefer this over evaluate() in production route handlers where a flag
   * outage should degrade gracefully rather than surface as a 5xx.
   */
  async safeEvaluate(
    flagKey: string,
    defaultValue: boolean,
    context?: EvaluationContext
  ): Promise<boolean> {
    return this.evaluate(flagKey, context).catch(() => defaultValue);
  }

  /**
   * Fetch evaluation-only payloads for all flags.
   *
   * Returns `{ flags, etag }` on 200 OK.
   * Returns `null` on 304 Not Modified — the caller's cached copy is still current.
   * Throws `FeatureFlagError` on any other non-2xx response.
   */
  async getDefinitions(opts?: {
    type?: "boolean" | "percentage" | "user_segmented";
    keys?: string[];
    ifNoneMatch?: string;
  }): Promise<{ flags: FlagDefinition[]; etag: string } | null> {
    const url = new URL(`${this.baseUrl}/flags/definitions`);
    if (opts?.type) url.searchParams.set("type", opts.type);
    if (opts?.keys?.length) url.searchParams.set("keys", opts.keys.join(","));

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (opts?.ifNoneMatch) headers["If-None-Match"] = opts.ifNoneMatch;

    let response: Response;
    try {
      response = await fetch(url.toString(), { headers });
    } catch (err) {
      throw new FeatureFlagError(
        err instanceof Error ? err.message : "Network request failed"
      );
    }

    if (response.status === 304) return null;

    if (!response.ok) {
      let message = `Request failed with status ${response.status}`;
      try {
        const body = await response.json();
        if (typeof body?.error === "string") message = body.error;
      } catch { /* ignore */ }
      throw new FeatureFlagError(message, response.status);
    }

    const etag = response.headers.get("ETag") ?? "";
    const data = await response.json() as { flags: FlagDefinition[] };
    return { flags: data.flags, etag };
  }

  /**
   * Fetch the evaluation-only payload for a single flag.
   *
   * Returns `{ flag, etag }` on 200 OK.
   * Returns `null` on 304 Not Modified.
   * Throws `FeatureFlagError` on any other non-2xx response.
   */
  async getDefinition(
    flagKey: string,
    opts?: { ifNoneMatch?: string }
  ): Promise<{ flag: FlagDefinition; etag: string } | null> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (opts?.ifNoneMatch) headers["If-None-Match"] = opts.ifNoneMatch;

    let response: Response;
    try {
      response = await fetch(
        `${this.baseUrl}/flags/${flagKey}/definition`,
        { headers }
      );
    } catch (err) {
      throw new FeatureFlagError(
        err instanceof Error ? err.message : "Network request failed"
      );
    }

    if (response.status === 304) return null;

    if (!response.ok) {
      let message = `Request failed with status ${response.status}`;
      try {
        const body = await response.json();
        if (typeof body?.error === "string") message = body.error;
      } catch { /* ignore */ }
      throw new FeatureFlagError(message, response.status);
    }

    const etag = response.headers.get("ETag") ?? "";
    const flag = await response.json() as FlagDefinition;
    return { flag, etag };
  }
}
