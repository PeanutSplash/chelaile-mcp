import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BASE_URL, DEFAULT_PARAMS, request } from "../http-client.js";
import {
  ResponseFormat,
  ResponseFormatSchema,
  pickFormat,
  toUpstreamError,
} from "../format.js";
import type {
  RawTransitBusline,
  RawTransitPlan,
  RawTransitResponse,
  RawTransitSegment,
  TransitPlanResult,
  TransitSegment,
} from "../types.js";

export const TransitInput = z
  .object({
    city_id: z.string().min(1),
    origin_name: z.string().min(1).describe("Origin display name"),
    origin_lat: z
      .string()
      .regex(/^-?\d+(\.\d+)?$/)
      .describe("Origin latitude in GCJ-02"),
    origin_lng: z
      .string()
      .regex(/^-?\d+(\.\d+)?$/)
      .describe("Origin longitude in GCJ-02"),
    dest_name: z.string().min(1).describe("Destination display name"),
    dest_lat: z
      .string()
      .regex(/^-?\d+(\.\d+)?$/)
      .describe("Destination latitude in GCJ-02"),
    dest_lng: z
      .string()
      .regex(/^-?\d+(\.\d+)?$/)
      .describe("Destination longitude in GCJ-02"),
    strategy: z
      .enum(["0", "1", "2", "3"])
      .default("0")
      .describe(
        "Routing strategy: 0=recommended (default; surfaces metro), 1=fewest transfers, 2=least walking, 3=shortest time among BUS-ONLY candidates (upstream often excludes metro from this strategy — when in doubt, use 0). For most user questions, 0 is the right choice.",
      ),
    response_format: ResponseFormatSchema,
  })
  .strict();

export function fmtHHMM(t?: string): string {
  if (!t || t.length < 4) return "";
  return `${t.slice(0, 2)}:${t.slice(2)}`;
}

export function reshape(
  raw: RawTransitResponse,
  strategy: "0" | "1" | "2" | "3" = "0",
): TransitPlanResult {
  const r = raw.route ?? {};
  const plans = (r.transits ?? []).map((plan: RawTransitPlan) => ({
    duration: Number(plan.duration ?? 0),
    walkingDistance: Number(plan.walking_distance ?? 0),
    distance: Number(plan.distance ?? 0),
    tag: plan.tag ?? "",
    transitCount: plan.cc ?? 0,
    segments: (plan.segments ?? []).flatMap<TransitSegment>(
      (seg: RawTransitSegment) => {
        const out: TransitSegment[] = [];
        if (seg.walking && Number(seg.walking.distance) > 0) {
          out.push({
            type: "walking",
            distance: Number(seg.walking.distance ?? 0),
            duration: Number(seg.walking.duration ?? 0),
          });
        }
        const line: RawTransitBusline | undefined = seg.bus?.buslines?.[0];
        if (line) {
          const viaStr = line.via_num;
          // Distinguish "upstream said 0" from "upstream omitted the field".
          // Showing "direct" for a missing field used to mislead users into
          // thinking a 17-stop metro ride had no intermediate stops.
          const parsedVia =
            viaStr === undefined || viaStr === null || viaStr === ""
              ? undefined
              : Number(viaStr);
          out.push({
            type: "bus",
            name: line.name ?? "?",
            lineType: line.lineType ?? 0,
            color: line.color,
            departureStop: line.departure_stop?.name ?? "?",
            arrivalStop: line.arrival_stop?.name ?? "?",
            ...(parsedVia != null && Number.isFinite(parsedVia)
              ? { viaStops: parsedVia }
              : {}),
            duration: Number(line.duration ?? 0),
            distance: Number(line.distance ?? 0),
            startTime: fmtHHMM(line.station_start_time),
            endTime: fmtHHMM(line.station_end_time),
          });
        }
        return out;
      },
    ),
  }));
  // strategy=3 ("shortest time") on the upstream returns BUS-ONLY candidates;
  // it silently drops metro plans even when a single subway ride would beat
  // every bus combination. Observed in Shanghai: 陆家嘴→虹桥火车站 with
  // strategy=3 returned 3-transfer 2-hour bus chains, while strategy=0 had a
  // 44-min metro-2 direct. Warn so callers don't trust the misleading sort.
  const hasMetro = plans.some((p) =>
    p.segments.some((s) => s.type === "bus" && s.lineType === 1),
  );
  let note: string | undefined;
  if (strategy === "3" && !hasMetro && plans.length > 0) {
    note =
      "strategy=3 (shortest time) returned only bus plans. Upstream often excludes metro from this strategy — if the trip plausibly has a metro option (long distance, central districts), retry with strategy=0 (recommended) which usually surfaces metro direct routes.";
  }
  return {
    origin: r.origin ?? "",
    destination: r.destination ?? "",
    distance: Number(r.distance ?? 0),
    plans,
    ...(note ? { note } : {}),
  };
}

export function renderPlan(d: TransitPlanResult): string {
  if (!d.plans.length) return "_No plans found._";
  const out: string[] = [
    `# Transit plans (${d.plans.length})`,
    `- Origin: ${d.origin}`,
    `- Destination: ${d.destination}`,
    `- Straight-line distance: ${d.distance} m`,
  ];
  for (const [i, p] of d.plans.entries()) {
    out.push(
      "",
      `## Plan ${i + 1}${p.tag ? ` — ${p.tag}` : ""}`,
      `- duration: ${Math.round(p.duration / 60)} min, walk ${p.walkingDistance} m, total ${p.distance} m, transfers: ${p.transitCount}`,
    );
    for (const seg of p.segments) {
      if (seg.type === "walking") {
        out.push(
          `  - walk ${seg.distance} m (${Math.round(seg.duration / 60)} min)`,
        );
      } else {
        // viaStops counts intermediate stops between board and alight. We
        // distinguish three cases: present>0 → render count; present===0 →
        // "direct" (e.g. 磁浮线 from 龙阳路 to 浦东机场); missing → omit so we
        // don't claim "0 stops" for legs where upstream just didn't send it.
        const stopHint =
          seg.viaStops != null && seg.viaStops > 0
            ? ` (${seg.viaStops} stops between)`
            : seg.viaStops === 0
              ? " (direct)"
              : "";
        out.push(
          `  - ${seg.name}${seg.lineType === 1 ? " (metro)" : ""}: ${seg.departureStop} → ${seg.arrivalStop}${stopHint}${
            seg.startTime ? `, runs ${seg.startTime}-${seg.endTime}` : ""
          }`,
        );
      }
    }
  }
  if (d.note) out.push("", `_⚠ ${d.note}_`);
  return out.join("\n");
}

export function registerTransitTools(server: McpServer): void {
  server.registerTool(
    "bus_plan_transit",
    {
      title: "Plan a public-transit route",
      description: `Plan a public-transit (bus + metro) route between two points. Returns alternative plans sorted by recommendation, each broken into walking and ride segments.

**Coordinate system**: this tool expects GCJ-02. The easiest source is bus_search.pois[*].lat/lng — those are already GCJ-02 and carry a name. If you only have WGS-84 (e.g. from a phone GPS), convert it before calling.

Args:
  - city_id (string, required)
  - origin_name, origin_lat, origin_lng (string, required): origin in GCJ-02
  - dest_name, dest_lat, dest_lng (string, required): destination in GCJ-02
  - strategy ('0'|'1'|'2'|'3'): 0=recommended (default; surfaces metro), 1=fewest transfers, 2=least walking, 3=shortest time (BUS-ONLY — upstream often drops metro plans here, so for general "fastest route" questions use 0)
  - response_format ('markdown' | 'json')

Returns (json):
  {
    "origin": "lng,lat",
    "destination": "lng,lat",
    "distance": 17982,
    "plans": [
      {
        "duration": 3056, "walkingDistance": 1466, "distance": 19086, "tag": "直达", "transitCount": 1,
        "segments": [
          { "type": "walking", "distance": 837, "duration": 717 },
          { "type": "bus", "name": "地铁2号线", "lineType": 1, "departureStop": "人民广场", "arrivalStop": "虹桥2号航站楼", "viaStops": 8, "duration": 1800, "distance": 17620, "startTime": "05:37", "endTime": "23:30" }
        ]
      }
    ]
  }
lineType: 0=bus, 1=metro. Durations in seconds, distances in meters.

A top-level 'note' field is emitted when the response shape is suspicious — e.g. strategy=3 returned no metro plans despite this being a likely metro trip.`,
      inputSchema: TransitInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const raw = await request<RawTransitResponse>(
          `${BASE_URL}/transfer/transit!integrate.action`,
          {
            ...DEFAULT_PARAMS,
            cityId: params.city_id,
            localCityId: params.city_id,
            origin_name: params.origin_name,
            origin_lat: params.origin_lat,
            origin_lng: params.origin_lng,
            dest_name: params.dest_name,
            dest_lat: params.dest_lat,
            dest_lng: params.dest_lng,
            gpstype: "gcj",
            geo_type: "gcj",
            strategy: params.strategy,
            isSelectTime: "0",
            departure_time: String(Date.now()),
          },
        );
        const shaped = reshape(raw, params.strategy as "0" | "1" | "2" | "3");
        return pickFormat(
          params.response_format as ResponseFormat,
          () => renderPlan(shaped),
          shaped as unknown as Record<string, unknown>,
        );
      } catch (e) {
        return toUpstreamError(e);
      }
    },
  );
}
