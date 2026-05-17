import { describe, expect, test } from "bun:test";
import { CHARACTER_LIMIT } from "../../src/constants.js";
import {
  ResponseFormat,
  ResponseFormatSchema,
  failure,
  ok,
  pickFormat,
  roundCoord,
  sanitizeDistance,
  toUpstreamError,
  truncate,
} from "../../src/format.js";

describe("truncate", () => {
  test("returns text untouched when under the limit", () => {
    const text = "hello world";
    expect(truncate(text)).toBe(text);
  });

  test("trims and appends a marker when over the limit", () => {
    const long = "a".repeat(CHARACTER_LIMIT + 1000);
    const out = truncate(long);
    expect(out.length).toBe(CHARACTER_LIMIT);
    expect(out.endsWith("chars]")).toBe(true);
    expect(out).toContain(`Response truncated at ${CHARACTER_LIMIT} chars`);
  });

  test("includes the optional note in the suffix", () => {
    const long = "x".repeat(CHARACTER_LIMIT + 50);
    const out = truncate(long, "drop tail");
    expect(out).toContain("drop tail");
    expect(out.length).toBe(CHARACTER_LIMIT);
  });
});

describe("ok / failure", () => {
  test("ok wraps text into the MCP content shape", () => {
    const result = ok("hi");
    expect(result.content).toEqual([{ type: "text", text: "hi" }]);
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toBeUndefined();
  });

  test("ok attaches structuredContent when provided", () => {
    const result = ok("hi", { foo: "bar" });
    expect(result.structuredContent).toEqual({ foo: "bar" });
  });

  test("ok truncates oversized text", () => {
    const long = "y".repeat(CHARACTER_LIMIT + 5);
    const result = ok(long);
    expect(result.content[0].text.length).toBe(CHARACTER_LIMIT);
  });

  test("failure marks the result as an error", () => {
    const result = failure("nope");
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Error: nope");
  });

  test("failure appends a hint when provided", () => {
    const result = failure("nope", "retry later");
    expect(result.content[0].text).toBe("Error: nope\nHint: retry later");
  });
});

describe("toUpstreamError", () => {
  test("plain Error is wrapped with no hint", () => {
    const result = toUpstreamError(new Error("boom"));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Error: boom");
  });

  test("timeout errors get a retry hint", () => {
    const result = toUpstreamError(new Error("Request timed out after 15000ms"));
    expect(result.content[0].text).toContain("Upstream is slow");
  });

  test("non-Error values are stringified", () => {
    const result = toUpstreamError("weird");
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Error: weird");
  });
});

describe("pickFormat", () => {
  test("returns markdown without structuredContent (markdown is the human path)", () => {
    const result = pickFormat(
      ResponseFormat.MARKDOWN,
      () => "# heading",
      { foo: 1 },
    );
    expect(result.content[0].text).toBe("# heading");
    expect(result.structuredContent).toBeUndefined();
  });

  test("returns pretty JSON when format=json and does NOT call the markdown renderer", () => {
    let markdownCalls = 0;
    const result = pickFormat(
      ResponseFormat.JSON,
      () => {
        markdownCalls++;
        return "should-not-run";
      },
      { foo: 1 },
    );
    expect(markdownCalls).toBe(0);
    expect(JSON.parse(result.content[0].text)).toEqual({ foo: 1 });
    expect(result.structuredContent).toEqual({ data: { foo: 1 } });
  });
});

describe("sanitizeDistance", () => {
  test("returns undefined for missing or negative values", () => {
    expect(sanitizeDistance(undefined)).toBeUndefined();
    expect(sanitizeDistance(-1)).toBeUndefined();
  });

  test("returns undefined for the bogus 13_000_000m upstream sends with no coords", () => {
    expect(sanitizeDistance(13_127_595)).toBeUndefined();
  });

  test("passes through realistic walking/driving distances", () => {
    expect(sanitizeDistance(0)).toBe(0);
    expect(sanitizeDistance(87)).toBe(87);
    expect(sanitizeDistance(4_999_999)).toBe(4_999_999);
  });
});

describe("roundCoord", () => {
  test("trims floating-point tails to 6 decimal places", () => {
    expect(roundCoord(31.233206000000006)).toBe(31.233206);
    expect(roundCoord(121.474316)).toBe(121.474316);
  });

  test("coerces undefined / NaN / Infinity to 0", () => {
    expect(roundCoord(undefined)).toBe(0);
    expect(roundCoord(NaN)).toBe(0);
    expect(roundCoord(Infinity)).toBe(0);
  });
});

describe("ResponseFormatSchema", () => {
  test("defaults to markdown", () => {
    expect(ResponseFormatSchema.parse(undefined) as ResponseFormat).toBe(
      ResponseFormat.MARKDOWN,
    );
  });

  test("accepts both enum values", () => {
    expect(ResponseFormatSchema.parse("json") as ResponseFormat).toBe(
      ResponseFormat.JSON,
    );
    expect(ResponseFormatSchema.parse("markdown") as ResponseFormat).toBe(
      ResponseFormat.MARKDOWN,
    );
  });

  test("rejects garbage", () => {
    expect(() => ResponseFormatSchema.parse("xml")).toThrow();
  });
});
