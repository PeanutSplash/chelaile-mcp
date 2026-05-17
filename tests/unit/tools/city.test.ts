import { describe, expect, test } from "bun:test";
import {
  CityConfigInput,
  CityListInput,
  renderCityConfig,
  renderCityList,
  reshapeCityList,
} from "../../../src/tools/city.js";
import type { CityListResponse } from "../../../src/types.js";

const sample: CityListResponse = {
  cityList: [
    { cityId: "034", cityName: "上海", pinyin: "ShangHai", isHot: 1, supportSubway: 1 },
    { cityId: "027", cityName: "北京", pinyin: "BeiJing", isHot: 1, supportSubway: 1 },
    { cityId: "100", cityName: "鄂尔多斯", pinyin: "EErDuoSi", isHot: 0, supportSubway: 0 },
  ],
};

describe("reshapeCityList", () => {
  test("hotOnly=true returns only hot cities", () => {
    const out = reshapeCityList(sample, true);
    expect(out.cities).toHaveLength(2);
    expect(out.cities.every((c) => c.hot)).toBe(true);
    expect(out.cities.map((c) => c.cityId)).toEqual(["034", "027"]);
  });

  test("hotOnly=false returns the full list", () => {
    const out = reshapeCityList(sample, false);
    expect(out.cities).toHaveLength(3);
    expect(out.cities.find((c) => c.cityId === "100")?.hot).toBe(false);
  });

  test("maps supportSubway/isHot to booleans", () => {
    const out = reshapeCityList(sample, false);
    expect(out.cities[0]).toEqual({
      cityId: "034",
      cityName: "上海",
      pinyin: "ShangHai",
      supportSubway: true,
      hot: true,
    });
    expect(out.cities[2].supportSubway).toBe(false);
    expect(out.cities[2].hot).toBe(false);
  });

  test("handles missing cityList", () => {
    expect(reshapeCityList({}, true).cities).toEqual([]);
  });
});

describe("renderCityList", () => {
  test("renders header + hot section + full section", () => {
    const out = renderCityList(reshapeCityList(sample, false));
    expect(out).toContain("# Supported Cities (3)");
    expect(out).toContain("## Hot cities");
    expect(out.indexOf("## Hot cities")).toBeLessThan(
      out.indexOf("## All cities"),
    );
    expect(out).toContain("- 上海 (034)");
    expect(out).toContain("- 鄂尔多斯 (100) [EErDuoSi]");

    const hotChunk = out.slice(
      out.indexOf("## Hot cities"),
      out.indexOf("## All cities"),
    );
    expect(hotChunk).toContain("上海 (034)");
    expect(hotChunk).toContain("北京 (027)");
    expect(hotChunk).not.toContain("鄂尔多斯");
  });

  test("omits the Hot section when there are no hot cities", () => {
    const out = renderCityList({
      cities: [
        {
          cityId: "100",
          cityName: "甲",
          supportSubway: false,
          hot: false,
        },
      ],
    });
    expect(out).not.toContain("## Hot cities");
    expect(out).toContain("## All cities");
  });
});

describe("renderCityConfig", () => {
  test("renders core operating fields", () => {
    const out = renderCityConfig("034", {
      maxInterval: 30,
      arrivingStationLimitSeconds: 180,
      busDisplayConfig: { lineDetail: "time#order", other: "time" },
    });
    expect(out).toContain("# City config (034)");
    expect(out).toContain("Refresh interval cap: 30 s");
    expect(out).toContain('"Arriving" threshold: 180 s');
    expect(out).toContain("Line-detail bus display fields: time#order");
    expect(out).toContain("Other-page bus display fields: time");
  });

  test("falls back to '?' for missing fields", () => {
    const out = renderCityConfig("034", {});
    expect(out).toContain("Refresh interval cap: ? s");
    expect(out).toContain("Line-detail bus display fields: ?");
  });
});

describe("CityListInput", () => {
  test("hot_only defaults to true", () => {
    expect(CityListInput.parse({}).hot_only).toBe(true);
  });

  test("accepts hot_only=false", () => {
    expect(CityListInput.parse({ hot_only: false }).hot_only).toBe(false);
  });

  test("response_format defaults to markdown", () => {
    expect(CityListInput.parse({}).response_format as string).toBe("markdown");
  });

  test("strict: refuses extra keys", () => {
    expect(() =>
      CityListInput.parse({ hot_only: true, extra: "x" }),
    ).toThrow();
  });
});

describe("CityConfigInput", () => {
  test("requires city_id", () => {
    expect(() => CityConfigInput.parse({})).toThrow();
  });

  test("rejects empty city_id", () => {
    expect(() => CityConfigInput.parse({ city_id: "" })).toThrow();
  });

  test("accepts valid input", () => {
    const parsed = CityConfigInput.parse({ city_id: "034" });
    expect(parsed.city_id).toBe("034");
    expect(parsed.response_format as string).toBe("markdown");
  });
});
