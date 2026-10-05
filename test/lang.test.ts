import { describe, expect, it } from "vitest";
import { LANGS, pickLang } from "../src/lib/lang";

describe("pickLang", () => {
  it("defaults to en", () => {
    expect(pickLang()).toBe("en");
    expect(pickLang("")).toBe("en");
    expect(pickLang("*")).toBe("en");
    expect(pickLang("klingon, xx-YY")).toBe("en");
  });

  it("returns the primary subtag", () => {
    expect(pickLang("pt-BR")).toBe("pt");
    expect(pickLang("ZH-Hant-TW")).toBe("zh");
  });

  it("honours q-weights over header order", () => {
    expect(pickLang("de;q=0.5,fr;q=0.9")).toBe("fr");
    expect(pickLang("en-GB;q=0.2, es;q=0.8")).toBe("es");
  });

  it("keeps header order when weights tie, and skips q=0", () => {
    expect(pickLang("ja,ko")).toBe("ja");
    expect(pickLang("ja;q=0, ko")).toBe("ko");
  });

  it("skips unsupported languages before falling back", () => {
    expect(pickLang("sw;q=1.0, ar;q=0.4")).toBe("ar");
  });

  it("only offers primary tags", () => {
    expect(LANGS.every((l) => /^[a-z]{2}$/.test(l))).toBe(true);
    expect(LANGS).toContain("en");
  });
});
