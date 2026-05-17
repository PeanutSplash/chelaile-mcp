import { describe, expect, test } from "bun:test";
import {
  TransitInput,
  fmtHHMM,
  renderPlan,
  reshape,
} from "../../../src/tools/transit.js";
import type { RawTransitResponse } from "../../../src/types.js";

describe("fmtHHMM", () => {
  test("formats 4-digit HHMM to HH:MM", () => {
    expect(fmtHHMM("0530")).toBe("05:30");
    expect(fmtHHMM("2330")).toBe("23:30");
  });

  test("returns empty string for missing or short inputs", () => {
    expect(fmtHHMM(undefined)).toBe("");
    expect(fmtHHMM("")).toBe("");
    expect(fmtHHMM("123")).toBe("");
  });
});

describe("reshape", () => {
  test("flattens raw upstream into TransitPlanResult", () => {
    const raw: RawTransitResponse = {
      route: {
        distance: "17982",
        origin: "121.47,31.23",
        destination: "121.32,31.20",
        transits: [
          {
            duration: "3056",
            walking_distance: "1466",
            distance: "19086",
            cc: 1,
            tag: "直达",
            via_num_total: 8,
            segments: [
              {
                walking: { distance: "837", duration: "717" },
                bus: {
                  buslines: [
                    {
                      name: "地铁2号线",
                      lineType: 1,
                      color: "ff0000",
                      duration: "1800",
                      distance: "17620",
                      via_num: "8",
                      station_start_time: "0530",
                      station_end_time: "2330",
                      departure_stop: { name: "人民广场" },
                      arrival_stop: { name: "虹桥2号航站楼" },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    };

    const out = reshape(raw);
    expect(out.origin).toBe("121.47,31.23");
    expect(out.destination).toBe("121.32,31.20");
    expect(out.distance).toBe(17982);
    expect(out.plans).toHaveLength(1);

    const plan = out.plans[0];
    expect(plan.duration).toBe(3056);
    expect(plan.walkingDistance).toBe(1466);
    expect(plan.transitCount).toBe(1);
    expect(plan.tag).toBe("直达");
    expect(plan.segments).toHaveLength(2);

    expect(plan.segments[0]).toEqual({
      type: "walking",
      distance: 837,
      duration: 717,
    });

    const busSeg = plan.segments[1];
    expect(busSeg.type).toBe("bus");
    if (busSeg.type === "bus") {
      expect(busSeg.name).toBe("地铁2号线");
      expect(busSeg.lineType).toBe(1);
      expect(busSeg.color).toBe("ff0000");
      expect(busSeg.departureStop).toBe("人民广场");
      expect(busSeg.arrivalStop).toBe("虹桥2号航站楼");
      expect(busSeg.viaStops).toBe(8);
      expect(busSeg.startTime).toBe("05:30");
      expect(busSeg.endTime).toBe("23:30");
    }
  });

  test("drops walking segments with zero distance", () => {
    const out = reshape({
      route: {
        transits: [
          {
            segments: [
              {
                walking: { distance: "0", duration: "0" },
                bus: { buslines: [{ name: "1", departure_stop: { name: "A" }, arrival_stop: { name: "B" } }] },
              },
            ],
          },
        ],
      },
    });
    expect(out.plans[0].segments).toHaveLength(1);
    expect(out.plans[0].segments[0].type).toBe("bus");
  });

  test("handles an empty upstream gracefully", () => {
    const out = reshape({});
    expect(out.origin).toBe("");
    expect(out.destination).toBe("");
    expect(out.distance).toBe(0);
    expect(out.plans).toEqual([]);
    expect(out.note).toBeUndefined();
  });

  test("emits a strategy=3 warning when no metro segments and plans exist", () => {
    const out = reshape(
      {
        route: {
          transits: [
            {
              duration: "7000",
              segments: [
                {
                  bus: {
                    buslines: [
                      {
                        name: "71路",
                        lineType: 0,
                        departure_stop: { name: "A" },
                        arrival_stop: { name: "B" },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      },
      "3",
    );
    expect(out.note).toBeDefined();
    expect(out.note).toMatch(/strategy=0|metro/i);
  });

  test("no warning when strategy=3 already contains a metro segment", () => {
    const out = reshape(
      {
        route: {
          transits: [
            {
              segments: [
                {
                  bus: {
                    buslines: [
                      {
                        name: "地铁2号线",
                        lineType: 1,
                        departure_stop: { name: "A" },
                        arrival_stop: { name: "B" },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      },
      "3",
    );
    expect(out.note).toBeUndefined();
  });

  test("no warning under strategy=0 even when result is bus-only", () => {
    const out = reshape(
      {
        route: {
          transits: [
            {
              segments: [
                {
                  bus: {
                    buslines: [
                      {
                        name: "71路",
                        lineType: 0,
                        departure_stop: { name: "A" },
                        arrival_stop: { name: "B" },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      },
      "0",
    );
    expect(out.note).toBeUndefined();
  });

  test("only uses the first busline of each segment", () => {
    const out = reshape({
      route: {
        transits: [
          {
            segments: [
              {
                bus: {
                  buslines: [
                    { name: "first", departure_stop: { name: "A" }, arrival_stop: { name: "B" } },
                    { name: "second", departure_stop: { name: "C" }, arrival_stop: { name: "D" } },
                  ],
                },
              },
            ],
          },
        ],
      },
    });
    const seg = out.plans[0].segments[0];
    expect(seg.type).toBe("bus");
    if (seg.type === "bus") expect(seg.name).toBe("first");
  });
});

describe("renderPlan", () => {
  test("returns empty marker when no plans", () => {
    expect(
      renderPlan({ origin: "", destination: "", distance: 0, plans: [] }),
    ).toContain("_No plans found._");
  });

  test("renders walking + bus + metro line type annotation", () => {
    const out = renderPlan({
      origin: "A",
      destination: "B",
      distance: 1000,
      plans: [
        {
          duration: 1800,
          walkingDistance: 500,
          distance: 1100,
          tag: "推荐",
          transitCount: 1,
          segments: [
            { type: "walking", distance: 500, duration: 360 },
            {
              type: "bus",
              name: "地铁2号线",
              lineType: 1,
              departureStop: "X",
              arrivalStop: "Y",
              viaStops: 5,
              duration: 1200,
              distance: 800,
              startTime: "05:30",
              endTime: "23:30",
            },
          ],
        },
      ],
    });
    expect(out).toContain("# Transit plans (1)");
    expect(out).toContain("Origin: A");
    expect(out).toContain("Destination: B");
    expect(out).toContain("Straight-line distance: 1000 m");
    expect(out).toContain("## Plan 1 — 推荐");
    expect(out).toContain("duration: 30 min, walk 500 m, total 1100 m, transfers: 1");
    expect(out).toContain("- walk 500 m (6 min)");
    expect(out).toContain("地铁2号线 (metro): X → Y (5 stops between), runs 05:30-23:30");
  });

  test("renders a non-metro bus without the metro annotation", () => {
    const out = renderPlan({
      origin: "",
      destination: "",
      distance: 0,
      plans: [
        {
          duration: 600,
          walkingDistance: 0,
          distance: 0,
          tag: "",
          transitCount: 0,
          segments: [
            {
              type: "bus",
              name: "71",
              lineType: 0,
              departureStop: "X",
              arrivalStop: "Y",
              viaStops: 2,
              duration: 600,
              distance: 0,
              startTime: "",
              endTime: "",
            },
          ],
        },
      ],
    });
    expect(out).toContain("71: X → Y (2 stops between)");
    expect(out).not.toContain("(metro)");
    expect(out).not.toContain("runs ");
  });

  test("shows 'direct' for legs with explicit 0 intermediate stops", () => {
    const out = renderPlan({
      origin: "",
      destination: "",
      distance: 0,
      plans: [
        {
          duration: 0,
          walkingDistance: 0,
          distance: 0,
          tag: "",
          transitCount: 0,
          segments: [
            {
              type: "bus",
              name: "磁浮线",
              lineType: 1,
              departureStop: "龙阳路",
              arrivalStop: "浦东1号2号航站楼",
              viaStops: 0,
              duration: 0,
              distance: 0,
              startTime: "",
              endTime: "",
            },
          ],
        },
      ],
    });
    expect(out).toContain("磁浮线 (metro): 龙阳路 → 浦东1号2号航站楼 (direct)");
    expect(out).not.toContain("(0 stops");
  });

  test("renders the warning note when present", () => {
    const out = renderPlan({
      origin: "A",
      destination: "B",
      distance: 100,
      plans: [
        {
          duration: 600,
          walkingDistance: 0,
          distance: 0,
          tag: "",
          transitCount: 0,
          segments: [
            {
              type: "bus",
              name: "71",
              lineType: 0,
              departureStop: "X",
              arrivalStop: "Y",
              duration: 600,
              distance: 0,
              startTime: "",
              endTime: "",
            },
          ],
        },
      ],
      note: "retry with strategy=0",
    });
    expect(out).toContain("⚠ retry with strategy=0");
  });

  test("omits the stops hint when viaStops is missing", () => {
    const out = renderPlan({
      origin: "",
      destination: "",
      distance: 0,
      plans: [
        {
          duration: 0,
          walkingDistance: 0,
          distance: 0,
          tag: "",
          transitCount: 0,
          segments: [
            {
              type: "bus",
              name: "451路",
              lineType: 0,
              departureStop: "人民广场",
              arrivalStop: "南京西路",
              duration: 0,
              distance: 0,
              startTime: "",
              endTime: "",
            },
          ],
        },
      ],
    });
    expect(out).toContain("451路: 人民广场 → 南京西路");
    expect(out).not.toContain("0 stops");
    expect(out).not.toContain("direct");
    expect(out).not.toContain("between");
  });
});

describe("TransitInput", () => {
  const valid = {
    city_id: "034",
    origin_name: "A",
    origin_lat: "31.23",
    origin_lng: "121.47",
    dest_name: "B",
    dest_lat: "31.32",
    dest_lng: "121.20",
  };

  test("accepts the minimal valid input", () => {
    const parsed = TransitInput.parse(valid);
    expect(parsed.strategy).toBe("0");
  });

  test("strategy accepts '0' | '1' | '2' | '3'", () => {
    for (const s of ["0", "1", "2", "3"]) {
      expect(() => TransitInput.parse({ ...valid, strategy: s })).not.toThrow();
    }
  });

  test("strategy rejects out-of-range values", () => {
    expect(() => TransitInput.parse({ ...valid, strategy: "4" })).toThrow();
  });

  test("requires all coordinates", () => {
    const { dest_lng, ...missing } = valid;
    expect(() => TransitInput.parse(missing)).toThrow();
  });

  test("rejects non-decimal coordinate strings", () => {
    expect(() =>
      TransitInput.parse({ ...valid, origin_lat: "north" }),
    ).toThrow();
  });
});
