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

export const NearbyInput = z
  .object({
    city_id: z.string().min(1).describe("City ID, e.g. '034'"),
    lat: z
      .string()
      .regex(/^-?\d+(\.\d+)?$/)
      .describe("WGS-84 latitude"),
    lng: z
      .string()
      .regex(/^-?\d+(\.\d+)?$/)
      .describe("WGS-84 longitude"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(5)
      .describe(
        "How many of the nearest stops to return. Default 5 — the upstream may return 15+ and most callers only care about the closest few.",
      ),
    response_format: ResponseFormatSchema,
  })
  .strict();

export const StopDetailInput = z
  .object({
    city_id: z.string().min(1),
    physical_st_id: z
      .string()
      .min(1)
      .describe(
        "physicalStId of the stop (from bus_get_nearby_stops or bus_search)",
      ),
    namesake_st_id: z
      .string()
      .optional()
      .describe("namesakeStId of the stop, optional"),
    first_line_id: z
      .string()
      .optional()
      .describe("Optional hint of a line you want highlighted"),
    lat: z
      .string()
      .regex(/^-?\d+(\.\d+)?$/)
      .optional()
      .describe("Caller's WGS-84 latitude — used to populate 'distance'"),
    lng: z
      .string()
      .regex(/^-?\d+(\.\d+)?$/)
      .optional()
      .describe("Caller's WGS-84 longitude"),
    response_format: ResponseFormatSchema,
  })
  .strict();

// ---------- types & reshape ----------

interface RawBus {
  busId?: string;
  order?: number;
  arrivalTime?: number;
  travelTime?: number;
  distanceToDest?: number;
  capacity?: number;
}

interface RawLineField {
  lineId?: string;
  name?: string;
  lineNo?: string;
  direction?: number;
  startSn?: string;
  endSn?: string;
  firstTime?: string;
  lastTime?: string;
  price?: string;
  stationsNum?: number;
  shortDesc?: string;
  nextOperationTimeDesc?: string;
  state?: number;
}

interface RawLineItem {
  line?: RawLineField;
  preArrivalTime?: string;
  targetStation?: { sId?: string; sn?: string; order?: number };
  stnStates?: RawBus[];
}

interface RawSubwaySubline {
  destName?: string;
  firstTime?: string;
  lastTime?: string;
}

interface RawSubwayLine {
  line?: { lineName?: string; shortName?: string; bgColor?: string };
  sublines?: RawSubwaySubline[];
}

interface RawNearStop {
  sId?: string;
  sn?: string;
  distance?: number;
  isSubway?: number;
  physicalStId?: string;
  namesakeStId?: string;
  firstLineId?: string;
  lines?: RawLineItem[];
  subwayV2Lines?: RawSubwayLine[];
}

interface RawNearbyResponse {
  nearSts?: RawNearStop[];
}

interface RawMetro {
  lineId?: string;
  fullName?: string;
  lineNo?: string;
  color?: string;
}

interface RawStation {
  sId?: string;
  sn?: string;
  lat?: number;
  lng?: number;
  distance?: number;
  lines?: RawLineItem[];
  metros?: RawMetro[];
}

interface RawStopDetailResponse {
  stationList?: RawStation[];
}

interface LeanBus {
  busId: string;
  order: number;
  arrivalTime: number;
  travelTime: number;
  distanceToDest?: number;
  capacity: number;
}

interface LeanNearbyLine {
  lineId: string;
  name: string;
  direction: number;
  endSn: string;
  status: string;
  preArrivalTime?: string;
  firstTime?: string;
  lastTime?: string;
  targetOrder?: number;
  targetStationId?: string;
  buses: LeanBus[];
}

interface LeanSubwayLine {
  name: string;
  shortName: string;
  color?: string;
  directions: Array<{ destName: string; firstTime: string; lastTime: string }>;
}

interface LeanNearStop {
  sId: string;
  sn: string;
  distance?: number;
  isSubway: boolean;
  physicalStId?: string;
  namesakeStId?: string;
  firstLineId?: string;
  lines: LeanNearbyLine[];
  subwayLines: LeanSubwayLine[];
}

interface LeanNearby {
  stops: LeanNearStop[];
}

interface LeanStopLine {
  lineId: string;
  name: string;
  direction: number;
  startSn: string;
  endSn: string;
  firstTime?: string;
  lastTime?: string;
  price?: string;
  targetOrder?: number;
  targetStationId?: string;
  buses: LeanBus[];
}

interface LeanMetro {
  name: string;
  lineNo: string;
  color?: string;
}

interface LeanStation {
  sId: string;
  sn: string;
  lat: number;
  lng: number;
  distance?: number;
  lines: LeanStopLine[];
  metros: LeanMetro[];
}

interface LeanStopDetail {
  stations: LeanStation[];
}

function lineStatus(line: RawLineField | undefined): string {
  if (!line) return "";
  return (
    line.shortDesc?.trim() ||
    line.nextOperationTimeDesc?.trim() ||
    ""
  );
}

export function reshapeBus(b: RawBus): LeanBus {
  return {
    busId: b.busId ?? "",
    order: b.order ?? 0,
    arrivalTime: b.arrivalTime ?? -1,
    travelTime: b.travelTime ?? -1,
    ...(b.distanceToDest != null ? { distanceToDest: b.distanceToDest } : {}),
    capacity: b.capacity ?? 0,
  };
}

export function reshapeNearby(raw: RawNearbyResponse, limit: number): LeanNearby {
  return {
    stops: (raw.nearSts ?? []).slice(0, limit).map((s) => {
      const distance = sanitizeDistance(s.distance);
      return {
      sId: s.sId ?? "",
      sn: s.sn ?? "",
      ...(distance != null ? { distance } : {}),
      isSubway: s.isSubway === 1,
      physicalStId: s.physicalStId,
      namesakeStId: s.namesakeStId,
      firstLineId: s.firstLineId,
      lines: (s.lines ?? []).map<LeanNearbyLine>((li) => ({
        lineId: li.line?.lineId ?? "",
        name: li.line?.name ?? "",
        direction: li.line?.direction ?? 0,
        endSn: li.line?.endSn ?? "",
        status: lineStatus(li.line),
        preArrivalTime: li.preArrivalTime || undefined,
        firstTime: li.line?.firstTime || undefined,
        lastTime: li.line?.lastTime || undefined,
        targetOrder: li.targetStation?.order,
        targetStationId: li.targetStation?.sId,
        buses: (li.stnStates ?? []).map(reshapeBus),
      })),
      subwayLines: (s.subwayV2Lines ?? []).map<LeanSubwayLine>((m) => ({
        name: m.line?.lineName ?? "",
        shortName: m.line?.shortName ?? "",
        color: m.line?.bgColor,
        directions: (m.sublines ?? []).map((sub) => ({
          destName: sub.destName ?? "",
          firstTime: sub.firstTime ?? "",
          lastTime: sub.lastTime ?? "",
        })),
      })),
      };
    }),
  };
}

export function reshapeStopDetail(raw: RawStopDetailResponse): LeanStopDetail {
  const stations = (raw.stationList ?? []).map<LeanStation>((st) => {
    const distance = sanitizeDistance(st.distance);
    const lines = (st.lines ?? [])
      .map<LeanStopLine>((li) => ({
        lineId: li.line?.lineId ?? "",
        name: li.line?.name ?? "",
        direction: li.line?.direction ?? 0,
        startSn: li.line?.startSn ?? "",
        endSn: li.line?.endSn ?? "",
        firstTime: li.line?.firstTime || undefined,
        lastTime: li.line?.lastTime || undefined,
        price: li.line?.price || undefined,
        targetOrder: li.targetStation?.order,
        targetStationId: li.targetStation?.sId,
        buses: (li.stnStates ?? []).map(reshapeBus),
      }))
      // Drop sparse line entries that have neither endpoints nor a lineId —
      // upstream sometimes echoes a same-name physical station with stub
      // lines and they confuse the markdown render with "92 →  | ?–?".
      .filter((l) => l.lineId || l.startSn || l.endSn);
    return {
      sId: st.sId ?? "",
      sn: st.sn ?? "",
      lat: roundCoord(st.lat),
      lng: roundCoord(st.lng),
      ...(distance != null ? { distance } : {}),
      lines,
      metros: (st.metros ?? []).map((m) => ({
        name: m.fullName ?? "",
        lineNo: m.lineNo ?? "",
        color: m.color,
      })),
    };
  });
  // After filtering stub lines, drop stations that ended up with no useful
  // payload at all (no lines and no metros). This kills the duplicate empty
  // "## Lines through this stop / - 92 →  | ?–?" tail-blocks that used to
  // appear on multi-platform stops.
  const usable = stations.filter((s) => s.lines.length || s.metros.length);
  // Upstream sometimes echoes the same physical station twice (same sId,
  // same coords), the second copy being a strict subset of the first —
  // e.g. lines:[] with the same metros. Dedupe by sId, keeping the richer
  // record (most lines, then most metros). Stations without an sId fall
  // through unchanged so we don't accidentally collapse unrelated rows.
  const byId = new Map<string, LeanStation>();
  const result: LeanStation[] = [];
  for (const s of usable) {
    if (!s.sId) { result.push(s); continue; }
    const prev = byId.get(s.sId);
    if (!prev) { byId.set(s.sId, s); result.push(s); continue; }
    if (
      s.lines.length > prev.lines.length ||
      (s.lines.length === prev.lines.length && s.metros.length > prev.metros.length)
    ) {
      const i = result.indexOf(prev);
      result[i] = s;
      byId.set(s.sId, s);
    }
  }
  return { stations: result };
}

// ---------- markdown renderers ----------

export function fmtEta(b: LeanBus): string {
  if (!b.travelTime || b.travelTime <= 0) return "—";
  if (b.travelTime < 60) return `${b.travelTime}s`;
  return `${Math.round(b.travelTime / 60)}min`;
}

export function renderNearby(d: LeanNearby): string {
  if (!d.stops.length) return "_No nearby stops._";
  const out: string[] = [`# Nearby stops (${d.stops.length})`];
  for (const s of d.stops) {
    const dist = s.distance != null ? ` — ${s.distance}m` : "";
    out.push("", `## ${s.sn} (${s.sId})${dist}${s.isSubway ? " [metro]" : ""}`);
    if (s.physicalStId) out.push(`- physicalStId: ${s.physicalStId}`);
    if (s.namesakeStId) out.push(`- namesakeStId: ${s.namesakeStId}`);
    for (const li of s.lines) {
      const etas = li.buses.length
        ? li.buses.map(fmtEta).join(", ")
        : li.preArrivalTime
          ? `dep ${li.preArrivalTime}`
          : "—";
      out.push(
        `- ${li.name} → ${li.endSn} (lineId=${li.lineId}, targetOrder=${li.targetOrder ?? "?"}) ${li.status ? `[${li.status}] ` : ""}ETA: ${etas}`,
      );
    }
    for (const m of s.subwayLines) {
      const dirs = m.directions
        .map((d) => `→${d.destName} (${d.firstTime}–${d.lastTime})`)
        .join("; ");
      out.push(`- 🚇 ${m.name}: ${dirs}`);
    }
  }
  return out.join("\n");
}

export function renderStopDetail(d: LeanStopDetail): string {
  if (!d.stations.length) return "_No stop matched._";
  const out: string[] = [];
  for (const st of d.stations) {
    out.push(`# ${st.sn} (${st.sId})`, `- coords (WGS): ${st.lat}, ${st.lng}`);
    if (st.distance != null) out.push(`- distance: ${st.distance}m`);
    if (st.lines.length) {
      out.push("", "## Lines through this stop");
      for (const li of st.lines) {
        out.push(
          `- ${li.name} ${li.startSn} → ${li.endSn} | ${li.firstTime ?? "?"}–${li.lastTime ?? "?"} | ${li.price ?? ""}`,
        );
        for (const b of li.buses) {
          out.push(
            `  - bus ${b.busId} order=${b.order} ETA=${fmtEta(b)} distToStop=${b.distanceToDest ?? "?"}m`,
          );
        }
      }
    }
    if (st.metros.length) {
      out.push(
        "",
        "## Nearby metro",
        ...st.metros.map((m) => `- ${m.name}`),
      );
    }
    out.push("");
  }
  return out.join("\n");
}

// ---------- tools ----------

export function registerStopTools(server: McpServer): void {
  server.registerTool(
    "bus_get_nearby_stops",
    {
      title: "Get nearby bus stops",
      description: `List bus stops near a WGS-84 GPS coordinate, each annotated with the lines that pass through and the realtime buses approaching.

**If you don't have coordinates**: call bus_get_my_location first (city-level precision via IP), or ask the user for a landmark and resolve it via bus_search.pois — the resulting lat/lng goes into this tool's lat/lng args.

Args:
  - city_id (string, required): e.g. '034'
  - lat / lng (string, required): WGS-84 decimal coordinates
  - limit (number, default 5): how many of the closest stops to return (max 20)
  - response_format ('markdown' | 'json')

Returns (json):
  {
    "stops": [
      {
        "sId": "021-15232", "sn": "西藏中路", "distance": 87, "isSubway": false,
        "physicalStId": "...", "namesakeStId": "...", "firstLineId": "...",
        "lines": [
          {
            "lineId": "...", "name": "71", "direction": 0, "endSn": "...",
            "status": "等待发车" | "不在运营时间" | "" (running),
            "preArrivalTime": "10:10" | undefined,
            "targetOrder": 2, "targetStationId": "021-15232",
            "buses": [
              { "busId": "...", "order": 2, "arrivalTime": 1779070466055, "travelTime": 25, "distanceToDest": 90, "capacity": 0 }
            ]
          }
        ],
        "subwayLines": [ { "name": "地铁2号线", "shortName": "2号线", "color": "140,194,32", "directions": [{ "destName": "...", "firstTime": "05:31", "lastTime": "23:24" }] } ]
      }
    ]
  }

Field notes:
- buses[].arrivalTime is a ms timestamp; -1 = unknown
- buses[].travelTime is seconds remaining; -1 = unknown
- buses[].capacity: 0=light, 1=moderate, 2=crowded
- If no realtime buses but the line is starting soon, 'preArrivalTime' will hold the next predicted dispatch ("10:12")`,
      inputSchema: NearbyInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const raw = await request<RawNearbyResponse>(
          `${BASE_URL}/bus/stop!encryptedHomePage.action`,
          {
            ...DEFAULT_PARAMS,
            cityId: params.city_id,
            localCityId: "undefined",
            lat: params.lat,
            lng: params.lng,
            geo_lat: params.lat,
            geo_lng: params.lng,
            type: "5",
            permission: "0",
          },
        );
        const lean = reshapeNearby(raw, params.limit);
        return pickFormat(
          params.response_format as ResponseFormat,
          () => renderNearby(lean),
          lean as unknown as Record<string, unknown>,
        );
      } catch (e) {
        return toUpstreamError(e);
      }
    },
  );

  server.registerTool(
    "bus_get_stop_detail",
    {
      title: "Get stop detail with all lines",
      description: `Full detail for a stop: precise WGS-84 coordinates, every line that passes through (with first/last/price), realtime buses, and nearby metro lines.

Args:
  - city_id (string, required)
  - physical_st_id (string, required): from bus_get_nearby_stops / bus_search
  - namesake_st_id (string, optional): recommended; from the same source
  - first_line_id (string, optional): a line to highlight
  - lat / lng (string, optional): caller's WGS-84 location, used to populate 'distance'
  - response_format ('markdown' | 'json')

Returns (json):
  {
    "stations": [
      { "sId": "...", "sn": "...", "lat": ..., "lng": ..., "distance": ...,
        "lines": [{ "lineId": "...", "name": "71", "direction": 0, "startSn": "...", "endSn": "...", "firstTime": "05:30", "lastTime": "23:30", "price": "2元", "targetOrder": 2, "buses": [...] }],
        "metros": [{ "name": "地铁14号线", "lineNo": "14号线", "color": "97,96,32" }] }
    ]
  }

Multiple entries in stations[] mean the stop name maps to several physical platforms.`,
      inputSchema: StopDetailInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const raw = await request<RawStopDetailResponse>(
          `${BASE_URL}/bus/stop!encryptedPhyStnDetail.action`,
          {
            ...DEFAULT_PARAMS,
            cityId: params.city_id,
            localCityId: params.city_id,
            physicalStId: params.physical_st_id,
            namesakeStId: params.namesake_st_id ?? "",
            firstLineId: params.first_line_id ?? "",
            stationId: "",
            lat: params.lat ?? "",
            lng: params.lng ?? "",
            geo_lat: params.lat ?? "",
            geo_lng: params.lng ?? "",
            actionState: "1",
            permission: "0",
          },
        );
        const lean = reshapeStopDetail(raw);
        return pickFormat(
          params.response_format as ResponseFormat,
          () => renderStopDetail(lean),
          lean as unknown as Record<string, unknown>,
        );
      } catch (e) {
        return toUpstreamError(e);
      }
    },
  );
}
