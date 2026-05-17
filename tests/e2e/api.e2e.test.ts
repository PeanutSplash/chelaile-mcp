/**
 * E2E tests that hit the real Chelaile upstream API to detect schema drift.
 *
 * These tests intentionally:
 *   - call real network endpoints
 *   - use zod to assert the response shape (extra fields are allowed via
 *     passthrough; the *required* fields are the ones our tools actually read)
 *   - run sequentially because some tools depend on IDs returned by earlier ones
 *
 * Run with:
 *   bun run test:e2e
 *
 * The suite is skipped unless CHELAILE_E2E=1 is set, so the default `bun test`
 * does not hit the network.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import * as http from "node:http";
import { z } from "zod";
import { REQUEST_TIMEOUT_MS } from "../../src/constants.js";
import {
  BASE_DOMAIN,
  BASE_URL,
  DEFAULT_PARAMS,
  request,
  requestPlain,
  requestRaw,
} from "../../src/http-client.js";
import type {
  BusDetailResponse,
  BusListResponse,
  CityConfigResponse,
  CityListResponse,
  LineDetailResponse,
  LineRouteResponse,
  NearbyResponse,
  RawTransitResponse,
  RefreshResponse,
  ReverseGeoResponse,
  SearchResponse,
  StopDetailResponse,
  TimetableResponse,
} from "../../src/types.js";

const SHANGHAI = "034";
const LAT = "31.230416"; // 人民广场, WGS-84
const LNG = "121.473701";
// 人民广场, rough GCJ-02 (only used for transit; ~500m offset from WGS does not
// matter — we only validate response shape, not routing accuracy)
const LAT_GCJ = "31.232";
const LNG_GCJ = "121.479";

const E2E_ENABLED = process.env.CHELAILE_E2E === "1";

// zod helpers
const numOrStr = z.union([z.number(), z.string()]);
const optStr = z.string().optional();
const optNum = z.number().optional();

// -- response schemas ----------------------------------------------------------

const CityListSchema = z
  .object({
    cityList: z
      .array(
        z
          .object({
            cityId: z.string(),
            cityName: z.string(),
            pinyin: optStr,
            isHot: optNum,
            isSupport: optNum,
            isGpsCity: optNum,
            supportSubway: optNum,
            cityVersion: optNum,
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough();

const CityConfigSchema = z
  .object({
    maxInterval: z.number(),
    arrivingStationLimitSeconds: z.number(),
    busDisplayConfig: z
      .object({ lineDetail: optStr, other: optStr })
      .passthrough()
      .optional(),
  })
  .passthrough();

const ReverseGeoSchema = z
  .object({
    regeocode: z
      .object({
        formatted_address: z.string().optional(),
        addressComponent: z
          .object({
            province: optStr,
            // upstream returns [] for municipalities
            city: z.union([z.string(), z.array(z.unknown())]).optional(),
            district: optStr,
            township: optStr,
            citycode: optStr,
            adcode: optStr,
          })
          .passthrough()
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();

const LineSummarySchema = z
  .object({
    lineId: z.string(),
    name: optStr,
    direction: optNum,
    startSn: optStr,
    endSn: optStr,
  })
  .passthrough();

const StationSummarySchema = z
  .object({
    sId: optStr,
    sn: optStr,
    order: optNum,
    physicalStId: optStr,
    namesakeStId: optStr,
  })
  .passthrough();

const SearchSchema = z
  .object({
    result: z
      .object({
        lines: z.array(LineSummarySchema).optional(),
        stations: z.array(StationSummarySchema).optional(),
        pois: z
          .array(
            z
              .object({
                sn1: optStr,
                sn1Address: optStr,
                adname: optStr,
                lat: numOrStr.optional(),
                lng: numOrStr.optional(),
              })
              .passthrough(),
          )
          .optional(),
      })
      .passthrough(),
    highlightKey: optStr,
  })
  .passthrough();

const NearbySchema = z
  .object({
    nearSts: z
      .array(
        z
          .object({
            sId: optStr,
            sn: optStr,
            distance: optNum,
            physicalStId: optStr,
            namesakeStId: optStr,
            lines: z
              .array(
                z
                  .object({
                    line: LineSummarySchema,
                    targetStation: StationSummarySchema.optional(),
                    stnStates: z.array(z.unknown()).optional(),
                  })
                  .passthrough(),
              )
              .optional(),
          })
          .passthrough(),
      )
      .min(1, "expected at least one nearby stop near 人民广场"),
  })
  .passthrough();

const StopDetailSchema = z
  .object({
    stationList: z
      .array(
        z
          .object({
            sId: optStr,
            sn: optStr,
            lat: numOrStr.optional(),
            lng: numOrStr.optional(),
            lines: z.array(z.unknown()).optional(),
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough();

const LineDetailSchema = z
  .object({
    line: LineSummarySchema,
    stations: z.array(StationSummarySchema).min(1),
    buses: z.array(z.unknown()).optional(),
  })
  .passthrough();

const LineRouteSchema = z
  .object({
    route: z
      .array(
        z
          .object({
            lat: z.number(),
            lng: z.number(),
            stopOrder: optNum,
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough();

const BusListSchema = z
  .object({
    buses: z.array(z.unknown()).optional(),
    targetOrder: optNum,
  })
  .passthrough();

const BusDetailSchema = z
  .object({
    buses: z.array(z.unknown()).optional(),
    line: LineSummarySchema.optional(),
    targetOrder: optNum,
    realData: z.boolean().optional(),
  })
  .passthrough();

const TimetableSchema = z
  .object({
    line: LineSummarySchema.optional(),
    timeTableType: optNum,
  })
  .passthrough();

const RefreshSchema = z
  .object({
    lines: z
      .array(
        z
          .object({
            line: LineSummarySchema.optional(),
            buses: z.array(z.unknown()).optional(),
            depDesc: optStr,
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

// ip-api.com — the new bus_get_my_location tool uses this. We validate that
// the upstream still emits the fields renderMyLocation reads.
const IpApiSchema = z
  .object({
    status: z.literal("success"),
    country: z.string(),
    regionName: z.string(),
    city: z.string(),
    lat: z.number(),
    lon: z.number(),
    query: z.string(),
    isp: z.string().optional(),
  })
  .passthrough();

const TransitSchema = z
  .object({
    route: z
      .object({
        distance: z.union([z.string(), z.number()]).optional(),
        origin: optStr,
        destination: optStr,
        transits: z.array(z.unknown()).optional(),
      })
      .passthrough(),
  })
  .passthrough();

// -- chained state -------------------------------------------------------------

interface Ctx {
  lineId?: string;
  lineNo?: string;
  direction?: number;
  physicalStId?: string;
  namesakeStId?: string;
  stationId?: string;
  targetOrder?: number;
  stationName?: string;
}
const ctx: Ctx = {};

const skip = !E2E_ENABLED;

describe.skipIf(skip)("Chelaile e2e — upstream schema contract", () => {
  beforeAll(() => {
    if (skip) return;
    // eslint-disable-next-line no-console
    console.error("[e2e] CHELAILE_E2E=1 — hitting real upstream");
  });

  test(
    "bus_list_cities returns a non-empty city list",
    async () => {
      const data = await requestPlain<CityListResponse>(
        `${BASE_DOMAIN}/wwd/ncitylist`,
        { ...DEFAULT_PARAMS },
      );
      const parsed = CityListSchema.parse(data);
      expect(parsed.cityList.some((c) => c.cityId === SHANGHAI)).toBe(true);
    },
    20000,
  );

  test(
    "bus_get_city_config returns operating policy",
    async () => {
      const data = await request<CityConfigResponse>(
        `${BASE_URL}/bus/cityMaxInterval.action`,
        {
          ...DEFAULT_PARAMS,
          cityId: SHANGHAI,
          localCityId: SHANGHAI,
        },
      );
      CityConfigSchema.parse(data);
    },
    20000,
  );

  test(
    "bus_reverse_geocode returns a regeocode envelope",
    async () => {
      const data = await requestRaw<ReverseGeoResponse>(
        `${BASE_URL}/transfer/transit!getLocationByGps.action`,
        {
          ...DEFAULT_PARAMS,
          lat: LAT,
          lng: LNG,
          geo_lat: LAT,
          geo_lng: LNG,
          gpsType: "wgs",
          gpstype: "wgs",
          geo_type: "wgs",
        },
      );
      ReverseGeoSchema.parse(data);
    },
    20000,
  );

  test(
    "bus_search by line number '71路' returns at least one matching line",
    async () => {
      const data = await request<SearchResponse>(
        `${BASE_URL}/bus/query!nSearch.action`,
        {
          ...DEFAULT_PARAMS,
          cityId: SHANGHAI,
          localCityId: SHANGHAI,
          key: "71路",
          supportPhyStn: "true",
        },
      );
      const parsed = SearchSchema.parse(data);
      const lines = parsed.result.lines ?? [];
      expect(lines.length).toBeGreaterThan(0);
      const first = lines[0];
      ctx.lineId = first.lineId;
      ctx.lineNo = first.name;
      ctx.direction = first.direction ?? 0;
    },
    20000,
  );

  test(
    "bus_search_more returns the same envelope shape",
    async () => {
      const data = await request<SearchResponse>(
        `${BASE_URL}/bus/query!searchMore.action`,
        {
          ...DEFAULT_PARAMS,
          cityId: SHANGHAI,
          localCityId: SHANGHAI,
          key: "71路",
          type: "1",
          supportPhyStn: "true",
        },
      );
      SearchSchema.parse(data);
    },
    20000,
  );

  test(
    "bus_get_nearby_stops returns a list with line/target metadata",
    async () => {
      const data = await request<NearbyResponse>(
        `${BASE_URL}/bus/stop!encryptedHomePage.action`,
        {
          ...DEFAULT_PARAMS,
          cityId: SHANGHAI,
          localCityId: "undefined",
          lat: LAT,
          lng: LNG,
          geo_lat: LAT,
          geo_lng: LNG,
          type: "5",
          permission: "0",
        },
      );
      const parsed = NearbySchema.parse(data);
      const stop = parsed.nearSts[0];
      expect(stop.physicalStId).toBeTruthy();
      ctx.physicalStId = stop.physicalStId;
      ctx.namesakeStId = stop.namesakeStId;
      const firstLine = stop.lines?.[0];
      if (firstLine) {
        ctx.lineId = firstLine.line.lineId ?? ctx.lineId;
        ctx.lineNo = firstLine.line.name ?? ctx.lineNo;
        ctx.direction = firstLine.line.direction ?? ctx.direction ?? 0;
        ctx.stationId = firstLine.targetStation?.sId ?? stop.sId;
        ctx.targetOrder = firstLine.targetStation?.order ?? 1;
        ctx.stationName = stop.sn;
      }
    },
    20000,
  );

  test(
    "bus_get_stop_detail returns a stationList for known physicalStId",
    async () => {
      if (!ctx.physicalStId) throw new Error("missing physicalStId from nearby");
      const data = await request<StopDetailResponse>(
        `${BASE_URL}/bus/stop!encryptedPhyStnDetail.action`,
        {
          ...DEFAULT_PARAMS,
          cityId: SHANGHAI,
          localCityId: SHANGHAI,
          physicalStId: ctx.physicalStId,
          namesakeStId: ctx.namesakeStId ?? "",
          firstLineId: "",
          stationId: "",
          lat: LAT,
          lng: LNG,
          geo_lat: LAT,
          geo_lng: LNG,
          actionState: "1",
          permission: "0",
        },
      );
      StopDetailSchema.parse(data);
    },
    20000,
  );

  test(
    "bus_get_line_detail returns line + stations for a known lineId",
    async () => {
      if (!ctx.lineId) throw new Error("missing lineId from search");
      const data = await request<LineDetailResponse>(
        `${BASE_URL}/bus/line!encryptedLineDetail.action`,
        {
          ...DEFAULT_PARAMS,
          cityId: SHANGHAI,
          localCityId: SHANGHAI,
          lineId: ctx.lineId,
          lat: LAT,
          lng: LNG,
          geo_lat: LAT,
          geo_lng: LNG,
        },
      );
      const parsed = LineDetailSchema.parse(data);
      // Pin a station_id we can use for realtime/buslist if nearby didn't yield
      // one.
      if (!ctx.stationId) {
        const first = parsed.stations[0];
        ctx.stationId = first.sId;
        ctx.targetOrder = first.order ?? 1;
        ctx.stationName = first.sn;
      }
    },
    20000,
  );

  test(
    "bus_get_line_route returns a non-empty polyline",
    async () => {
      if (!ctx.lineId) throw new Error("missing lineId");
      const data = await request<LineRouteResponse>(
        `${BASE_URL}/bus/line!lineRoute.action`,
        {
          ...DEFAULT_PARAMS,
          cityId: SHANGHAI,
          localCityId: SHANGHAI,
          lineId: ctx.lineId,
        },
      );
      LineRouteSchema.parse(data);
    },
    20000,
  );

  test(
    "bus_get_line_realtime returns realtime envelope",
    async () => {
      if (!ctx.lineId || !ctx.stationId || ctx.targetOrder == null) {
        throw new Error("missing chain inputs for realtime");
      }
      const data = await request<BusDetailResponse>(
        `${BASE_URL}/bus/line!encryptedBusDetail.action`,
        {
          ...DEFAULT_PARAMS,
          cshow: "busDetail",
          specail: "0",
          specialType: "undefined",
          cityId: SHANGHAI,
          localCityId: SHANGHAI,
          lineId: ctx.lineId,
          targetOrder: String(ctx.targetOrder),
          specialTargetOrder: String(ctx.targetOrder),
          stationId: ctx.stationId,
          lat: LAT,
          lng: LNG,
          geo_lat: LAT,
          geo_lng: LNG,
          userId: "",
          h5Id: "",
          unionId: "",
          accountId: "",
          secret: "",
        },
      );
      BusDetailSchema.parse(data);
    },
    20000,
  );

  test(
    "bus_list_line_buses returns the line-wide bus list",
    async () => {
      if (!ctx.lineId || ctx.targetOrder == null || !ctx.stationName) {
        throw new Error("missing chain inputs for buslist");
      }
      const data = await request<BusListResponse>(
        `${BASE_URL}/bus/line!busList.action`,
        {
          ...DEFAULT_PARAMS,
          cityId: SHANGHAI,
          localCityId: SHANGHAI,
          lineId: ctx.lineId,
          targetOrder: String(ctx.targetOrder),
          stationName: ctx.stationName,
          nextStationName: "",
        },
      );
      BusListSchema.parse(data);
    },
    20000,
  );

  test(
    "bus_get_timetable returns timetable metadata",
    async () => {
      if (!ctx.lineId || !ctx.lineNo || ctx.direction == null) {
        throw new Error("missing chain inputs for timetable");
      }
      const data = await request<TimetableResponse>(
        `${BASE_URL}/bus/line!preStartTimetableNew.action`,
        {
          ...DEFAULT_PARAMS,
          cityId: SHANGHAI,
          lineId: ctx.lineId,
          lineNo: ctx.lineNo,
          direction: String(ctx.direction),
          tabType: "0",
        },
      );
      TimetableSchema.parse(data);
    },
    20000,
  );

  test(
    "bus_refresh_lines returns refreshed lines",
    async () => {
      if (!ctx.lineId || !ctx.stationId || ctx.targetOrder == null) {
        throw new Error("missing chain inputs for refresh");
      }
      const data = await request<RefreshResponse>(
        `${BASE_URL}/bus/line!encryptedTsfRealInfos.action`,
        {
          ...DEFAULT_PARAMS,
          reqSrc: "2",
          cityId: SHANGHAI,
          localCityId: SHANGHAI,
          lineStn: `${ctx.lineId},${ctx.stationId},,${ctx.targetOrder}`,
        },
      );
      RefreshSchema.parse(data);
    },
    20000,
  );

  test(
    "bus_get_my_location: ip-api.com returns the fields renderMyLocation reads",
    async () => {
      // Hit a known IP so the test is deterministic and not subject to where
      // the caller's machine happens to be located. 8.8.8.8 (Google DNS) is
      // always resolvable and lives in the US.
      const data = await new Promise<unknown>((resolve, reject) => {
        const req = http.request(
          {
            hostname: "ip-api.com",
            path: "/json/8.8.8.8?lang=zh-CN",
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
        req.on("timeout", () =>
          req.destroy(new Error("ip-api timed out")),
        );
        req.on("error", reject);
        req.end();
      });
      IpApiSchema.parse(data);
    },
    20000,
  );

  test(
    "bus_plan_transit returns alternative transit plans",
    async () => {
      const data = await request<RawTransitResponse>(
        `${BASE_URL}/transfer/transit!integrate.action`,
        {
          ...DEFAULT_PARAMS,
          cityId: SHANGHAI,
          localCityId: SHANGHAI,
          origin_name: "人民广场",
          origin_lat: LAT_GCJ,
          origin_lng: LNG_GCJ,
          dest_name: "上海虹桥火车站",
          dest_lat: "31.194",
          dest_lng: "121.319",
          gpstype: "gcj",
          geo_type: "gcj",
          strategy: "0",
          isSelectTime: "0",
          departure_time: String(Date.now()),
        },
      );
      TransitSchema.parse(data);
    },
    20000,
  );
});
