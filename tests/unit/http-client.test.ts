import { describe, expect, test } from "bun:test";
import { createCipheriv } from "node:crypto";
import * as zlib from "node:zlib";
import { AES_KEY, SIGN_SALT } from "../../src/constants.js";
import {
  cryptoSign,
  decompress,
  decryptResult,
  parseEncryptedEnvelope,
} from "../../src/http-client.js";
import { createHash } from "node:crypto";

describe("cryptoSign", () => {
  test("produces a deterministic 32-char hex md5 against a fixed input", () => {
    const sig = cryptoSign({ a: "1", b: "2" });
    expect(sig).toMatch(/^[0-9a-f]{32}$/);
    const expected = createHash("md5")
      .update(`"a"="1"&"b"="2"${SIGN_SALT}`)
      .digest("hex");
    expect(sig).toBe(expected);
  });

  test("preserves insertion order in the signed string", () => {
    const sig1 = cryptoSign({ a: "1", b: "2" });
    const sig2 = cryptoSign({ b: "2", a: "1" });
    expect(sig1).not.toBe(sig2);
  });

  test("handles empty object (just the salt)", () => {
    const sig = cryptoSign({});
    expect(sig).toBe(createHash("md5").update(SIGN_SALT).digest("hex"));
  });
});

function encryptForFixture(plain: string): string {
  const key = Buffer.from(AES_KEY, "utf8");
  const cipher = createCipheriv("aes-256-ecb", key, null);
  return Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]).toString(
    "base64",
  );
}

describe("decryptResult", () => {
  test("round-trips encrypt → decrypt for a known payload", () => {
    const plain = JSON.stringify({ ok: true, value: 42, nested: { x: "y" } });
    const ciphertext = encryptForFixture(plain);
    expect(decryptResult(ciphertext)).toBe(plain);
  });

  test("throws on malformed base64 / bad padding", () => {
    expect(() => decryptResult("not-base64!!!!")).toThrow();
  });
});

describe("parseEncryptedEnvelope", () => {
  test("returns jsonr.data verbatim when there is no encryptResult field", () => {
    const raw = JSON.stringify({
      jsonr: { data: { cityList: [{ cityId: "034", cityName: "上海" }] } },
    });
    const out = parseEncryptedEnvelope(raw) as { cityList: unknown[] };
    expect(out.cityList).toEqual([{ cityId: "034", cityName: "上海" }]);
  });

  test("decrypts encryptResult when present", () => {
    const payload = { hello: "world", arr: [1, 2, 3] };
    const raw = JSON.stringify({
      jsonr: { data: { encryptResult: encryptForFixture(JSON.stringify(payload)) } },
    });
    expect(parseEncryptedEnvelope(raw)).toEqual(payload);
  });

  test("ignores leading and trailing non-brace junk around the JSON envelope", () => {
    const raw =
      "abc def 123\n" +
      JSON.stringify({ jsonr: { data: { ok: 1 } } }) +
      "\ntrailing garbage";
    expect(parseEncryptedEnvelope(raw)).toEqual({ ok: 1 });
  });

  test("throws when there is no JSON at all", () => {
    expect(() => parseEncryptedEnvelope("[]")).toThrow();
  });

  test("throws when jsonr.data is missing", () => {
    expect(() => parseEncryptedEnvelope('{"jsonr":{}}')).toThrow(
      /missing jsonr\.data/,
    );
  });
});

describe("decompress", () => {
  const sample = Buffer.from("hello world", "utf8");

  test("passes raw buffer through when no encoding is set", () => {
    expect(decompress(sample, undefined).toString()).toBe("hello world");
    expect(decompress(sample, "identity").toString()).toBe("hello world");
  });

  test("decodes gzip", () => {
    const gz = zlib.gzipSync(sample);
    expect(decompress(gz, "gzip").toString()).toBe("hello world");
  });

  test("decodes deflate", () => {
    const def = zlib.deflateSync(sample);
    expect(decompress(def, "deflate").toString()).toBe("hello world");
  });

  test("decodes brotli", () => {
    const br = zlib.brotliCompressSync(sample);
    expect(decompress(br, "br").toString()).toBe("hello world");
  });
});
