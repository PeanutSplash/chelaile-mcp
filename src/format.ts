import { CHARACTER_LIMIT } from "./constants.js";
import { z } from "zod";

export enum ResponseFormat {
  MARKDOWN = "markdown",
  JSON = "json",
}

export const ResponseFormatSchema = z
  .nativeEnum(ResponseFormat)
  .default(ResponseFormat.MARKDOWN)
  .describe(
    "Output format: 'markdown' for human-readable text, 'json' for full structured data",
  );

export type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export function truncate(text: string, note?: string): string {
  if (text.length <= CHARACTER_LIMIT) return text;
  const suffix = `\n\n…[Response truncated at ${CHARACTER_LIMIT} chars${
    note ? `; ${note}` : ""
  }]`;
  return text.slice(0, CHARACTER_LIMIT - suffix.length) + suffix;
}

export function ok(
  text: string,
  structured?: Record<string, unknown>,
): ToolResult {
  return {
    content: [{ type: "text", text: truncate(text) }],
    ...(structured ? { structuredContent: structured } : {}),
  };
}

export function failure(message: string, hint?: string): ToolResult {
  const text = hint ? `Error: ${message}\nHint: ${hint}` : `Error: ${message}`;
  return { content: [{ type: "text", text }], isError: true };
}

export function toUpstreamError(error: unknown): ToolResult {
  if (error instanceof Error) {
    if (error.message.includes("timed out")) {
      return failure(error.message, "Upstream is slow; retry or reduce scope.");
    }
    return failure(error.message);
  }
  return failure(String(error));
}

// JSON mode exposes structuredContent so programmatic callers can consume the
// raw data without re-parsing the text payload. Markdown mode intentionally
// omits structuredContent — some clients (notably Claude Code) render
// structuredContent in place of the text content, which defeats the purpose
// of asking for human-readable output.
// Upstream returns ~13_000_000m when the caller's lat/lng is missing — that's
// the distance from (0,0) to the stop. Treat anything over 5_000_000m (5000km,
// well beyond any plausible bus query) as "unknown".
export function sanitizeDistance(d?: number): number | undefined {
  if (d == null || d < 0 || d > 5_000_000) return undefined;
  return d;
}

// Round a coordinate to 6 decimal places (~11cm precision). Eliminates the
// `31.233206000000006` floating-point tails that come straight from upstream.
export function roundCoord(n: number | undefined): number {
  if (n == null || !Number.isFinite(n)) return 0;
  return Math.round(n * 1_000_000) / 1_000_000;
}

export function pickFormat<T>(
  format: ResponseFormat,
  markdown: () => string,
  data: T,
): ToolResult {
  if (format === ResponseFormat.JSON) {
    return ok(JSON.stringify(data, null, 2), {
      data: data as unknown as Record<string, unknown>,
    });
  }
  return ok(markdown());
}
