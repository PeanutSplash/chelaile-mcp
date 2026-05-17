import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BASE_URL, DEFAULT_PARAMS, request } from "../http-client.js";
import {
  ResponseFormat,
  ResponseFormatSchema,
  pickFormat,
  roundCoord,
  toUpstreamError,
} from "../format.js";

// ---------- input schemas ----------

const intStringSchema = z
  .string()
  .regex(/^\d+$/, "Must be a positive integer string");

export const LineDetailInput = z
  .object({
    city_id: z.string().min(1),
    line_id: z
      .string()
      .min(1)
      .describe("lineId from bus_search.lines / bus_get_nearby_stops.lines"),
    lat: z.string().regex(/^-?\d+(\.\d+)?$/).optional(),
    lng: z.string().regex(/^-?\d+(\.\d+)?$/).optional(),
    response_format: ResponseFormatSchema,
  })
  .strict();

export const LineRouteInput = z
  .object({
    city_id: z.string().min(1),
    line_id: z.string().min(1),
    include_shape: z
      .boolean()
      .default(false)
      .describe(
        "If true, include all polyline shape points (often 400-500 per line). Default false returns only stop-marker points.",
      ),
    response_format: ResponseFormatSchema,
  })
  .strict();

export const LineRealtimeInput = z
  .object({
    city_id: z.string().min(1),
    line_id: z.string().min(1),
    target_order: intStringSchema.describe(
      "Order index of the waiting stop on the line. Get it from bus_get_line_detail.stations[].order or bus_get_nearby_stops.stops[].lines[].targetOrder.",
    ),
    station_id: z.string().min(1).describe("sId of the waiting stop"),
    lat: z
      .string()
      .regex(/^-?\d+(\.\d+)?$/)
      .describe(
        "WGS-84 latitude. If the user's location is unknown, fall back to the waiting stop's lat (from line_detail.stations[].wgsLat).",
      ),
    lng: z
      .string()
      .regex(/^-?\d+(\.\d+)?$/)
      .describe("WGS-84 longitude. Fallback to the stop's wgsLng if unknown."),
    response_format: ResponseFormatSchema,
  })
  .strict();

export const LineBusListInput = z
  .object({
    city_id: z.string().min(1),
    line_id: z.string().min(1),
    target_order: intStringSchema,
    station_name: z.string().min(1).describe("Display name of the target stop"),
    response_format: ResponseFormatSchema,
  })
  .strict();

export const TimetableInput = z
  .object({
    city_id: z.string().min(1),
    line_id: z.string().min(1),
    line_no: z
      .string()
      .min(1)
      .describe(
        "Rider-facing short name (search.lines[].name), e.g. '71'. NOT the internal lineNo like 'r95817'.",
      ),
    direction: z.enum(["0", "1"]),
    response_format: ResponseFormatSchema,
  })
  .strict();

export const RefreshInput = z
  .object({
    city_id: z.string().min(1),
    line_stn: z
      .string()
      .min(1)
      .describe(
        "Quadruple list: lineId,stopId,nextId,targetOrder; separated by ';'. nextId may be empty.",
      ),
    response_format: ResponseFormatSchema,
  })
  .strict();

// ---------- raw types ----------

interface RawTravel {
  order?: number;
  travelTime?: number;
  arrivalTime?: number;
  recommTip?: string;
}

interface RawBus {
  busId?: string;
  licence?: string;
  order?: number;
  lat?: number;
  lng?: number;
  speed?: number;
  capacity?: number;
  distanceToWaitStn?: number;
  distanceToDest?: number;
  distanceToTgt?: number;
  nextStationName?: string;
  // refresh-line endpoint returns these at the top level (no travels[] wrap)
  travelTime?: number;
  arrivalTime?: number;
  travels?: RawTravel[];
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
}

interface RawMetro {
  lineId?: string;
  fullName?: string;
  lineNo?: string;
  color?: string;
}

interface RawStation {
  order?: number;
  sId?: string;
  sn?: string;
  wgsLat?: number;
  wgsLng?: number;
  physicalStId?: string;
  namesakeStId?: string;
  metros?: RawMetro[];
}

interface RawOtherLine {
  lineId?: string;
  startSn?: string;
  endSn?: string;
  firstTime?: string;
  lastTime?: string;
  price?: string;
}

interface RawLineDetailResponse {
  line?: RawLineField;
  stations?: RawStation[];
  buses?: RawBus[];
  otherlines?: RawOtherLine[];
  depDesc?: string;
  preArrivalTime?: string;
  targetOrder?: number;
}

interface RawBusDetailResponse {
  buses?: RawBus[];
  line?: RawLineField;
  targetOrder?: number;
  realData?: boolean;
}

interface RawBusListResponse {
  targetOrder?: number;
  buses?: RawBus[];
}

interface RawLineRouteResponse {
  route?: Array<{ lat: number; lng: number; stopOrder?: number }>;
}

interface RawTimetableResponse {
  line?: RawLineField;
  timeTableType?: number;
  timetable?: unknown;
  scheduleTags?: unknown[];
}

interface RawRefreshResponse {
  lines?: Array<{
    line?: RawLineField;
    buses?: RawBus[];
    depDesc?: string;
  }>;
}

// ---------- lean types ----------

interface LeanEta {
  travelTime: number;
  arrivalTime: number;
  displayTime?: string;
}

interface LeanBusLine {
  busId: string;
  order: number;
  lat: number;
  lng: number;
  speed: number;
  capacity: number;
  distanceToWaitStn?: number;
}

interface LeanRealtimeBus extends LeanBusLine {
  licence?: string;
  eta: LeanEta | null;
}

interface LeanLineBus extends LeanBusLine {
  licence?: string;
  nextStop?: string;
  eta: LeanEta | null;
}

interface LeanLine {
  lineId: string;
  name: string;
  lineNo: string;
  direction: number;
  startSn: string;
  endSn: string;
  firstTime?: string;
  lastTime?: string;
  price?: string;
  stationsNum?: number;
}

interface LeanStation {
  order: number;
  sId: string;
  sn: string;
  wgsLat: number;
  wgsLng: number;
  physicalStId?: string;
  namesakeStId?: string;
  metros: Array<{ name: string; lineNo: string; color?: string }>;
}

interface LeanLineDetail {
  line: LeanLine;
  stations: LeanStation[];
  buses: LeanBusLine[];
  reverseDirection: {
    lineId: string;
    startSn: string;
    endSn: string;
    firstTime?: string;
    lastTime?: string;
    price?: string;
  } | null;
  depDesc?: string;
  preArrivalTime?: string;
  targetOrder?: number;
  // Populated when upstream returned a fully-empty payload (typical for subway
  // lineIds). Lets the agent route to the right follow-up instead of looping.
  empty?: boolean;
  hint?: string;
}

interface LeanLineRealtime {
  // Upstream does NOT return startSn on this endpoint; only endSn. Callers who
  // need startSn must read it from bus_get_line_detail.
  line: Pick<LeanLine, "lineId" | "name" | "direction" | "endSn">;
  targetOrder: number;
  realData: boolean;
  buses: LeanRealtimeBus[];
  note: string;
}

interface LeanLineBuses {
  targetOrder: number;
  buses: LeanLineBus[];
}

interface LeanLineRoute {
  pointCount: number;
  stopCount: number;
  points: Array<{ lat: number; lng: number; stopOrder?: number }>;
}

interface LeanTimetable {
  line: Pick<LeanLine, "lineId" | "name" | "direction" | "startSn" | "endSn">;
  timeTableType: number;
  mode: "scheduled" | "interval" | "special" | "unknown";
  timetable: unknown[] | null;
  note?: string;
}

interface LeanRefresh {
  lines: Array<{
    line: Pick<LeanLine, "lineId" | "name" | "direction" | "endSn">;
    depDesc?: string;
    buses: Array<{
      busId: string;
      order: number;
      capacity: number;
      distanceToDest?: number;
      eta: LeanEta | null;
    }>;
  }>;
}

// ---------- reshape helpers ----------

export function leanLine(l: RawLineField | undefined): LeanLine {
  return {
    lineId: l?.lineId ?? "",
    name: l?.name ?? "",
    lineNo: l?.lineNo ?? "",
    direction: l?.direction ?? 0,
    startSn: l?.startSn ?? "",
    endSn: l?.endSn ?? "",
    firstTime: l?.firstTime || undefined,
    lastTime: l?.lastTime || undefined,
    price: l?.price || undefined,
    stationsNum: l?.stationsNum,
  };
}

export function leanEta(travels: RawTravel[] | undefined): LeanEta | null {
  const t = travels?.[0];
  if (!t || !t.travelTime || t.travelTime < 0) return null;
  return {
    travelTime: t.travelTime,
    arrivalTime: t.arrivalTime ?? -1,
    displayTime: t.recommTip,
  };
}

export function leanBusLine(b: RawBus): LeanBusLine {
  return {
    busId: b.busId ?? "",
    order: b.order ?? 0,
    lat: roundCoord(b.lat),
    lng: roundCoord(b.lng),
    speed: b.speed ?? 0,
    capacity: b.capacity ?? 0,
    ...(b.distanceToWaitStn != null && b.distanceToWaitStn >= 0
      ? { distanceToWaitStn: b.distanceToWaitStn }
      : {}),
  };
}

export function fmtEta(eta: LeanEta | null): string {
  if (!eta) return "—";
  if (eta.travelTime < 60) return `${eta.travelTime}s`;
  return `${Math.round(eta.travelTime / 60)}min${eta.displayTime ? ` (${eta.displayTime})` : ""}`;
}

// ---------- reshape per tool ----------

export function reshapeLineDetail(raw: RawLineDetailResponse): LeanLineDetail {
  const rev = raw.otherlines?.[0];
  const stations = (raw.stations ?? []).map((s) => ({
    order: s.order ?? 0,
    sId: s.sId ?? "",
    sn: s.sn ?? "",
    wgsLat: roundCoord(s.wgsLat),
    wgsLng: roundCoord(s.wgsLng),
    ...(s.physicalStId ? { physicalStId: s.physicalStId } : {}),
    ...(s.namesakeStId ? { namesakeStId: s.namesakeStId } : {}),
    metros: (s.metros ?? []).map((m) => ({
      name: m.fullName ?? "",
      lineNo: m.lineNo ?? "",
      color: m.color,
    })),
  }));
  const buses = (raw.buses ?? []).map(leanBusLine);
  // Subway lineIds (e.g. '1057') and a handful of decommissioned bus lineIds
  // come back as an all-empty shell. Surface that explicitly so the agent
  // routes to bus_get_stop_detail / bus_plan_transit instead of looping.
  const isEmpty =
    !raw.line?.lineId &&
    !raw.line?.name &&
    stations.length === 0 &&
    buses.length === 0;
  return {
    line: leanLine(raw.line),
    stations,
    buses,
    reverseDirection: rev
      ? {
          lineId: rev.lineId ?? "",
          startSn: rev.startSn ?? "",
          endSn: rev.endSn ?? "",
          firstTime: rev.firstTime || undefined,
          lastTime: rev.lastTime || undefined,
          price: rev.price || undefined,
        }
      : null,
    depDesc: raw.depDesc || undefined,
    preArrivalTime: raw.preArrivalTime || undefined,
    targetOrder: raw.targetOrder,
    ...(isEmpty
      ? {
          empty: true,
          hint:
            "Upstream returned no data for this lineId. This typically means it is a SUBWAY line (bus_get_line_detail does not cover metro), or the lineId has been retired. For subway first/last times, call bus_get_nearby_stops at a coordinate the metro passes through and read the `subwayLines[].directions` of any returned stop with `isSubway:true` (stop_detail's `metros` only has line names, no schedule). For metro routing, use bus_plan_transit. For buses, re-resolve the lineId via bus_search.",
        }
      : {}),
  };
}

export function reshapeLineRealtime(raw: RawBusDetailResponse): LeanLineRealtime {
  const buses = (raw.buses ?? []).map<LeanRealtimeBus>((b) => ({
    ...leanBusLine(b),
    licence: b.licence || undefined,
    eta: leanEta(b.travels),
  }));
  return {
    line: {
      lineId: raw.line?.lineId ?? "",
      name: raw.line?.name ?? "",
      direction: raw.line?.direction ?? 0,
      endSn: raw.line?.endSn ?? "",
    },
    targetOrder: raw.targetOrder ?? 0,
    realData: raw.realData ?? false,
    buses,
    note:
      "Upstream only predicts an ETA for the nearest bus heading to your stop. Buses farther down the line are still listed (with position) but their `eta` is null.",
  };
}

export function reshapeLineBuses(raw: RawBusListResponse): LeanLineBuses {
  return {
    targetOrder: raw.targetOrder ?? 0,
    buses: (raw.buses ?? []).map<LeanLineBus>((b) => ({
      ...leanBusLine(b),
      licence: b.licence || undefined,
      nextStop: b.nextStationName || undefined,
      eta: leanEta(b.travels),
    })),
  };
}

export function reshapeLineRoute(
  raw: RawLineRouteResponse,
  includeShape: boolean,
): LeanLineRoute {
  const all = (raw.route ?? []).map((p) => ({
    lat: roundCoord(p.lat),
    lng: roundCoord(p.lng),
    ...(p.stopOrder != null ? { stopOrder: p.stopOrder } : {}),
  }));
  const points = includeShape ? all : all.filter((p) => p.stopOrder != null);
  return {
    pointCount: all.length,
    stopCount: all.filter((p) => p.stopOrder != null).length,
    points,
  };
}

export function reshapeTimetable(raw: RawTimetableResponse): LeanTimetable {
  const type = raw.timeTableType ?? 0;
  const mode: LeanTimetable["mode"] =
    type === 1 ? "scheduled" : type === 2 ? "interval" : type === 3 ? "special" : "unknown";
  const note =
    mode === "interval"
      ? "This line runs at a fixed interval — the upstream does not return per-trip departure times. Use bus_get_line_detail to read firstTime/lastTime/price."
      : mode === "scheduled"
        ? undefined
        : "Timetable type not recognised; fall back to bus_get_line_detail.";
  return {
    line: {
      lineId: raw.line?.lineId ?? "",
      name: raw.line?.name ?? "",
      direction: raw.line?.direction ?? 0,
      startSn: raw.line?.startSn ?? "",
      endSn: raw.line?.endSn ?? "",
    },
    timeTableType: type,
    mode,
    timetable: Array.isArray(raw.timetable) ? raw.timetable : null,
    note,
  };
}

export function reshapeRefresh(raw: RawRefreshResponse): LeanRefresh {
  return {
    lines: (raw.lines ?? []).map((li) => ({
      line: {
        lineId: li.line?.lineId ?? "",
        name: li.line?.name ?? "",
        direction: li.line?.direction ?? 0,
        endSn: li.line?.endSn ?? "",
      },
      depDesc: li.depDesc || undefined,
      buses: (li.buses ?? []).map((b) => ({
        busId: b.busId ?? "",
        order: b.order ?? 0,
        capacity: b.capacity ?? 0,
        distanceToDest:
          b.distanceToTgt ?? b.distanceToDest ?? undefined,
        eta: (() => {
          if (!b.travelTime || b.travelTime < 0) return null;
          return {
            travelTime: b.travelTime,
            arrivalTime: b.arrivalTime ?? -1,
          } as LeanEta;
        })(),
      })),
    })),
  };
}

// ---------- markdown renderers ----------

export function renderLineDetail(d: LeanLineDetail): string {
  if (d.empty) {
    return [
      "# Line detail: empty",
      `_${d.hint ?? "Upstream returned no data."}_`,
    ].join("\n");
  }
  const out: string[] = [
    `# Line ${d.line.name} (${d.line.lineId})`,
    `- ${d.line.startSn} → ${d.line.endSn} | direction=${d.line.direction}`,
    `- first ${d.line.firstTime ?? "?"} / last ${d.line.lastTime ?? "?"} | ${d.line.price ?? ""} | ${d.line.stationsNum ?? "?"} stops`,
  ];
  if (d.preArrivalTime) out.push(`- Next at start: ${d.preArrivalTime}`);
  if (d.depDesc) out.push(`- ${d.depDesc}`);
  if (d.reverseDirection) {
    out.push(
      `- Reverse: lineId=${d.reverseDirection.lineId} ${d.reverseDirection.startSn}→${d.reverseDirection.endSn}`,
    );
  }
  if (d.stations.length) {
    out.push("", "## Stations");
    for (const s of d.stations) {
      const metro = s.metros.length ? ` [${s.metros.map((m) => m.name).join(", ")}]` : "";
      out.push(`  ${s.order}. ${s.sn} (${s.sId})${metro}`);
    }
  }
  if (d.buses.length) {
    out.push("", `## Live buses (${d.buses.length})`);
    for (const b of d.buses) {
      out.push(
        `- ${b.busId} order=${b.order} (${b.lat},${b.lng}) speed=${b.speed} capacity=${b.capacity}`,
      );
    }
  }
  return out.join("\n");
}

export function renderLineRealtime(d: LeanLineRealtime): string {
  const out: string[] = [
    `# Realtime ${d.line.name} → ${d.line.endSn} (targetOrder=${d.targetOrder})`,
    `- realData=${d.realData} | buses=${d.buses.length}`,
  ];
  for (const b of d.buses) {
    const dist = b.distanceToWaitStn != null ? `, ${b.distanceToWaitStn}m away` : "";
    out.push(
      `- ${b.licence || b.busId} order=${b.order} speed=${b.speed}km/h cap=${b.capacity}${dist} | ETA ${fmtEta(b.eta)}`,
    );
  }
  if (!d.buses.length) out.push("_No buses currently running._");
  out.push("", `_Note: ${d.note}_`);
  return out.join("\n");
}

export function renderLineBuses(d: LeanLineBuses): string {
  if (!d.buses.length) return "_No buses on this line right now._";
  const out: string[] = [`# Buses (targetOrder=${d.targetOrder})`];
  for (const b of d.buses) {
    out.push(
      `- ${b.licence || b.busId} order=${b.order} speed=${b.speed} cap=${b.capacity} → ${b.nextStop ?? "?"} | ETA ${fmtEta(b.eta)}`,
    );
  }
  return out.join("\n");
}

export function renderLineRoute(d: LeanLineRoute): string {
  return `# Line route: ${d.pointCount} points (${d.stopCount} stop markers). Request response_format=json to read the actual coordinates.`;
}

export function renderTimetable(d: LeanTimetable): string {
  const lines = [
    `# Timetable for ${d.line.name} (${d.line.lineId})`,
    `- direction: ${d.line.direction}`,
    `- mode: ${d.mode} (timeTableType=${d.timeTableType})`,
  ];
  if (d.timetable && d.timetable.length) {
    lines.push(`- ${d.timetable.length} schedule entr${d.timetable.length === 1 ? "y" : "ies"} (json mode to read)`);
  }
  if (d.note) lines.push(`- ${d.note}`);
  return lines.join("\n");
}

export function renderRefresh(d: LeanRefresh): string {
  if (!d.lines.length) {
    return "_Upstream returned no entries. This endpoint occasionally returns an empty list on a transient hiccup — retry once. If it persists, verify each `lineId,stopId,nextId,targetOrder` quadruple (nextId may be empty)._";
  }
  const out: string[] = [`# Refresh (${d.lines.length} lines)`];
  for (const li of d.lines) {
    out.push(
      `- ${li.line.name} (${li.line.lineId}) → ${li.line.endSn}: ${li.buses.length} bus(es)${li.depDesc ? `, ${li.depDesc}` : ""}`,
    );
    for (const b of li.buses) {
      out.push(`  - ${b.busId} order=${b.order} cap=${b.capacity} ETA ${fmtEta(b.eta)}`);
    }
  }
  return out.join("\n");
}

// ---------- register ----------

export function registerLineTools(server: McpServer): void {
  server.registerTool(
    "bus_get_line_detail",
    {
      title: "Get full line detail (stops + live buses)",
      description: `Full info for a line: rider-facing fields (name, first/last/price, stationsNum), the full ordered station list, the reverse-direction lineId, and every bus currently on the line.

**Use this — not bus_get_timetable — to answer "is line X still running" or "first/last bus time" questions.** The timetable tool only has data for a small minority of lines.

**Subway lines are NOT supported.** If bus_search returned a line with isSubway=true (e.g. lineId=1057 for 地铁2号线), this endpoint returns an empty payload — the response will carry \`empty: true\` and a \`hint\` field pointing at bus_get_nearby_stops / bus_plan_transit. Don't retry; route to those tools instead.

Args:
  - city_id (string, required)
  - line_id (string, required): from bus_search.lines[*].lineId
  - lat / lng (string, optional): caller's WGS-84 coordinates
  - response_format ('markdown' | 'json')

Returns (json):
  {
    "line": { "lineId":"...", "name":"71", "lineNo":"r95817", "direction":0, "startSn":"...", "endSn":"...", "firstTime":"05:30", "lastTime":"23:30", "price":"2元", "stationsNum":24 },
    "stations": [{ "order":1, "sId":"...", "sn":"...", "wgsLat":..., "wgsLng":..., "physicalStId":"...", "namesakeStId":"...", "metros":[{"name":"地铁14号线","lineNo":"14号线","color":"97,96,32"}] }, ...],
    "buses": [{ "busId":"...", "order":2, "lat":..., "lng":..., "speed":5.7, "capacity":0, "distanceToWaitStn":...}],
    "reverseDirection": { "lineId":"...", "startSn":"...", "endSn":"...", "firstTime":"04:30", "lastTime":"22:30", "price":"2元" } | null,
    "depDesc": "...", "preArrivalTime": "...", "targetOrder": 24,
    "empty": true, "hint": "..."   // present only when upstream returned no data (subway / retired line)
  }

Each station carries:
- 'order' → feed into bus_get_line_realtime / bus_list_line_buses as target_order
- 'sId' → feed into bus_get_line_realtime as station_id (NOT into bus_get_stop_detail!)
- 'physicalStId' + 'namesakeStId' → feed into bus_get_stop_detail to see every line through that stop`,
      inputSchema: LineDetailInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const raw = await request<RawLineDetailResponse>(
          `${BASE_URL}/bus/line!encryptedLineDetail.action`,
          {
            ...DEFAULT_PARAMS,
            cityId: params.city_id,
            localCityId: params.city_id,
            lineId: params.line_id,
            lat: params.lat ?? "",
            lng: params.lng ?? "",
            geo_lat: params.lat ?? "",
            geo_lng: params.lng ?? "",
          },
        );
        const lean = reshapeLineDetail(raw);
        return pickFormat(
          params.response_format as ResponseFormat,
          () => renderLineDetail(lean),
          lean as unknown as Record<string, unknown>,
        );
      } catch (e) {
        return toUpstreamError(e);
      }
    },
  );

  server.registerTool(
    "bus_get_line_route",
    {
      title: "Get line polyline coordinates",
      description: `Polyline coordinates for drawing a line on a map. Points with 'stopOrder' are actual stops; others are shape points between stops.

Args:
  - city_id (string, required)
  - line_id (string, required)
  - include_shape (boolean, default false): false returns only stop markers (~25 points); true returns all shape points (~400-500). Skip unless you actually need to draw the line.
  - response_format ('markdown' | 'json')

Returns (json):
  {
    "pointCount": 480,           // total shape points upstream returned
    "stopCount": 23,             // stop markers among them
    "points": [{ "lat":..., "lng":..., "stopOrder":1 }, ...]
  }
'points' is the filtered list — stops only by default, full polyline when include_shape=true.

**Known caveat**: upstream sometimes omits the terminus stop from the polyline, so 'stopCount' may be one less than bus_get_line_detail's 'stationsNum' (e.g. 23 vs 24). Trust bus_get_line_detail for the authoritative station list; line_route is just for drawing.

Markdown mode only summarises counts; request JSON to read coordinates.`,
      inputSchema: LineRouteInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const raw = await request<RawLineRouteResponse>(
          `${BASE_URL}/bus/line!lineRoute.action`,
          {
            ...DEFAULT_PARAMS,
            cityId: params.city_id,
            localCityId: params.city_id,
            lineId: params.line_id,
          },
        );
        const lean = reshapeLineRoute(raw, params.include_shape);
        return pickFormat(
          params.response_format as ResponseFormat,
          () => renderLineRoute(lean),
          lean as unknown as Record<string, unknown>,
        );
      } catch (e) {
        return toUpstreamError(e);
      }
    },
  );

  server.registerTool(
    "bus_get_line_realtime",
    {
      title: "Get realtime buses for a (line, stop) pair",
      description: `Canonical "when will my bus arrive" tool. Returns every bus currently on the line, with the nearest one carrying an ETA to the waiting stop.

**Important**: the upstream predicts an ETA for only the nearest bus heading to your stop. Buses farther up the route are returned (with position/speed/capacity) but their \`eta\` field is null. That's not a bug.

**Args**:
  - city_id (string, required)
  - line_id (string, required): from bus_search
  - target_order (string, required): the waiting stop's order on the line. Source: bus_get_line_detail.stations[i].order, or bus_get_nearby_stops.stops[].lines[].targetOrder.
  - station_id (string, required): sId of the waiting stop
  - lat / lng (string, required): WGS-84 — the user's location is best; if unavailable, use the waiting stop's wgsLat/wgsLng (from line_detail.stations[i]).
  - response_format ('markdown' | 'json')

Returns (json):
  {
    "line": { "lineId":"...", "name":"71", "direction":0, "endSn":"..." },
    "targetOrder": 2,
    "realData": true,
    "buses": [
      { "busId":"...", "licence":"...", "order":2, "lat":..., "lng":..., "speed":5.7, "capacity":0, "distanceToWaitStn":90, "eta":{"travelTime":25,"arrivalTime":1779070466055,"displayTime":"10:14"} },
      { "busId":"...", "order":3, "lat":..., "lng":..., "speed":3, "capacity":0, "eta":null },
      ...
    ],
    "note": "..."
  }

Field notes:
- The 'line' sub-object intentionally omits startSn — upstream does not return it on this endpoint. Read it from bus_get_line_detail if needed.
- eta.travelTime is seconds remaining
- eta.arrivalTime is a ms timestamp
- eta.displayTime is a "HH:MM" hint from upstream
- capacity: 0=light, 1=moderate, 2=crowded`,
      inputSchema: LineRealtimeInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const raw = await request<RawBusDetailResponse>(
          `${BASE_URL}/bus/line!encryptedBusDetail.action`,
          {
            ...DEFAULT_PARAMS,
            cshow: "busDetail",
            specail: "0",
            specialType: "undefined",
            cityId: params.city_id,
            localCityId: params.city_id,
            lineId: params.line_id,
            targetOrder: params.target_order,
            specialTargetOrder: params.target_order,
            stationId: params.station_id,
            lat: params.lat,
            lng: params.lng,
            geo_lat: params.lat,
            geo_lng: params.lng,
            userId: "",
            h5Id: "",
            unionId: "",
            accountId: "",
            secret: "",
          },
        );
        const lean = reshapeLineRealtime(raw);
        return pickFormat(
          params.response_format as ResponseFormat,
          () => renderLineRealtime(lean),
          lean as unknown as Record<string, unknown>,
        );
      } catch (e) {
        return toUpstreamError(e);
      }
    },
  );

  server.registerTool(
    "bus_list_line_buses",
    {
      title: "Get the nearest approaching bus on a line",
      description: `Returns the nearest bus heading to the anchor stop, with ETA and the bus's next stop name.

**This is narrower than the name suggests.** Despite the upstream endpoint being called "busList", in practice it returns at most 1-2 buses (the imminent ones). For the FULL roster of every bus currently on the line, call **bus_get_line_detail** — its 'buses' array lists all live vehicles with positions.

Use this tool when you want a quick "what's about to arrive" answer for a specific stop.

Args:
  - city_id (string, required)
  - line_id (string, required)
  - target_order (string, required): the waiting stop's order on the line
  - station_name (string, required): display name of that anchor stop
  - response_format ('markdown' | 'json')

Returns (json):
  {
    "targetOrder": 2,
    "buses": [
      { "busId":"...", "licence":"...", "order":2, "lat":..., "lng":..., "speed":8.2, "capacity":0, "nextStop":"西藏中路", "eta":{"travelTime":214,"arrivalTime":..., "displayTime":"10:14"} }
    ]
  }`,
      inputSchema: LineBusListInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const raw = await request<RawBusListResponse>(
          `${BASE_URL}/bus/line!busList.action`,
          {
            ...DEFAULT_PARAMS,
            cityId: params.city_id,
            localCityId: params.city_id,
            lineId: params.line_id,
            targetOrder: params.target_order,
            stationName: params.station_name,
            nextStationName: "",
          },
        );
        const lean = reshapeLineBuses(raw);
        return pickFormat(
          params.response_format as ResponseFormat,
          () => renderLineBuses(lean),
          lean as unknown as Record<string, unknown>,
        );
      } catch (e) {
        return toUpstreamError(e);
      }
    },
  );

  server.registerTool(
    "bus_get_timetable",
    {
      title: "Get a line's per-trip schedule (rarely useful)",
      description: `Per-trip departure schedule for a line. The upstream returns one of three modes via \`mode\`:
  - 'scheduled' (timeTableType=1): an explicit \`timetable\` array of trips
  - 'interval' (timeTableType=2): the line runs at a fixed headway — NO per-trip times are returned
  - 'special' / 'unknown' (timeTableType=3 or other)

**Most lines in Shanghai are 'interval'**, so this tool is rarely the right one. To answer "first/last bus", "is the line still running", or "what's the next departure", call **bus_get_line_detail** instead — it always returns firstTime / lastTime / price / live buses.

Args:
  - city_id (string, required)
  - line_id (string, required)
  - line_no (string, required): rider-facing short name from bus_search.lines[].name (e.g. '71'). Do NOT pass the internal lineNo like 'r95817'.
  - direction ('0'|'1'): the line direction
  - response_format ('markdown' | 'json')

Returns (json):
  {
    "line": { "lineId":"...", "name":"71", "direction":0, "startSn":"...", "endSn":"..." },
    "timeTableType": 2,
    "mode": "interval",
    "timetable": null,
    "note": "This line runs at a fixed interval — ..."
  }`,
      inputSchema: TimetableInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const raw = await request<RawTimetableResponse>(
          `${BASE_URL}/bus/line!preStartTimetableNew.action`,
          {
            ...DEFAULT_PARAMS,
            cityId: params.city_id,
            lineId: params.line_id,
            lineNo: params.line_no,
            direction: params.direction,
            tabType: "0",
          },
        );
        const lean = reshapeTimetable(raw);
        return pickFormat(
          params.response_format as ResponseFormat,
          () => renderTimetable(lean),
          lean as unknown as Record<string, unknown>,
        );
      } catch (e) {
        return toUpstreamError(e);
      }
    },
  );

  server.registerTool(
    "bus_refresh_lines",
    {
      title: "Batch refresh realtime info for multiple (line, stop) pairs",
      description: `Refresh realtime bus info for several (line, stop) pairs in one round-trip. Useful for a 'favourites' dashboard.

Args:
  - city_id (string, required)
  - line_stn (string, required): semicolon-separated quadruples
      Format: lineId,stopId,nextId,targetOrder;lineId,stopId,nextId,targetOrder;...
      'nextId' may be empty between the two commas.
  - response_format ('markdown' | 'json')

Example: '21283603183,021-15232,,2;21283604388,021-8685,,4'

Returns (json):
  {
    "lines": [
      {
        "line": { "lineId":"...", "name":"71", "direction":0, "endSn":"..." },
        "depDesc": "...",
        "buses": [
          { "busId":"...", "order":2, "capacity":0, "distanceToDest":881, "eta":{"travelTime":221,"arrivalTime":...} }
        ]
      }
    ]
  }

Soft cap: up to 10 quadruples per call.`,
      inputSchema: RefreshInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const raw = await request<RawRefreshResponse>(
          `${BASE_URL}/bus/line!encryptedTsfRealInfos.action`,
          {
            ...DEFAULT_PARAMS,
            reqSrc: "2",
            cityId: params.city_id,
            localCityId: params.city_id,
            lineStn: params.line_stn,
          },
        );
        const lean = reshapeRefresh(raw);
        return pickFormat(
          params.response_format as ResponseFormat,
          () => renderRefresh(lean),
          lean as unknown as Record<string, unknown>,
        );
      } catch (e) {
        return toUpstreamError(e);
      }
    },
  );
}
