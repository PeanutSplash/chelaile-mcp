import { describe, expect, test } from "bun:test";
import {
  NearbyInput,
  StopDetailInput,
  fmtEta,
  renderNearby,
  renderStopDetail,
  reshapeBus,
  reshapeNearby,
  reshapeStopDetail,
} from "../../../src/tools/stops.js";

describe("reshapeBus", () => {
  test("maps fields and fills defaults", () => {
    expect(
      reshapeBus({ busId: "B1", order: 2, travelTime: 60, capacity: 1 }),
    ).toEqual({
      busId: "B1",
      order: 2,
      arrivalTime: -1,
      travelTime: 60,
      capacity: 1,
    });
  });

  test("omits distanceToDest when null/undefined", () => {
    const out = reshapeBus({ busId: "B1" });
    expect(out).not.toHaveProperty("distanceToDest");
  });

  test("preserves distanceToDest=0 (a valid sentinel)", () => {
    const out = reshapeBus({ busId: "B1", distanceToDest: 0 });
    expect(out.distanceToDest).toBe(0);
  });
});

describe("fmtEta", () => {
  test("returns '—' for missing / non-positive travelTime", () => {
    expect(fmtEta({ busId: "", order: 0, arrivalTime: -1, travelTime: -1, capacity: 0 })).toBe("—");
    expect(fmtEta({ busId: "", order: 0, arrivalTime: -1, travelTime: 0, capacity: 0 })).toBe("—");
  });

  test("seconds under 60s", () => {
    expect(fmtEta({ busId: "", order: 0, arrivalTime: -1, travelTime: 45, capacity: 0 })).toBe("45s");
  });

  test("minutes for >=60s", () => {
    expect(fmtEta({ busId: "", order: 0, arrivalTime: -1, travelTime: 150, capacity: 0 })).toBe("3min");
  });
});

describe("reshapeNearby", () => {
  test("honours the limit", () => {
    const raw = {
      nearSts: Array.from({ length: 8 }, (_, i) => ({
        sId: `S${i}`,
        sn: `n${i}`,
      })),
    };
    expect(reshapeNearby(raw, 3).stops).toHaveLength(3);
    expect(reshapeNearby(raw, 20).stops).toHaveLength(8);
  });

  test("flattens lines, status, target and buses", () => {
    const out = reshapeNearby(
      {
        nearSts: [
          {
            sId: "S1",
            sn: "西藏中路",
            distance: 87,
            isSubway: 0,
            physicalStId: "phys",
            namesakeStId: "name",
            firstLineId: "L1",
            lines: [
              {
                line: {
                  lineId: "L1",
                  name: "71",
                  direction: 0,
                  endSn: "外滩",
                  firstTime: "05:30",
                  lastTime: "23:00",
                  shortDesc: "  ",
                  nextOperationTimeDesc: "等待发车",
                },
                preArrivalTime: "10:10",
                targetStation: { sId: "S1", order: 2 },
                stnStates: [
                  { busId: "B1", order: 2, travelTime: 60, capacity: 0 },
                ],
              },
            ],
            subwayV2Lines: [
              {
                line: { lineName: "地铁8号线", shortName: "8号线", bgColor: "ff0000" },
                sublines: [
                  { destName: "市光路", firstTime: "05:30", lastTime: "23:00" },
                ],
              },
            ],
          },
        ],
      },
      5,
    );

    expect(out.stops).toHaveLength(1);
    const stop = out.stops[0];
    expect(stop.sId).toBe("S1");
    expect(stop.isSubway).toBe(false);
    expect(stop.lines[0]).toMatchObject({
      lineId: "L1",
      name: "71",
      direction: 0,
      endSn: "外滩",
      status: "等待发车",
      preArrivalTime: "10:10",
      firstTime: "05:30",
      lastTime: "23:00",
      targetOrder: 2,
      targetStationId: "S1",
    });
    expect(stop.lines[0].buses).toHaveLength(1);
    expect(stop.lines[0].buses[0]).toEqual({
      busId: "B1",
      order: 2,
      arrivalTime: -1,
      travelTime: 60,
      capacity: 0,
    });
    expect(stop.subwayLines[0]).toEqual({
      name: "地铁8号线",
      shortName: "8号线",
      color: "ff0000",
      directions: [{ destName: "市光路", firstTime: "05:30", lastTime: "23:00" }],
    });
  });

  test("status prefers shortDesc when truthy", () => {
    const out = reshapeNearby(
      {
        nearSts: [
          {
            sId: "S1",
            sn: "x",
            lines: [
              {
                line: { lineId: "L1", shortDesc: "拥挤", nextOperationTimeDesc: "等待发车" },
              },
            ],
          },
        ],
      },
      5,
    );
    expect(out.stops[0].lines[0].status).toBe("拥挤");
  });
});

describe("renderNearby", () => {
  test("empty marker", () => {
    expect(renderNearby({ stops: [] })).toContain("_No nearby stops._");
  });

  test("renders stop, status, ETA and metro line", () => {
    const out = renderNearby({
      stops: [
        {
          sId: "S1",
          sn: "西藏中路",
          distance: 87,
          isSubway: false,
          physicalStId: "phys",
          namesakeStId: "name",
          firstLineId: "L1",
          lines: [
            {
              lineId: "L1",
              name: "71",
              direction: 0,
              endSn: "外滩",
              status: "等待发车",
              targetOrder: 2,
              buses: [],
              preArrivalTime: "10:10",
            },
            {
              lineId: "L2",
              name: "72",
              direction: 0,
              endSn: "X",
              status: "",
              targetOrder: 3,
              buses: [
                {
                  busId: "B1",
                  order: 3,
                  arrivalTime: -1,
                  travelTime: 60,
                  capacity: 0,
                },
              ],
            },
          ],
          subwayLines: [
            {
              name: "地铁2号线",
              shortName: "2号线",
              color: "ff0000",
              directions: [
                {
                  destName: "浦东国际机场",
                  firstTime: "05:30",
                  lastTime: "23:00",
                },
              ],
            },
          ],
        },
      ],
    });

    expect(out).toContain("# Nearby stops (1)");
    expect(out).toContain("## 西藏中路 (S1) — 87m");
    expect(out).toContain("- physicalStId: phys");
    expect(out).toContain("- namesakeStId: name");
    expect(out).toContain(
      "- 71 → 外滩 (lineId=L1, targetOrder=2) [等待发车] ETA: dep 10:10",
    );
    expect(out).toContain(
      "- 72 → X (lineId=L2, targetOrder=3) ETA: 1min",
    );
    expect(out).toContain("- 🚇 地铁2号线: →浦东国际机场 (05:30–23:00)");
  });

  test("marks subway stops in the header", () => {
    const out = renderNearby({
      stops: [
        {
          sId: "S1",
          sn: "X",
          distance: 0,
          isSubway: true,
          lines: [],
          subwayLines: [],
        },
      ],
    });
    expect(out).toContain("[metro]");
  });
});

describe("reshapeStopDetail", () => {
  test("maps stations, lines, buses, metros", () => {
    const out = reshapeStopDetail({
      stationList: [
        {
          sId: "S1",
          sn: "西藏中路",
          lat: 31.23,
          lng: 121.47,
          distance: 50,
          lines: [
            {
              line: {
                lineId: "L1",
                name: "71",
                direction: 0,
                startSn: "申昆路",
                endSn: "外滩",
                firstTime: "05:30",
                lastTime: "23:00",
                price: "2元",
              },
              targetStation: { sId: "S1", order: 2 },
              stnStates: [{ busId: "B1", order: 2, travelTime: 120, capacity: 0 }],
            },
          ],
          metros: [{ fullName: "地铁8号线", lineNo: "8号线", color: "ff0000" }],
        },
      ],
    });
    expect(out.stations).toHaveLength(1);
    expect(out.stations[0]).toMatchObject({
      sId: "S1",
      sn: "西藏中路",
      lat: 31.23,
      lng: 121.47,
      distance: 50,
    });
    expect(out.stations[0].lines[0]).toMatchObject({
      lineId: "L1",
      name: "71",
      startSn: "申昆路",
      endSn: "外滩",
      firstTime: "05:30",
      lastTime: "23:00",
      price: "2元",
      targetOrder: 2,
      targetStationId: "S1",
    });
    expect(out.stations[0].metros).toEqual([
      { name: "地铁8号线", lineNo: "8号线", color: "ff0000" },
    ]);
  });

  test("dedupes same-sId entries, keeping the richer record", () => {
    // Upstream regression: 陆家嘴地铁站 (021-469) comes back twice — the
    // second copy has lines=[] but the same metros, which used to render as
    // an empty duplicate header. Keep only the row with the lines.
    const out = reshapeStopDetail({
      stationList: [
        {
          sId: "021-469",
          sn: "陆家嘴地铁站",
          lat: 31.240126,
          lng: 121.498106,
          lines: [
            {
              line: { lineId: "L1", name: "992", direction: 1, startSn: "A", endSn: "B" },
            },
          ],
          metros: [{ fullName: "地铁2号线", lineNo: "2号线" }],
        },
        {
          sId: "021-469",
          sn: "陆家嘴地铁站",
          lat: 31.240126,
          lng: 121.498106,
          lines: [],
          metros: [{ fullName: "地铁2号线", lineNo: "2号线" }],
        },
      ],
    });
    expect(out.stations).toHaveLength(1);
    expect(out.stations[0].lines).toHaveLength(1);
    expect(out.stations[0].lines[0].name).toBe("992");
  });
});

describe("renderStopDetail", () => {
  test("renders all sections", () => {
    const out = renderStopDetail({
      stations: [
        {
          sId: "S1",
          sn: "西藏中路",
          lat: 31.23,
          lng: 121.47,
          distance: 50,
          lines: [
            {
              lineId: "L1",
              name: "71",
              direction: 0,
              startSn: "申昆路",
              endSn: "外滩",
              firstTime: "05:30",
              lastTime: "23:00",
              price: "2元",
              targetOrder: 2,
              buses: [
                {
                  busId: "B1",
                  order: 2,
                  arrivalTime: -1,
                  travelTime: 180,
                  capacity: 0,
                  distanceToDest: 600,
                },
              ],
            },
          ],
          metros: [{ name: "地铁8号线", lineNo: "8号线" }],
        },
      ],
    });
    expect(out).toContain("# 西藏中路 (S1)");
    expect(out).toContain("- coords (WGS): 31.23, 121.47");
    expect(out).toContain("- distance: 50m");
    expect(out).toContain("## Lines through this stop");
    expect(out).toContain(
      "- 71 申昆路 → 外滩 | 05:30–23:00 | 2元",
    );
    expect(out).toContain("  - bus B1 order=2 ETA=3min distToStop=600m");
    expect(out).toContain("## Nearby metro");
    expect(out).toContain("- 地铁8号线");
  });

  test("empty marker when no stations", () => {
    expect(renderStopDetail({ stations: [] })).toContain("_No stop matched._");
  });

  test("falls back to '—' for negative travelTime", () => {
    const out = renderStopDetail({
      stations: [
        {
          sId: "S1",
          sn: "X",
          lat: 0,
          lng: 0,
          distance: -1,
          lines: [
            {
              lineId: "L1",
              name: "1",
              direction: 0,
              startSn: "",
              endSn: "",
              buses: [
                {
                  busId: "B",
                  order: 0,
                  arrivalTime: -1,
                  travelTime: -1,
                  capacity: 0,
                },
              ],
            },
          ],
          metros: [],
        },
      ],
    });
    expect(out).toContain("ETA=—");
  });
});

describe("NearbyInput", () => {
  test("requires city_id, lat, lng", () => {
    expect(() => NearbyInput.parse({})).toThrow();
    expect(() => NearbyInput.parse({ city_id: "034" })).toThrow();
    expect(() => NearbyInput.parse({ city_id: "034", lat: "1" })).toThrow();
  });

  test("rejects non-decimal lat/lng", () => {
    expect(() =>
      NearbyInput.parse({ city_id: "034", lat: "north", lng: "1" }),
    ).toThrow();
  });

  test("limit defaults to 5 and is clamped 1..20", () => {
    const parsed = NearbyInput.parse({
      city_id: "034",
      lat: "31",
      lng: "121",
    });
    expect(parsed.limit).toBe(5);

    expect(() =>
      NearbyInput.parse({ city_id: "034", lat: "31", lng: "121", limit: 0 }),
    ).toThrow();
    expect(() =>
      NearbyInput.parse({ city_id: "034", lat: "31", lng: "121", limit: 25 }),
    ).toThrow();
    expect(() =>
      NearbyInput.parse({ city_id: "034", lat: "31", lng: "121", limit: 1.5 }),
    ).toThrow();
  });
});

describe("StopDetailInput", () => {
  test("requires physical_st_id", () => {
    expect(() => StopDetailInput.parse({ city_id: "034" })).toThrow();
  });

  test("accepts optional namesake/firstLine/lat/lng", () => {
    const parsed = StopDetailInput.parse({
      city_id: "034",
      physical_st_id: "phys",
      namesake_st_id: "name",
      first_line_id: "L1",
      lat: "31.23",
      lng: "121.47",
    });
    expect(parsed.physical_st_id).toBe("phys");
    expect(parsed.namesake_st_id).toBe("name");
  });
});
