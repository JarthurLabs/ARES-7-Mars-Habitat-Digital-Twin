import { describe, expect, it } from "vitest";
import { negotiateOverrideFromSearch } from "./liveConfiguration";

describe("temporary live negotiate override", () => {
  it("accepts only the exact anonymous Azure Function route", () => {
    const endpoint = "https://func-ares7-demo.azurewebsites.net/api/viewer/negotiate";
    expect(negotiateOverrideFromSearch(`?negotiate=${encodeURIComponent(endpoint)}`)).toBe(endpoint);
  });

  it.each([
    "http://func-ares7-demo.azurewebsites.net/api/viewer/negotiate",
    "https://func-ares7-demo.azurewebsites.net.evil.example/api/viewer/negotiate",
    "https://func-ares7-demo.azurewebsites.net/api/other",
    "https://user:pass@func-ares7-demo.azurewebsites.net/api/viewer/negotiate",
    "https://func-ares7-demo.azurewebsites.net:444/api/viewer/negotiate",
    "https://func-ares7-demo.azurewebsites.net/api/viewer/negotiate?code=secret",
  ])("rejects unsafe override %s", (endpoint) => {
    expect(() => negotiateOverrideFromSearch(`?negotiate=${encodeURIComponent(endpoint)}`)).toThrow(
      /HTTPS azurewebsites\.net/,
    );
  });

  it("leaves the public default unconfigured", () => {
    expect(negotiateOverrideFromSearch("")).toBeUndefined();
    expect(negotiateOverrideFromSearch("?source=azure")).toBeUndefined();
  });
});
