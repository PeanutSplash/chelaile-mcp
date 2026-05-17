import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BASE_URL, DEFAULT_PARAMS, request } from "../http-client.js";
import {
  ResponseFormat,
  ResponseFormatSchema,
  pickFormat,
  roundCoord,
  sanitizeDistance,
  toUpstreamError,
} from "../format.js";
import type { SearchResponse } from "../types.js";

export const SearchInput = z
  .object({
    city_id: z.string().min(1).describe("City ID, e.g. '034'"),
    keyword: z
      .string()
      .min(1)
      .describe(
        "Search keyword. Examples: '71', '71路', '地铁2号线', '陆家嘴', '人民广场'. Plain line numbers like '71' work fine.",
      ),
    response_format: ResponseFormatSchema,
  })
  .strict();

export const SearchMoreInput = SearchInput.extend({
  type: z
    .enum(["1", "2", "3"])
    .default("1")
    .describe("Category: '1' more lines, '2' more stations, '3' more POIs"),
}).strict();

interface LeanLineDirection {
  direction: number;
  lineId: string;
  startSn: string;
  endSn: string;
}

interface LeanLine {
  name: string;
  lineNo: string;
  isSubway: boolean;
  directions: LeanLineDirection[];
  // Compat fields: most callers historically read `lineId`/`startSn`/`endSn`
  // off the top level. Keep them populated from the direction=0 entry (or the
  // first one) so existing flows don't break.
  lineId: string;
  direction: number;
  startSn: string;
  endSn: string;
  hint?: string;
}

interface LeanStation {
  sId: string;
  sn: string;
  lat: number;
  lng: number;
  gpsType: "wgs" | "gcj";
  physicalStId?: string;
  namesakeStId?: string;
  distance?: number;
  isSubway: boolean;
}

interface LeanPoi {
  name: string;
  address: string;
  tag: string;
  district: string;
  lat: number;
  lng: number;
  gpsType: "gcj";
}

interface LeanSearch {
  highlightKey: string;
  lines: LeanLine[];
  stations: LeanStation[];
  pois: LeanPoi[];
}

export function reshapeSearch(raw: SearchResponse): LeanSearch {
  const r = raw.result ?? {};
  // Upstream emits one row per (lineNo, direction). For the agent that's noise:
  // "71路 (direction 0)" and "71路 (direction 1)" look like two distinct lines.
  // Fold by lineNo and expose both directions as nested entries.
  const groups = new Map<string, LeanLine>();
  const orderedKeys: string[] = [];
  for (const l of r.lines ?? []) {
    const isSubway = l.subwayV2 === 1;
    // Use lineNo when present; some entries (older data) only have a name.
    // Fall back to lineId so we don't accidentally merge unrelated rows.
    const key = l.lineNo || `${l.name ?? ""}::${l.lineId ?? ""}`;
    const dir: LeanLineDirection = {
      direction: l.direction ?? 0,
      lineId: l.lineId ?? "",
      startSn: l.startSn ?? "",
      endSn: l.endSn ?? "",
    };
    let g = groups.get(key);
    if (!g) {
      g = {
        name: l.name ?? "",
        lineNo: l.lineNo ?? "",
        isSubway,
        directions: [],
        // Stub top-level compat fields; filled after both directions arrive.
        lineId: "",
        direction: 0,
        startSn: "",
        endSn: "",
        ...(isSubway
          ? {
              hint:
                "Subway lines are not supported by bus_get_line_detail. To get station list / first / last, use bus_get_stop_detail on a station the metro passes through (its `metros` field), or use bus_plan_transit for routes.",
            }
          : {}),
      };
      groups.set(key, g);
      orderedKeys.push(key);
    }
    g.directions.push(dir);
  }
  // Hydrate top-level compat fields from the canonical direction (prefer 0).
  for (const g of groups.values()) {
    const canonical =
      g.directions.find((d) => d.direction === 0) ?? g.directions[0];
    if (canonical) {
      g.lineId = canonical.lineId;
      g.direction = canonical.direction;
      g.startSn = canonical.startSn;
      g.endSn = canonical.endSn;
    }
  }
  return {
    highlightKey: raw.highlightKey ?? "",
    lines: orderedKeys.map((k) => groups.get(k)!),
    stations: (r.stations ?? []).map((s) => {
      const distance = sanitizeDistance(s.distance);
      return {
        sId: s.sId ?? "",
        sn: s.sn ?? "",
        lat: roundCoord(s.lat),
        lng: roundCoord(s.lng),
        gpsType: (s.gpsType === "gcj" ? "gcj" : "wgs") as "wgs" | "gcj",
        physicalStId: s.physicalStId,
        namesakeStId: s.namesakeStId,
        ...(distance != null ? { distance } : {}),
        isSubway: s.subwayV2 === 1,
      };
    }),
    pois: (r.pois ?? []).map((p) => ({
      name: p.sn1 ?? "",
      address: p.sn1Address ?? "",
      tag: p.sn1Tag ?? "",
      district: p.adname ?? "",
      lat: roundCoord(p.lat),
      lng: roundCoord(p.lng),
      gpsType: "gcj" as const,
    })),
  };
}

export function renderSearch(d: LeanSearch): string {
  const out: string[] = [`# Search results (highlight: ${d.highlightKey || "-"})`];
  if (d.lines.length) {
    out.push("", "## Lines");
    for (const l of d.lines) {
      out.push(`- ${l.name}${l.isSubway ? " [metro]" : ""}`);
      for (const dir of l.directions) {
        out.push(
          `    ↳ direction=${dir.direction} lineId=${dir.lineId} — ${dir.startSn} → ${dir.endSn}`,
        );
      }
      if (l.hint) out.push(`    ⚠ ${l.hint}`);
    }
  }
  if (d.stations.length) {
    out.push("", "## Stations");
    for (const s of d.stations) {
      out.push(
        `- ${s.sn} (sId=${s.sId})${s.isSubway ? " [metro]" : ""} @ ${s.lat},${s.lng} [${s.gpsType}]`,
      );
      // physicalStId + namesakeStId are required by bus_get_stop_detail.
      // Emitting them inline keeps the agent from having to round-trip through
      // bus_get_nearby_stops just to resolve a station ID.
      if (s.physicalStId) {
        out.push(
          `    physicalStId=${s.physicalStId}${s.namesakeStId ? `, namesakeStId=${s.namesakeStId}` : ""} → bus_get_stop_detail`,
        );
      }
    }
  }
  if (d.pois.length) {
    out.push("", "## POIs (GCJ-02 coords)");
    for (const p of d.pois) {
      out.push(
        `- ${p.name} — ${p.address || p.district} @ ${p.lat},${p.lng}${p.tag ? ` [${p.tag}]` : ""}`,
      );
    }
  }
  if (out.length === 1) out.push("", "_No matches._");
  return out.join("\n");
}

export function registerSearchTools(server: McpServer): void {
  server.registerTool(
    "bus_search",
    {
      title: "Search lines, stations, and POIs",
      description: `Search inside a city by keyword. Returns matching lines, stations, and POIs in one call.

Use this as the primary entry point when the user gives a line number, station name, or destination name without IDs.

**Keyword tip**: plain "71", "71路", "地铁2号线", "陆家嘴" all work — the upstream is reasonably forgiving. If a short numeric returns empty, try appending "路".

**Coordinate systems**:
  - 'pois' coords are GCJ-02 (use directly with bus_plan_transit)
  - 'stations' coords are WGS-84 (use with bus_get_nearby_stops / bus_get_line_realtime)
  Both are also marked with a 'gpsType' field.

Args:
  - city_id (string, required): e.g. '034'
  - keyword (string, required)
  - response_format ('markdown' | 'json')

Returns (json):
  {
    "highlightKey": "71路",
    "lines": [
      {
        "name": "71", "lineNo": "r95817", "isSubway": false,
        "directions": [
          { "direction": 0, "lineId": "21283603183", "startSn": "延安东路外滩", "endSn": "申昆路枢纽站" },
          { "direction": 1, "lineId": "21283603182", "startSn": "申昆路枢纽站", "endSn": "延安东路外滩" }
        ],
        // Compat top-level fields mirror directions[0] (or first available).
        "lineId": "21283603183", "direction": 0, "startSn": "延安东路外滩", "endSn": "申昆路枢纽站"
      },
      ...
    ],
    "stations": [{ "sId":"...", "sn":"西藏中路", "lat":31.231006, "lng":121.474316, "gpsType":"wgs", "physicalStId":"...", "namesakeStId":"...", "isSubway":false }, ...],
    "pois": [{ "name":"71路", "address":"...", "tag":"公交线路", "district":"黄浦区", "lat":31.233021, "lng":121.49073, "gpsType":"gcj" }, ...]
  }

**Line folding**: each entry in 'lines' is one logical line (e.g. "71路"). The two travel directions live in 'directions[]'. Pick the lineId matching your desired direction.

**Subway hint**: when 'isSubway' is true, the entry carries a 'hint' field — bus_get_line_detail will return empty for these lineIds. Use bus_get_stop_detail (metros field) or bus_plan_transit instead.

**Follow-ups**:
- directions[i].lineId → bus_get_line_detail (full stop list, first/last/price) — non-subway only
- stations[*].physicalStId + namesakeStId → bus_get_stop_detail
  (NOTE: a few stations lack physicalStId — typically metro-only entries with subwayV2=1. For those, use bus_get_nearby_stops to resolve the bus platform IDs nearby.)
- pois[*].lat/lng (GCJ) → bus_plan_transit as origin/destination`,
      inputSchema: SearchInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const raw = await request<SearchResponse>(
          `${BASE_URL}/bus/query!nSearch.action`,
          {
            ...DEFAULT_PARAMS,
            cityId: params.city_id,
            localCityId: params.city_id,
            key: params.keyword,
            supportPhyStn: "true",
          },
        );
        const lean = reshapeSearch(raw);
        return pickFormat(
          params.response_format as ResponseFormat,
          () => renderSearch(lean),
          lean as unknown as Record<string, unknown>,
        );
      } catch (e) {
        return toUpstreamError(e);
      }
    },
  );

  server.registerTool(
    "bus_search_more",
    {
      title: "Search more results of one category",
      description: `Paginated 'see more' for one category from bus_search.

Args:
  - city_id (string, required)
  - keyword (string, required): same keyword used in bus_search
  - type ('1'|'2'|'3'): 1=more lines, 2=more stations, 3=more POIs (default '1')
  - response_format ('markdown' | 'json')

Returns: same shape as bus_search but only the requested category is populated.`,
      inputSchema: SearchMoreInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const raw = await request<SearchResponse>(
          `${BASE_URL}/bus/query!searchMore.action`,
          {
            ...DEFAULT_PARAMS,
            cityId: params.city_id,
            localCityId: params.city_id,
            key: params.keyword,
            type: params.type,
            supportPhyStn: "true",
          },
        );
        const lean = reshapeSearch(raw);
        return pickFormat(
          params.response_format as ResponseFormat,
          () => renderSearch(lean),
          lean as unknown as Record<string, unknown>,
        );
      } catch (e) {
        return toUpstreamError(e);
      }
    },
  );
}
