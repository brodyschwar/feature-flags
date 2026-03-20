import type { FlagDefinition } from "@feature-flags/flag-evaluation";
import type { EvaluationContext, FeatureFlagClientOptions, FlagStreamEvent } from "./types.js";
import { FeatureFlagError } from "./types.js";

function parseSSEMessage(message: string): FlagStreamEvent | null {
  const lines = message.split("\n");
  let eventType = "";
  let data = "";
  for (const line of lines) {
    if (line.startsWith("event:")) eventType = line.slice(6).trim();
    else if (line.startsWith("data:")) data = line.slice(5).trim();
  }
  if (!eventType) return null;
  try {
    const parsed = data ? (JSON.parse(data) as Record<string, unknown>) : {};
    switch (eventType) {
      case "flag_updated": return { type: "flag_updated", definition: parsed as FlagDefinition };
      case "flag_deleted": return { type: "flag_deleted", key: parsed.key as string };
      case "heartbeat": return { type: "heartbeat" };
      default: return null;
    }
  } catch {
    return null;
  }
}

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

  /**
   * Open an SSE connection to GET /flags/stream and yield parsed events.
   *
   * Throws `FeatureFlagError` if the initial connection is rejected (non-2xx).
   * Silently ends when the provided `signal` is aborted.
   *
   * Uses `fetch()` with a `ReadableStream` to parse the SSE wire format —
   * no `EventSource` dependency, compatible with Node.js 18+.
   */
  async *streamDefinitions(opts?: {
    keys?: string[];
    signal?: AbortSignal;
  }): AsyncGenerator<FlagStreamEvent> {
    const url = new URL(`${this.baseUrl}/flags/stream`);
    if (opts?.keys?.length) url.searchParams.set("keys", opts.keys.join(","));

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "text/event-stream",
        },
        signal: opts?.signal,
      });
    } catch (err) {
      if (opts?.signal?.aborted) return;
      throw new FeatureFlagError(
        err instanceof Error ? err.message : "Network request failed"
      );
    }

    if (!response.ok) {
      let message = `Request failed with status ${response.status}`;
      try {
        const body = await response.json() as Record<string, unknown>;
        if (typeof body?.error === "string") message = body.error as string;
      } catch { /* ignore */ }
      throw new FeatureFlagError(message, response.status);
    }

    if (!response.body) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE messages are separated by blank lines (\n\n)
        const messages = buffer.split(/\r?\n\r?\n/);
        buffer = messages.pop() ?? "";

        for (const message of messages) {
          if (!message.trim()) continue;
          const event = parseSSEMessage(message);
          if (event) yield event;
        }
      }

      // Flush any remaining data in the buffer
      if (buffer.trim()) {
        const event = parseSSEMessage(buffer);
        if (event) yield event;
      }
    } catch (err) {
      if (opts?.signal?.aborted) return;
      throw err;
    } finally {
      reader.releaseLock();
    }
  }
}
