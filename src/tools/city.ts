import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  BASE_DOMAIN,
  BASE_URL,
  DEFAULT_PARAMS,
  request,
  requestPlain,
} from "../http-client.js";
import {
  ResponseFormat,
  ResponseFormatSchema,
  pickFormat,
  toUpstreamError,
} from "../format.js";
import type { CityConfigResponse, CityListResponse } from "../types.js";

export const CityListInput = z
  .object({
    hot_only: z
      .boolean()
      .default(true)
      .describe(
        "Default true: return only the upstream-curated 'hot' set (~20 cities). Set false to dump all 480+.",
      ),
    response_format: ResponseFormatSchema,
  })
  .strict();

export const CityConfigInput = z
  .object({
    city_id: z
      .string()
      .min(1)
      .describe("City ID, e.g. '034' for Shanghai, '027' for Beijing"),
    response_format: ResponseFormatSchema,
  })
  .strict();

interface LeanCity {
  cityId: string;
  cityName: string;
  pinyin?: string;
  supportSubway: boolean;
  hot: boolean;
}

interface LeanCityList {
  cities: LeanCity[];
}

export function reshapeCityList(
  raw: CityListResponse,
  hotOnly: boolean,
): LeanCityList {
  const list = raw.cityList ?? [];
  const filtered = hotOnly ? list.filter((c) => c.isHot === 1) : list;
  return {
    cities: filtered.map((c) => ({
      cityId: c.cityId,
      cityName: c.cityName,
      pinyin: c.pinyin,
      supportSubway: c.supportSubway === 1,
      hot: c.isHot === 1,
    })),
  };
}

export function renderCityList(data: LeanCityList): string {
  const hot = data.cities.filter((c) => c.hot);
  const lines: string[] = [`# Supported Cities (${data.cities.length})`, ""];
  if (hot.length) {
    lines.push(
      "## Hot cities",
      ...hot.map((c) => `- ${c.cityName} (${c.cityId})`),
      "",
    );
  }
  lines.push("## All cities");
  for (const c of data.cities) {
    lines.push(
      `- ${c.cityName} (${c.cityId})${c.pinyin ? ` [${c.pinyin}]` : ""}`,
    );
  }
  return lines.join("\n");
}

export function renderCityConfig(cityId: string, c: CityConfigResponse): string {
  return [
    `# City config (${cityId})`,
    `- Refresh interval cap: ${c.maxInterval ?? "?"} s`,
    `- "Arriving" threshold: ${c.arrivingStationLimitSeconds ?? "?"} s`,
    `- Line-detail bus display fields: ${c.busDisplayConfig?.lineDetail ?? "?"}`,
    `- Other-page bus display fields: ${c.busDisplayConfig?.other ?? "?"}`,
  ].join("\n");
}

export function registerCityTools(server: McpServer): void {
  server.registerTool(
    "bus_list_cities",
    {
      title: "List supported cities",
      description: `List cities supported by the realtime bus data service.

Args:
  - hot_only (boolean, default true): return only the upstream's curated 'hot' set (~20 cities). Set false to dump the full ~480-city list (token-heavy, use sparingly).
  - response_format ('markdown' | 'json'): defaults to 'markdown'

Returns (json):
  {
    "cities": [
      { "cityId": "034", "cityName": "上海", "pinyin": "ShangHai", "supportSubway": true, "hot": true },
      ...
    ]
  }

Use when: the user mentions a city name and you don't have its ID. The hot set covers the top-tier cities the user almost certainly means.`,
      inputSchema: CityListInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const raw = await requestPlain<CityListResponse>(
          `${BASE_DOMAIN}/wwd/ncitylist`,
          { ...DEFAULT_PARAMS },
        );
        const lean = reshapeCityList(raw, params.hot_only);
        return pickFormat(
          params.response_format as ResponseFormat,
          () => renderCityList(lean),
          lean as unknown as Record<string, unknown>,
        );
      } catch (e) {
        return toUpstreamError(e);
      }
    },
  );

  server.registerTool(
    "bus_get_city_config",
    {
      title: "Get city operating config",
      description: `Get a city's runtime config: max poll interval and "arriving" time threshold.

This is mostly relevant if you are deciding how aggressively to refresh — not for end-user questions about lines or stops.

Args:
  - city_id (string, required): e.g. '034' (Shanghai), '027' (Beijing)
  - response_format ('markdown' | 'json')

Returns (json):
  {
    "maxInterval": 30,
    "arrivingStationLimitSeconds": 180,
    "busDisplayConfig": { "lineDetail": "time#order#distance", "other": "time#order" }
  }`,
      inputSchema: CityConfigInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const raw = await request<CityConfigResponse>(
          `${BASE_URL}/bus/cityMaxInterval.action`,
          {
            ...DEFAULT_PARAMS,
            cityId: params.city_id,
            localCityId: params.city_id,
          },
        );
        const lean = {
          maxInterval: raw.maxInterval,
          arrivingStationLimitSeconds: raw.arrivingStationLimitSeconds,
          busDisplayConfig: raw.busDisplayConfig,
        };
        return pickFormat(
          params.response_format as ResponseFormat,
          () => renderCityConfig(params.city_id, raw),
          lean as unknown as Record<string, unknown>,
        );
      } catch (e) {
        return toUpstreamError(e);
      }
    },
  );
}
