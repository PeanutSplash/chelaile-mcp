import { createHash, createDecipheriv } from "node:crypto";
import * as https from "node:https";
import * as http from "node:http";
import * as zlib from "node:zlib";
import {
  AES_KEY,
  BASE_DOMAIN,
  BASE_URL,
  DEFAULT_PARAMS,
  REQUEST_HEADERS,
  REQUEST_TIMEOUT_MS,
  SIGN_SALT,
} from "./constants.js";

export { BASE_DOMAIN, BASE_URL, DEFAULT_PARAMS };

export function cryptoSign(params: Record<string, string>): string {
  const str =
    Object.entries(params)
      .map(([k, v]) => `"${k}"="${v}"`)
      .join("&") + SIGN_SALT;
  return createHash("md5").update(str).digest("hex");
}

export function decryptResult(ciphertext: string): string {
  const key = Buffer.from(AES_KEY, "utf8");
  const decipher = createDecipheriv("aes-256-ecb", key, null);
  let decrypted = decipher.update(ciphertext, "base64", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export function parseEncryptedEnvelope(raw: string): unknown {
  const jsonStart = raw.indexOf("{");
  if (jsonStart < 0) throw new Error("Upstream response is not JSON");

  let depth = 0;
  let jsonEnd = jsonStart;
  for (let i = jsonStart; i < raw.length; i++) {
    if (raw[i] === "{") depth++;
    else if (raw[i] === "}") depth--;
    if (depth === 0) {
      jsonEnd = i + 1;
      break;
    }
  }

  const envelope = JSON.parse(raw.substring(jsonStart, jsonEnd)) as {
    jsonr?: { data?: { encryptResult?: string } & Record<string, unknown> };
  };
  const data = envelope.jsonr?.data;
  if (!data) throw new Error("Upstream response missing jsonr.data");

  if (data.encryptResult) {
    return JSON.parse(decryptResult(data.encryptResult));
  }
  return data;
}

export function decompress(buffer: Buffer, encoding: string | undefined): Buffer {
  if (encoding === "br") return zlib.brotliDecompressSync(buffer);
  if (encoding === "gzip") return zlib.gunzipSync(buffer);
  if (encoding === "deflate") return zlib.inflateSync(buffer);
  return buffer;
}

function rawGet(url: URL): Promise<{ body: string }> {
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + (url.search || ""),
        method: "GET",
        headers: REQUEST_HEADERS,
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try {
            const decompressed = decompress(
              Buffer.concat(chunks),
              res.headers["content-encoding"] as string | undefined,
            );
            resolve({ body: decompressed.toString("utf-8") });
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`));
    });
    req.on("error", reject);
    req.end();
  });
}

export async function request<T = unknown>(
  url: string,
  params: Record<string, string>,
): Promise<T> {
  const signed = { ...params, cryptoSign: cryptoSign(params) };
  const u = new URL(url);
  u.search = new URLSearchParams(signed).toString();
  const { body } = await rawGet(u);
  return parseEncryptedEnvelope(body) as T;
}

export async function requestPlain<T = unknown>(
  url: string,
  params: Record<string, string>,
): Promise<T> {
  const u = new URL(url);
  u.search = new URLSearchParams(params).toString();
  const { body } = await rawGet(u);
  const json = JSON.parse(body) as { data?: T };
  if (!json.data) throw new Error("Upstream plain response missing data");
  return json.data;
}

// For endpoints that return plain JSON with no encryption envelope (e.g. the
// geocoder, which proxies an upstream map service). Signs the params and
// parses the entire response body as JSON.
export async function requestRaw<T = unknown>(
  url: string,
  params: Record<string, string>,
): Promise<T> {
  const signed = { ...params, cryptoSign: cryptoSign(params) };
  const u = new URL(url);
  u.search = new URLSearchParams(signed).toString();
  const { body } = await rawGet(u);
  return JSON.parse(body) as T;
}
