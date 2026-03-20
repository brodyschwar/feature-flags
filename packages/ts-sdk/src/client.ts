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
}
