import { describe, expect, test } from "bun:test";
import {
  MyLocationInput,
  ReverseGeoInput,
  renderMyLocation,
  renderReverseGeo,
  reshapeReverseGeo,
} from "../../../src/tools/geo.js";

describe("reshapeReverseGeo", () => {
  test("maps the full address envelope", () => {
    const out = reshapeReverseGeo({
      regeocode: {
        formatted_address: "上海市黄浦区西藏中路某号",
        addressComponent: {
          province: "上海市",
          city: "上海市",
          district: "黄浦区",
          township: "南京东路街道",
          citycode: "021",
          adcode: "310101",
        },
      },
    });
    expect(out).toEqual({
      formatted: "上海市黄浦区西藏中路某号",
      province: "上海市",
      city: "上海市",
      district: "黄浦区",
      township: "南京东路街道",
      citycode: "021",
      adcode: "310101",
    });
  });

  test("falls back to province when city is the empty-array case", () => {
    const out = reshapeReverseGeo({
      regeocode: {
        addressComponent: {
          province: "上海市",
          city: [],
          district: "黄浦区",
        },
      },
    });
    expect(out.city).toBe("上海市");
  });

  test("returns empty strings for missing fields", () => {
    expect(reshapeReverseGeo({})).toEqual({
      formatted: "",
      province: "",
      city: "",
      district: "",
      township: "",
      citycode: "",
      adcode: "",
    });
  });
});

describe("renderReverseGeo", () => {
  test("renders all fields", () => {
    const out = renderReverseGeo({
      formatted: "上海市黄浦区西藏中路某号",
      province: "上海市",
      city: "上海市",
      district: "黄浦区",
      township: "南京东路街道",
      citycode: "021",
      adcode: "310101",
    });
    expect(out).toContain("# Reverse geocode");
    expect(out).toContain("Formatted: 上海市黄浦区西藏中路某号");
    expect(out).toContain("Province: 上海市");
    expect(out).toContain("City: 上海市");
    expect(out).toContain("District: 黄浦区");
    expect(out).toContain("Citycode: 021");
    expect(out).toContain("Adcode: 310101");
  });
});

describe("renderMyLocation", () => {
  test("renders coordinates, locale chain, IP+ISP and precision", () => {
    const out = renderMyLocation({
      lat: 31.2222,
      lng: 121.4581,
      gpsType: "wgs",
      city: "上海",
      region: "上海市",
      country: "中国",
      ip: "116.236.0.1",
      isp: "China Telecom",
      precision: "city-level",
    });
    expect(out).toContain("# IP-based location (coarse)");
    expect(out).toContain("- Coords (WGS-84): 31.2222, 121.4581");
    expect(out).toContain("- 中国 / 上海市 / 上海");
    expect(out).toContain("- Source IP: 116.236.0.1 (China Telecom)");
    expect(out).toContain("- Precision: city-level");
  });

  test("omits ISP suffix when isp is missing", () => {
    const out = renderMyLocation({
      lat: 0,
      lng: 0,
      gpsType: "wgs",
      city: "",
      region: "",
      country: "",
      ip: "1.2.3.4",
      precision: "?",
    });
    expect(out).toContain("- Source IP: 1.2.3.4\n");
    // No parenthesised ISP after the IP
    const ipLine = out.split("\n").find((l) => l.startsWith("- Source IP:"))!;
    expect(ipLine).toBe("- Source IP: 1.2.3.4");
  });
});

describe("MyLocationInput", () => {
  test("ip is optional; defaults schema parses {}", () => {
    const parsed = MyLocationInput.parse({});
    expect(parsed.ip).toBeUndefined();
    expect(parsed.response_format as string).toBe("markdown");
  });

  test("accepts an explicit ip", () => {
    expect(MyLocationInput.parse({ ip: "8.8.8.8" }).ip).toBe("8.8.8.8");
  });

  test("strict: rejects extra keys", () => {
    expect(() => MyLocationInput.parse({ ip: "8.8.8.8", extra: 1 })).toThrow();
  });
});

describe("ReverseGeoInput", () => {
  test("accepts well-formed decimals", () => {
    const parsed = ReverseGeoInput.parse({ lat: "31.23", lng: "121.47" });
    expect(parsed.lat).toBe("31.23");
    expect(parsed.lng).toBe("121.47");
  });

  test("accepts negatives", () => {
    expect(() =>
      ReverseGeoInput.parse({ lat: "-31.23", lng: "-121.47" }),
    ).not.toThrow();
  });

  test("rejects non-decimal strings", () => {
    expect(() => ReverseGeoInput.parse({ lat: "abc", lng: "1" })).toThrow();
    expect(() => ReverseGeoInput.parse({ lat: "1", lng: "" })).toThrow();
  });

  test("requires both lat and lng", () => {
    expect(() => ReverseGeoInput.parse({ lat: "1" })).toThrow();
  });
});
