import { describe, expect, test } from "bun:test";
import {
  SearchInput,
  SearchMoreInput,
  renderSearch,
  reshapeSearch,
} from "../../../src/tools/search.js";

describe("reshapeSearch", () => {
  test("maps lines, stations, POIs and highlightKey", () => {
    const lean = reshapeSearch({
      highlightKey: "71路",
      result: {
        lines: [
          {
            lineId: "L1",
            name: "71",
            lineNo: "r95817",
            direction: 0,
            startSn: "申昆路",
            endSn: "外滩",
            subwayV2: 0,
          },
          {
            lineId: "L1R",
            name: "71",
            lineNo: "r95817",
            direction: 1,
            startSn: "外滩",
            endSn: "申昆路",
            subwayV2: 0,
          },
          {
            lineId: "M2",
            name: "地铁2号线",
            lineNo: "s2",
            direction: 0,
            startSn: "徐泾东",
            endSn: "浦东国际机场",
            subwayV2: 1,
          },
        ],
        stations: [
          {
            sId: "021-15232",
            sn: "西藏中路",
            lat: 31.231006,
            lng: 121.474316,
            gpsType: "wgs",
            physicalStId: "phys",
            namesakeStId: "name",
            subwayV2: 0,
          },
        ],
        pois: [
          {
            sn1: "外滩",
            sn1Address: "黄浦区中山东一路",
            sn1Tag: "景点",
            adname: "黄浦区",
            lat: 31.24,
            lng: 121.49,
          },
        ],
      },
    });

    expect(lean.highlightKey).toBe("71路");
    // 71 (both directions) folds into one entry; 地铁2号线 is a second.
    expect(lean.lines).toHaveLength(2);
    expect(lean.lines[0]).toMatchObject({
      name: "71",
      lineNo: "r95817",
      isSubway: false,
      // Top-level compat fields mirror direction=0.
      lineId: "L1",
      direction: 0,
      startSn: "申昆路",
      endSn: "外滩",
    });
    expect(lean.lines[0].directions).toEqual([
      { direction: 0, lineId: "L1", startSn: "申昆路", endSn: "外滩" },
      { direction: 1, lineId: "L1R", startSn: "外滩", endSn: "申昆路" },
    ]);
    expect(lean.lines[0].hint).toBeUndefined();
    expect(lean.lines[1].isSubway).toBe(true);
    expect(lean.lines[1].hint).toMatch(/subway/i);
    expect(lean.lines[1].directions).toHaveLength(1);

    expect(lean.stations[0]).toMatchObject({
      sId: "021-15232",
      sn: "西藏中路",
      lat: 31.231006,
      lng: 121.474316,
      gpsType: "wgs",
      physicalStId: "phys",
      namesakeStId: "name",
      isSubway: false,
    });

    expect(lean.pois[0]).toEqual({
      name: "外滩",
      address: "黄浦区中山东一路",
      tag: "景点",
      district: "黄浦区",
      lat: 31.24,
      lng: 121.49,
      gpsType: "gcj",
    });
  });

  test("defaults missing fields", () => {
    const lean = reshapeSearch({});
    expect(lean.highlightKey).toBe("");
    expect(lean.lines).toEqual([]);
    expect(lean.stations).toEqual([]);
    expect(lean.pois).toEqual([]);
  });

  test("folds both directions of the same line under one entry", () => {
    const lean = reshapeSearch({
      result: {
        lines: [
          { lineId: "D1", lineNo: "r1", name: "11", direction: 0, startSn: "A", endSn: "B" },
          { lineId: "D0", lineNo: "r1", name: "11", direction: 1, startSn: "B", endSn: "A" },
        ],
      },
    });
    expect(lean.lines).toHaveLength(1);
    const dirs = lean.lines[0].directions;
    expect(dirs.map((d) => d.direction).sort()).toEqual([0, 1]);
    // Top-level compat fields prefer direction=0.
    expect(lean.lines[0].lineId).toBe("D1");
    expect(lean.lines[0].direction).toBe(0);
  });

  test("subway lines carry a hint pointing at stop_detail / plan_transit", () => {
    const lean = reshapeSearch({
      result: {
        lines: [
          { lineId: "M2", lineNo: "s2", name: "地铁2号线", direction: 0, subwayV2: 1 },
        ],
      },
    });
    expect(lean.lines[0].isSubway).toBe(true);
    expect(lean.lines[0].hint).toBeDefined();
    expect(lean.lines[0].hint).toMatch(/stop_detail|plan_transit/);
  });

  test("station gpsType narrows to 'wgs' for non-'gcj' values", () => {
    const lean = reshapeSearch({
      result: { stations: [{ sId: "x", sn: "y", gpsType: "weird" }] },
    });
    expect(lean.stations[0].gpsType).toBe("wgs");
  });
});

describe("renderSearch", () => {
  test("renders lines/stations/pois with proper annotations", () => {
    const out = renderSearch({
      highlightKey: "71路",
      lines: [
        {
          name: "71",
          lineNo: "r1",
          isSubway: false,
          directions: [
            { direction: 0, lineId: "L1", startSn: "A", endSn: "B" },
            { direction: 1, lineId: "L1R", startSn: "B", endSn: "A" },
          ],
          lineId: "L1",
          direction: 0,
          startSn: "A",
          endSn: "B",
        },
        {
          name: "地铁2号线",
          lineNo: "s2",
          isSubway: true,
          directions: [
            { direction: 0, lineId: "M2", startSn: "C", endSn: "D" },
          ],
          lineId: "M2",
          direction: 0,
          startSn: "C",
          endSn: "D",
          hint: "Subway lines are not supported by bus_get_line_detail.",
        },
      ],
      stations: [
        {
          sId: "S1",
          sn: "西藏中路",
          lat: 31.23,
          lng: 121.47,
          gpsType: "wgs",
          physicalStId: "phys-1",
          namesakeStId: "name-1",
          isSubway: false,
        },
      ],
      pois: [
        {
          name: "外滩",
          address: "黄浦区中山东一路",
          tag: "景点",
          district: "黄浦区",
          lat: 31.24,
          lng: 121.49,
          gpsType: "gcj",
        },
      ],
    });

    expect(out).toContain("# Search results (highlight: 71路)");
    expect(out).toContain("- 71");
    expect(out).toContain("↳ direction=0 lineId=L1 — A → B");
    expect(out).toContain("↳ direction=1 lineId=L1R — B → A");
    expect(out).toContain("- 地铁2号线 [metro]");
    expect(out).toContain("↳ direction=0 lineId=M2 — C → D");
    expect(out).toContain("⚠ Subway lines are not supported");
    expect(out).toContain("- 西藏中路 (sId=S1) @ 31.23,121.47 [wgs]");
    expect(out).toContain(
      "physicalStId=phys-1, namesakeStId=name-1 → bus_get_stop_detail",
    );
    expect(out).toContain("- 外滩 — 黄浦区中山东一路 @ 31.24,121.49 [景点]");
  });

  test("falls back to district when address is empty", () => {
    const out = renderSearch({
      highlightKey: "",
      lines: [],
      stations: [],
      pois: [
        {
          name: "X",
          address: "",
          tag: "",
          district: "黄浦区",
          lat: 1,
          lng: 2,
          gpsType: "gcj",
        },
      ],
    });
    expect(out).toContain("- X — 黄浦区 @ 1,2");
  });

  test("renders '_No matches._' when everything is empty", () => {
    const out = renderSearch({
      highlightKey: "",
      lines: [],
      stations: [],
      pois: [],
    });
    expect(out).toContain("# Search results (highlight: -)");
    expect(out).toContain("_No matches._");
  });
});

describe("SearchInput", () => {
  test("requires city_id and keyword", () => {
    expect(() => SearchInput.parse({})).toThrow();
    expect(() => SearchInput.parse({ city_id: "034" })).toThrow();
    expect(() => SearchInput.parse({ keyword: "71" })).toThrow();
  });

  test("accepts a minimal valid input", () => {
    const parsed = SearchInput.parse({ city_id: "034", keyword: "71路" });
    expect(parsed.response_format as string).toBe("markdown");
  });

  test("strict: rejects extra keys", () => {
    expect(() =>
      SearchInput.parse({ city_id: "034", keyword: "71", extra: 1 }),
    ).toThrow();
  });
});

describe("SearchMoreInput", () => {
  test("type defaults to '1'", () => {
    expect(
      SearchMoreInput.parse({ city_id: "034", keyword: "71" }).type,
    ).toBe("1");
  });

  test("type accepts '1' | '2' | '3'", () => {
    for (const t of ["1", "2", "3"] as const) {
      expect(
        SearchMoreInput.parse({ city_id: "034", keyword: "k", type: t }).type,
      ).toBe(t);
    }
  });

  test("rejects other type values", () => {
    expect(() =>
      SearchMoreInput.parse({ city_id: "034", keyword: "k", type: "4" }),
    ).toThrow();
  });
});
