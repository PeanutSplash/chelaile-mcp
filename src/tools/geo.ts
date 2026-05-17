import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as http from "node:http";
import { BASE_URL, DEFAULT_PARAMS, requestRaw } from "../http-client.js";
import {
  ResponseFormat,
  ResponseFormatSchema,
  pickFormat,
  toUpstreamError,
} from "../format.js";
import { REQUEST_TIMEOUT_MS } from "../constants.js";
import type { ReverseGeoResponse } from "../types.js";

export const ReverseGeoInput = z
  .object({
    lat: z
      .string()
      .regex(/^-?\d+(\.\d+)?$/, "lat must be a decimal number")
      .describe("Latitude, WGS-84, e.g. '31.230416'"),
    lng: z
      .string()
      .regex(/^-?\d+(\.\d+)?$/, "lng must be a decimal number")
      .describe("Longitude, WGS-84, e.g. '121.473701'"),
    response_format: ResponseFormatSchema,
  })
  .strict();

export const MyLocationInput = z
  .object({
    ip: z
      .string()
      .optional()
      .describe(
        "Optional override IP to look up. Omit to use the mcp server's own outbound IP (i.e. the caller's machine).",
      ),
    response_format: ResponseFormatSchema,
  })
  .strict();

interface LeanIpLocation {
  lat: number;
  lng: number;
  gpsType: "wgs";
  city: string;
  region: string;
  country: string;
  ip: string;
  isp?: string;
  precision: string;
  // Non-empty whenever the result is not usable for chelaile (VPN/non-CN exit).
  warning?: string;
  inChina: boolean;
}

interface IpApiResponse {
  status?: string;
  message?: string;
  country?: string;
  regionName?: string;
  city?: string;
  lat?: number;
  lon?: number;
  query?: string;
  isp?: string;
}

function fetchIpApi(ip?: string): Promise<IpApiResponse> {
  const path = ip
    ? `/json/${encodeURIComponent(ip)}?lang=zh-CN`
    : "/json/?lang=zh-CN";
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "ip-api.com",
        path,
        method: "GET",
        timeout: REQUEST_TIMEOUT_MS,
        headers: { Accept: "application/json" },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
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

export function renderMyLocation(d: LeanIpLocation): string {
  const lines = [
    "# IP-based location (coarse)",
    `- Coords (WGS-84): ${d.lat}, ${d.lng}`,
    `- ${d.country} / ${d.region} / ${d.city}`,
    `- Source IP: ${d.ip}${d.isp ? ` (${d.isp})` : ""}`,
    `- Precision: ${d.precision}`,
  ];
  if (d.warning) lines.push("", `⚠️  ${d.warning}`);
  return lines.join("\n");
}

interface LeanAddress {
  formatted: string;
  province: string;
  city: string;
  district: string;
  township: string;
  citycode: string;
  adcode: string;
}

export function reshapeReverseGeo(raw: ReverseGeoResponse): LeanAddress {
  const a = raw.regeocode?.addressComponent ?? {};
  // Municipalities (Shanghai/Beijing/Tianjin/Chongqing) come back with an
  // empty array for `city` — fall through to `province` so the field stays a
  // meaningful string.
  const city = Array.isArray(a.city) ? (a.province ?? "") : (a.city ?? "");
  return {
    formatted: raw.regeocode?.formatted_address ?? "",
    province: a.province ?? "",
    city,
    district: a.district ?? "",
    township: a.township ?? "",
    citycode: a.citycode ?? "",
    adcode: a.adcode ?? "",
  };
}

export function renderReverseGeo(d: LeanAddress): string {
  return [
    "# Reverse geocode",
    `- Formatted: ${d.formatted}`,
    `- Province: ${d.province}`,
    `- City: ${d.city}`,
    `- District: ${d.district}`,
    `- Township: ${d.township}`,
    `- Citycode: ${d.citycode}`,
    `- Adcode: ${d.adcode}`,
  ].join("\n");
}

export function registerGeoTools(server: McpServer): void {
  server.registerTool(
    "bus_reverse_geocode",
    {
      title: "Reverse geocode GPS to address",
      description: `Convert WGS-84 lat/lng to a Chinese postal address (province, city, district, township, formatted address).

Useful when you have raw GPS coordinates and need a human-readable place name, or the citycode/adcode to pass to other tools.

Args:
  - lat (string, required): WGS-84 latitude, decimal, e.g. '31.230416'
  - lng (string, required): WGS-84 longitude, decimal, e.g. '121.473701'
  - response_format ('markdown' | 'json')

Returns (json):
  {
    "formatted": "上海市黄浦区...",
    "province": "上海市",
    "city": "上海市",
    "district": "黄浦区",
    "township": "南京东路街道",
    "citycode": "021",
    "adcode": "310101"
  }

For municipalities (Shanghai/Beijing/Tianjin/Chongqing) the upstream emits an empty 'city' value; this tool back-fills it with 'province' so the field is always a usable string.`,
      inputSchema: ReverseGeoInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const raw = await requestRaw<ReverseGeoResponse>(
          `${BASE_URL}/transfer/transit!getLocationByGps.action`,
          {
            ...DEFAULT_PARAMS,
            lat: params.lat,
            lng: params.lng,
            geo_lat: params.lat,
            geo_lng: params.lng,
            gpsType: "wgs",
            gpstype: "wgs",
            geo_type: "wgs",
          },
        );
        const lean = reshapeReverseGeo(raw);
        return pickFormat(
          params.response_format as ResponseFormat,
          () => renderReverseGeo(lean),
          lean as unknown as Record<string, unknown>,
        );
      } catch (e) {
        return toUpstreamError(e);
      }
    },
  );

  server.registerTool(
    "bus_get_my_location",
    {
      title: "Get the caller's approximate location via IP",
      description: `Resolve the caller's approximate location from their public IP — useful when the user asks something like "what's near me" without providing coordinates.

**Precision is city-level (typically a few kilometres).** Good enough to identify the city and seed bus_get_nearby_stops with a starting guess. NOT precise enough to find the user's actual bus stop — for that, ask for a landmark/address and resolve it via bus_search.

Caveats:
  - Resolves via ip-api.com (free tier; rate-limited but no auth).
  - VPN / corporate proxy → result reflects the proxy exit IP, not the user.
  - Cellular IPs often land on a provincial centroid.

Args:
  - ip (string, optional): a specific IPv4/IPv6 to look up. Omit to use the mcp server process's own outbound IP (= the caller's machine when running locally).
  - response_format ('markdown' | 'json')

Returns (json):
  {
    "lat": 31.2222,
    "lng": 121.4581,
    "gpsType": "wgs",
    "city": "上海",
    "region": "上海市",
    "country": "中国",
    "ip": "116.236.0.1",
    "isp": "China Telecom",
    "precision": "city-level (~10 km); not suitable for stop-level queries"
  }

**Suggested workflow**:
  1. Call this tool to identify the user's city (match 'city' field against bus_list_cities to get a cityId).
  2. Pass lat/lng into bus_get_nearby_stops for a rough nearby list, OR ask the user to confirm a landmark and use bus_search.pois for sharper coordinates.`,
      inputSchema: MyLocationInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const data = await fetchIpApi(params.ip);
        if (data.status !== "success") {
          return toUpstreamError(
            new Error(
              `ip-api lookup failed: ${data.message ?? "unknown reason"}`,
            ),
          );
        }
        // chelaile only covers Chinese mainland cities. ip-api returns the
        // country as a localised name ("中国" with lang=zh-CN), so a fast
        // check against the few known shapes covers the common cases.
        const country = data.country ?? "";
        const inChina = /中国|China/i.test(country);
        const warning = inChina
          ? undefined
          : `IP geolocated outside mainland China (${country || "unknown"}). This is almost always a VPN/proxy exit — chelaile data won't match. Ask the user for their city or a landmark and resolve via bus_search instead.`;
        const lean: LeanIpLocation = {
          lat: data.lat ?? 0,
          lng: data.lon ?? 0,
          gpsType: "wgs",
          city: data.city ?? "",
          region: data.regionName ?? "",
          country,
          ip: data.query ?? "",
          isp: data.isp,
          precision: "city-level (~10 km); not suitable for stop-level queries",
          inChina,
          ...(warning ? { warning } : {}),
        };
        return pickFormat(
          params.response_format as ResponseFormat,
          () => renderMyLocation(lean),
          lean as unknown as Record<string, unknown>,
        );
      } catch (e) {
        return toUpstreamError(e);
      }
    },
  );
}
