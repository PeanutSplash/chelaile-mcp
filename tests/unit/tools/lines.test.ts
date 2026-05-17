import { describe, expect, test } from "bun:test";
import {
  LineBusListInput,
  LineDetailInput,
  LineRealtimeInput,
  LineRouteInput,
  RefreshInput,
  TimetableInput,
  fmtEta,
  leanBusLine,
  leanEta,
  leanLine,
  renderLineBuses,
  renderLineDetail,
  renderLineRealtime,
  renderLineRoute,
  renderRefresh,
  renderTimetable,
  reshapeLineBuses,
  reshapeLineDetail,
  reshapeLineRealtime,
  reshapeLineRoute,
  reshapeRefresh,
  reshapeTimetable,
} from "../../../src/tools/lines.js";

// ---------- helpers ----------

describe("fmtEta", () => {
  test("null → '—'", () => {
    expect(fmtEta(null)).toBe("—");
  });

  test("seconds under 60", () => {
    expect(fmtEta({ travelTime: 45, arrivalTime: -1 })).toBe("45s");
    expect(fmtEta({ travelTime: 59, arrivalTime: -1 })).toBe("59s");
  });

  test("minutes for >=60s, includes displayTime when present", () => {
    expect(fmtEta({ travelTime: 60, arrivalTime: -1 })).toBe("1min");
    expect(
      fmtEta({ travelTime: 240, arrivalTime: -1, displayTime: "10:14" }),
    ).toBe("4min (10:14)");
    expect(fmtEta({ travelTime: 91, arrivalTime: -1 })).toBe("2min");
  });
});

describe("leanLine", () => {
  test("maps with safe defaults", () => {
    expect(
      leanLine({
        lineId: "L1",
        name: "71",
        lineNo: "r1",
        direction: 1,
        startSn: "A",
        endSn: "B",
        firstTime: "05:30",
        lastTime: "23:00",
        price: "2元",
        stationsNum: 24,
      }),
    ).toEqual({
      lineId: "L1",
      name: "71",
      lineNo: "r1",
      direction: 1,
      startSn: "A",
      endSn: "B",
      firstTime: "05:30",
      lastTime: "23:00",
      price: "2元",
      stationsNum: 24,
    });
  });

  test("undefined raw collapses to a zero-shape LeanLine", () => {
    expect(leanLine(undefined)).toEqual({
      lineId: "",
      name: "",
      lineNo: "",
      direction: 0,
      startSn: "",
      endSn: "",
      firstTime: undefined,
      lastTime: undefined,
      price: undefined,
      stationsNum: undefined,
    });
  });

  test("empty strings become undefined for optional fields", () => {
    const l = leanLine({ firstTime: "", lastTime: "", price: "" });
    expect(l.firstTime).toBeUndefined();
    expect(l.lastTime).toBeUndefined();
    expect(l.price).toBeUndefined();
  });
});

describe("leanEta", () => {
  test("returns null when missing / negative / empty", () => {
    expect(leanEta(undefined)).toBeNull();
    expect(leanEta([])).toBeNull();
    expect(leanEta([{ travelTime: -1 }])).toBeNull();
    expect(leanEta([{}])).toBeNull();
  });

  test("returns the first travel's eta", () => {
    expect(
      leanEta([
        { travelTime: 60, arrivalTime: 123, recommTip: "10:14" },
        { travelTime: 600, arrivalTime: 456 },
      ]),
    ).toEqual({
      travelTime: 60,
      arrivalTime: 123,
      displayTime: "10:14",
    });
  });

  test("fills arrivalTime with -1 when missing", () => {
    expect(leanEta([{ travelTime: 30 }])).toEqual({
      travelTime: 30,
      arrivalTime: -1,
      displayTime: undefined,
    });
  });
});

describe("leanBusLine", () => {
  test("maps with defaults", () => {
    expect(
      leanBusLine({
        busId: "B1",
        order: 2,
        lat: 31.23,
        lng: 121.47,
        speed: 5.7,
        capacity: 1,
        distanceToWaitStn: 90,
      }),
    ).toEqual({
      busId: "B1",
      order: 2,
      lat: 31.23,
      lng: 121.47,
      speed: 5.7,
      capacity: 1,
      distanceToWaitStn: 90,
    });
  });

  test("omits distanceToWaitStn when negative or undefined", () => {
    expect(leanBusLine({ busId: "B1" })).not.toHaveProperty("distanceToWaitStn");
    expect(leanBusLine({ busId: "B1", distanceToWaitStn: -1 })).not.toHaveProperty(
      "distanceToWaitStn",
    );
  });
});

// ---------- reshape ----------

describe("reshapeLineDetail", () => {
  test("maps line, stations, buses, reverse direction", () => {
    const out = reshapeLineDetail({
      line: {
        lineId: "L1",
        name: "71",
        lineNo: "r1",
        direction: 0,
        startSn: "A",
        endSn: "B",
        firstTime: "05:30",
        lastTime: "23:00",
        price: "2元",
        stationsNum: 24,
      },
      stations: [
        {
          order: 1,
          sId: "S1",
          sn: "申昆路",
          wgsLat: 31.23,
          wgsLng: 121.47,
          physicalStId: "phys-1",
          namesakeStId: "name-1",
          metros: [{ fullName: "地铁14号线", lineNo: "14号线", color: "97,96,32" }],
        },
      ],
      buses: [
        {
          busId: "B1",
          order: 2,
          lat: 31.23,
          lng: 121.47,
          speed: 5.7,
          capacity: 0,
          distanceToWaitStn: 90,
        },
      ],
      otherlines: [
        {
          lineId: "L1R",
          startSn: "B",
          endSn: "A",
          firstTime: "04:30",
          lastTime: "22:30",
          price: "2元",
        },
      ],
      depDesc: "Frequent",
      preArrivalTime: "5min",
      targetOrder: 12,
    });

    expect(out.line.lineId).toBe("L1");
    expect(out.stations).toHaveLength(1);
    expect(out.stations[0].physicalStId).toBe("phys-1");
    expect(out.stations[0].namesakeStId).toBe("name-1");
    expect(out.stations[0].metros[0]).toEqual({
      name: "地铁14号线",
      lineNo: "14号线",
      color: "97,96,32",
    });
    expect(out.buses[0].distanceToWaitStn).toBe(90);
    expect(out.reverseDirection).toEqual({
      lineId: "L1R",
      startSn: "B",
      endSn: "A",
      firstTime: "04:30",
      lastTime: "22:30",
      price: "2元",
    });
    expect(out.depDesc).toBe("Frequent");
    expect(out.preArrivalTime).toBe("5min");
    expect(out.targetOrder).toBe(12);
  });

  test("reverseDirection is null when otherlines is empty", () => {
    expect(reshapeLineDetail({}).reverseDirection).toBeNull();
  });

  test("omits physicalStId/namesakeStId when upstream did not provide them", () => {
    const out = reshapeLineDetail({
      line: { lineId: "L1", name: "71" },
      stations: [{ order: 1, sId: "S1", sn: "A" }],
    });
    expect(out.stations[0]).not.toHaveProperty("physicalStId");
    expect(out.stations[0]).not.toHaveProperty("namesakeStId");
  });

  test("flags empty upstream payload (e.g. subway lineId) with a hint", () => {
    const out = reshapeLineDetail({
      line: { lineId: "", name: "", direction: 0, startSn: "", endSn: "" },
      stations: [],
      buses: [],
    });
    expect(out.empty).toBe(true);
    expect(out.hint).toMatch(/subway/i);
    // Hint must point at the tools that actually carry metro schedule data —
    // nearby_stops.subwayLines, not stop_detail.metros (which is just labels).
    expect(out.hint).toMatch(/bus_get_nearby_stops/);
    expect(out.hint).toMatch(/subwayLines/);
    expect(out.hint).toMatch(/bus_plan_transit/);
  });

  test("does NOT flag empty when stations or buses are populated", () => {
    const out = reshapeLineDetail({
      line: { lineId: "L1", name: "71" },
      stations: [{ order: 1, sId: "S1", sn: "A" }],
    });
    expect(out.empty).toBeUndefined();
    expect(out.hint).toBeUndefined();
  });
});

describe("reshapeLineRealtime", () => {
  test("attaches eta only to buses with travels[0].travelTime>=0", () => {
    const out = reshapeLineRealtime({
      buses: [
        {
          busId: "B1",
          order: 2,
          licence: "沪D",
          travels: [{ travelTime: 60, arrivalTime: 123, recommTip: "10:14" }],
        },
        { busId: "B2", order: 5 },
        { busId: "B3", order: 8, travels: [{ travelTime: -1 }] },
      ],
      line: {
        lineId: "L1",
        name: "71",
        direction: 0,
        startSn: "A",
        endSn: "B",
      },
      targetOrder: 12,
      realData: true,
    });

    expect(out.buses).toHaveLength(3);
    expect(out.buses[0].eta).toEqual({
      travelTime: 60,
      arrivalTime: 123,
      displayTime: "10:14",
    });
    expect(out.buses[1].eta).toBeNull();
    expect(out.buses[2].eta).toBeNull();
    expect(out.targetOrder).toBe(12);
    expect(out.realData).toBe(true);
    expect(out.note).toMatch(/nearest bus/i);
  });

  test("realData defaults to false when missing", () => {
    expect(reshapeLineRealtime({}).realData).toBe(false);
    expect(reshapeLineRealtime({}).targetOrder).toBe(0);
  });

  test("does NOT surface a startSn key — upstream does not return it here", () => {
    const out = reshapeLineRealtime({
      line: { lineId: "L1", name: "71", direction: 0, endSn: "B" },
    });
    expect(out.line).not.toHaveProperty("startSn");
    expect(out.line.endSn).toBe("B");
  });
});

describe("reshapeLineBuses", () => {
  test("maps nextStop + licence + eta", () => {
    const out = reshapeLineBuses({
      targetOrder: 3,
      buses: [
        {
          busId: "B1",
          order: 1,
          speed: 30,
          licence: "沪D",
          nextStationName: "次站",
          travels: [{ travelTime: 120, recommTip: "10:14" }],
        },
      ],
    });
    expect(out.targetOrder).toBe(3);
    expect(out.buses[0].nextStop).toBe("次站");
    expect(out.buses[0].licence).toBe("沪D");
    expect(out.buses[0].eta).toMatchObject({
      travelTime: 120,
      displayTime: "10:14",
    });
  });
});

describe("reshapeLineRoute", () => {
  const raw = {
    route: [
      { lat: 1, lng: 1, stopOrder: 1 },
      { lat: 1, lng: 1 },
      { lat: 1, lng: 1, stopOrder: 2 },
      { lat: 1, lng: 1 },
    ],
  };

  test("returns totals regardless of mode", () => {
    expect(reshapeLineRoute(raw, false).pointCount).toBe(4);
    expect(reshapeLineRoute(raw, false).stopCount).toBe(2);
    expect(reshapeLineRoute(raw, true).pointCount).toBe(4);
    expect(reshapeLineRoute(raw, true).stopCount).toBe(2);
  });

  test("includeShape=false yields only stop markers", () => {
    const out = reshapeLineRoute(raw, false);
    expect(out.points).toHaveLength(2);
    expect(out.points.every((p) => p.stopOrder != null)).toBe(true);
  });

  test("includeShape=true yields the full polyline", () => {
    const out = reshapeLineRoute(raw, true);
    expect(out.points).toHaveLength(4);
  });

  test("handles missing route", () => {
    expect(reshapeLineRoute({}, true).points).toEqual([]);
  });
});

describe("reshapeTimetable", () => {
  test("type=1 → mode=scheduled, no note", () => {
    const out = reshapeTimetable({
      line: { lineId: "L1", name: "71", direction: 0 },
      timeTableType: 1,
      timetable: [{ x: 1 }],
    });
    expect(out.mode).toBe("scheduled");
    expect(out.timetable).toEqual([{ x: 1 }]);
    expect(out.note).toBeUndefined();
  });

  test("type=2 → mode=interval with interval note", () => {
    const out = reshapeTimetable({ timeTableType: 2 });
    expect(out.mode).toBe("interval");
    expect(out.note).toMatch(/fixed interval/);
    expect(out.timetable).toBeNull();
  });

  test("type=3 → mode=special with fallback note", () => {
    const out = reshapeTimetable({ timeTableType: 3 });
    expect(out.mode).toBe("special");
    expect(out.note).toMatch(/not recognised/);
  });

  test("missing type → unknown", () => {
    expect(reshapeTimetable({}).mode).toBe("unknown");
  });
});

describe("reshapeRefresh", () => {
  test("maps lines and bus etas; falls back distanceToTgt → distanceToDest", () => {
    const out = reshapeRefresh({
      lines: [
        {
          line: { lineId: "L1", name: "71", direction: 0, endSn: "外滩" },
          depDesc: "ok",
          buses: [
            { busId: "B1", order: 2, capacity: 0, distanceToTgt: 881, travelTime: 220, arrivalTime: 999 },
            { busId: "B2", order: 3, capacity: 1, distanceToDest: 1500, travelTime: -1 },
          ],
        },
      ],
    });

    expect(out.lines).toHaveLength(1);
    expect(out.lines[0].buses).toHaveLength(2);
    expect(out.lines[0].buses[0]).toEqual({
      busId: "B1",
      order: 2,
      capacity: 0,
      distanceToDest: 881,
      eta: { travelTime: 220, arrivalTime: 999 },
    });
    expect(out.lines[0].buses[1].eta).toBeNull();
    expect(out.lines[0].buses[1].distanceToDest).toBe(1500);
  });

  test("missing lines → empty list", () => {
    expect(reshapeRefresh({}).lines).toEqual([]);
  });
});

// ---------- renderers ----------

describe("renderLineDetail", () => {
  test("renders header, stations with metro, buses, reverse direction", () => {
    const out = renderLineDetail({
      line: {
        lineId: "L1",
        name: "71",
        lineNo: "r1",
        direction: 0,
        startSn: "A",
        endSn: "B",
        firstTime: "05:30",
        lastTime: "23:00",
        price: "2元",
        stationsNum: 24,
      },
      stations: [
        {
          order: 1,
          sId: "S1",
          sn: "申昆路",
          wgsLat: 31.23,
          wgsLng: 121.47,
          metros: [{ name: "14号线", lineNo: "14号线" }],
        },
      ],
      buses: [
        {
          busId: "B1",
          order: 2,
          lat: 31.23,
          lng: 121.47,
          speed: 6,
          capacity: 0,
        },
      ],
      reverseDirection: {
        lineId: "L1R",
        startSn: "B",
        endSn: "A",
      },
      depDesc: "Frequent",
      preArrivalTime: "5min",
      targetOrder: 12,
    });

    expect(out).toContain("# Line 71 (L1)");
    expect(out).toContain("- A → B | direction=0");
    expect(out).toContain("first 05:30 / last 23:00 | 2元 | 24 stops");
    expect(out).toContain("- Next at start: 5min");
    expect(out).toContain("- Frequent");
    expect(out).toContain("- Reverse: lineId=L1R B→A");
    expect(out).toContain("## Stations");
    expect(out).toContain("  1. 申昆路 (S1) [14号线]");
    expect(out).toContain("## Live buses (1)");
    expect(out).toContain("- B1 order=2 (31.23,121.47) speed=6 capacity=0");
  });

  test("omits sections when empty", () => {
    const out = renderLineDetail({
      line: leanLine({}),
      stations: [],
      buses: [],
      reverseDirection: null,
    });
    expect(out).toContain("# Line  ()");
    expect(out).not.toContain("## Stations");
    expect(out).not.toContain("## Live buses");
    expect(out).not.toContain("Reverse:");
  });

  test("renders the empty marker and hint when detail is flagged empty", () => {
    const out = renderLineDetail({
      line: leanLine({}),
      stations: [],
      buses: [],
      reverseDirection: null,
      empty: true,
      hint: "subway lineId — call bus_get_stop_detail instead",
    });
    expect(out).toContain("# Line detail: empty");
    expect(out).toContain("subway lineId");
  });
});

describe("renderLineRealtime", () => {
  test("renders the header, per-bus line, and trailing note", () => {
    const out = renderLineRealtime({
      line: {
        lineId: "L1",
        name: "71",
        direction: 0,
        endSn: "B",
      },
      targetOrder: 12,
      realData: true,
      buses: [
        {
          busId: "B1",
          order: 2,
          licence: "沪D",
          lat: 31.23,
          lng: 121.47,
          speed: 6,
          capacity: 0,
          distanceToWaitStn: 90,
          eta: { travelTime: 60, arrivalTime: 0, displayTime: "10:14" },
        },
        {
          busId: "B2",
          order: 5,
          lat: 0,
          lng: 0,
          speed: 0,
          capacity: 1,
          eta: null,
        },
      ],
      note: "noted",
    });
    expect(out).toContain("# Realtime 71 → B (targetOrder=12)");
    expect(out).toContain("- realData=true | buses=2");
    expect(out).toContain(
      "- 沪D order=2 speed=6km/h cap=0, 90m away | ETA 1min (10:14)",
    );
    expect(out).toContain("- B2 order=5 speed=0km/h cap=1 | ETA —");
    expect(out).toContain("_Note: noted_");
  });

  test("empty marker when no buses", () => {
    const out = renderLineRealtime({
      line: {
        lineId: "L1",
        name: "71",
        direction: 0,
        endSn: "",
      },
      targetOrder: 0,
      realData: false,
      buses: [],
      note: "n",
    });
    expect(out).toContain("_No buses currently running._");
  });
});

describe("renderLineBuses", () => {
  test("empty marker", () => {
    expect(renderLineBuses({ targetOrder: 1, buses: [] })).toContain(
      "_No buses on this line right now._",
    );
  });

  test("renders each bus with nextStop + eta", () => {
    const out = renderLineBuses({
      targetOrder: 3,
      buses: [
        {
          busId: "B1",
          licence: "沪D",
          order: 1,
          lat: 0,
          lng: 0,
          speed: 30,
          capacity: 0,
          nextStop: "次站",
          eta: { travelTime: 120, arrivalTime: 0, displayTime: "10:14" },
        },
      ],
    });
    expect(out).toContain("# Buses (targetOrder=3)");
    expect(out).toContain(
      "- 沪D order=1 speed=30 cap=0 → 次站 | ETA 2min (10:14)",
    );
  });
});

describe("renderLineRoute", () => {
  test("summarises counts (markdown is intentionally lean)", () => {
    expect(renderLineRoute({ pointCount: 4, stopCount: 2, points: [] })).toBe(
      "# Line route: 4 points (2 stop markers). Request response_format=json to read the actual coordinates.",
    );
  });
});

describe("renderTimetable", () => {
  test("renders mode + interval note", () => {
    const out = renderTimetable({
      line: {
        lineId: "L1",
        name: "71",
        direction: 0,
        startSn: "",
        endSn: "",
      },
      timeTableType: 2,
      mode: "interval",
      timetable: null,
      note: "noted",
    });
    expect(out).toContain("# Timetable for 71 (L1)");
    expect(out).toContain("- direction: 0");
    expect(out).toContain("- mode: interval (timeTableType=2)");
    expect(out).toContain("- noted");
  });

  test("mentions schedule entries when scheduled", () => {
    const out = renderTimetable({
      line: { lineId: "", name: "", direction: 0, startSn: "", endSn: "" },
      timeTableType: 1,
      mode: "scheduled",
      timetable: [{}, {}, {}],
    });
    expect(out).toContain("- 3 schedule entries");
  });

  test("singular 'entry' for length 1", () => {
    const out = renderTimetable({
      line: { lineId: "", name: "", direction: 0, startSn: "", endSn: "" },
      timeTableType: 1,
      mode: "scheduled",
      timetable: [{}],
    });
    expect(out).toContain("- 1 schedule entry");
  });
});

describe("renderRefresh", () => {
  test("renders lines + nested buses", () => {
    const out = renderRefresh({
      lines: [
        {
          line: { lineId: "L1", name: "71", direction: 0, endSn: "外滩" },
          depDesc: "ok",
          buses: [
            {
              busId: "B1",
              order: 2,
              capacity: 0,
              eta: { travelTime: 60, arrivalTime: -1 },
            },
          ],
        },
      ],
    });
    expect(out).toContain("# Refresh (1 lines)");
    expect(out).toContain("- 71 (L1) → 外滩: 1 bus(es), ok");
    expect(out).toContain("  - B1 order=2 cap=0 ETA 1min");
  });

  test("empty marker blames upstream, suggests retry, then quadruple check", () => {
    const out = renderRefresh({ lines: [] });
    expect(out).toMatch(/transient|retry/i);
    expect(out).toMatch(/quadruple|lineId,stopId/);
  });
});

// ---------- input schemas ----------

describe("Input schemas", () => {
  test("LineDetailInput requires city_id+line_id; lat/lng optional", () => {
    expect(() => LineDetailInput.parse({})).toThrow();
    expect(() => LineDetailInput.parse({ city_id: "034" })).toThrow();
    const parsed = LineDetailInput.parse({ city_id: "034", line_id: "L1" });
    expect(parsed.lat).toBeUndefined();
  });

  test("LineRouteInput include_shape defaults to false and is strict", () => {
    const parsed = LineRouteInput.parse({ city_id: "034", line_id: "L1" });
    expect(parsed.include_shape).toBe(false);
    expect(
      LineRouteInput.parse({
        city_id: "034",
        line_id: "L1",
        include_shape: true,
      }).include_shape,
    ).toBe(true);
    expect(() =>
      LineRouteInput.parse({ city_id: "034", line_id: "L1", extra: 1 }),
    ).toThrow();
  });

  test("LineRealtimeInput target_order must be digits", () => {
    expect(() =>
      LineRealtimeInput.parse({
        city_id: "034",
        line_id: "L1",
        target_order: "abc",
        station_id: "S1",
        lat: "1",
        lng: "1",
      }),
    ).toThrow();
    expect(() =>
      LineRealtimeInput.parse({
        city_id: "034",
        line_id: "L1",
        target_order: "2",
        station_id: "S1",
        lat: "1",
        lng: "1",
      }),
    ).not.toThrow();
  });

  test("LineBusListInput requires station_name", () => {
    expect(() =>
      LineBusListInput.parse({
        city_id: "034",
        line_id: "L1",
        target_order: "2",
      }),
    ).toThrow();
  });

  test("TimetableInput direction is '0' | '1'", () => {
    expect(() =>
      TimetableInput.parse({
        city_id: "034",
        line_id: "L1",
        line_no: "71",
        direction: "2",
      }),
    ).toThrow();
    expect(() =>
      TimetableInput.parse({
        city_id: "034",
        line_id: "L1",
        line_no: "71",
        direction: "1",
      }),
    ).not.toThrow();
  });

  test("RefreshInput requires line_stn", () => {
    expect(() => RefreshInput.parse({ city_id: "034" })).toThrow();
    expect(() =>
      RefreshInput.parse({ city_id: "034", line_stn: "L1,S1,,2" }),
    ).not.toThrow();
  });
});
