import { describe, expect, test } from "bun:test";
import {
  latestPublishedMonth,
  parsePeriod,
  periodHref,
  periodLabel,
  previousMonthOf,
  recentMonths,
  shortPeriodLabel,
} from "../src/lib/period";

describe("latestPublishedMonth", () => {
  test("JSTの前月を返す (月跨ぎ・年跨ぎ含む)", () => {
    // 2026-01-01 00:00 UTC = JST 2026-01-01 09:00 → 公開月は 2025-12
    expect(latestPublishedMonth(new Date(Date.UTC(2026, 0, 1)))).toEqual({
      year: 2025,
      month: 12,
    });
    // 2026-03-15 00:00 UTC = JST 2026-03-15 09:00 → 公開月は 2026-02
    expect(latestPublishedMonth(new Date(Date.UTC(2026, 2, 15)))).toEqual({
      year: 2026,
      month: 2,
    });
  });

  test("UTCとJSTの月差を考慮する (UTC午後はJST翌日)", () => {
    // 2026-03-01 15:30 UTC = JST 2026-03-02 00:30 → 公開月は 2026-02
    expect(latestPublishedMonth(new Date(Date.UTC(2026, 2, 1, 15, 30)))).toEqual({
      year: 2026,
      month: 2,
    });
  });
});

describe("parsePeriod", () => {
  test('"all" は全期間として解釈する', () => {
    expect(parsePeriod("all")).toEqual({
      key: "all",
      year: null,
      month: null,
      isAll: true,
    });
  });

  test('"YYYY-MM" 形式を解釈する (0埋めなしも許容)', () => {
    expect(parsePeriod("2026-10")).toEqual({
      key: "2026-10",
      year: 2026,
      month: 10,
      isAll: false,
    });
    expect(parsePeriod("2026-1")).toEqual({
      key: "2026-1",
      year: 2026,
      month: 1,
      isAll: false,
    });
  });

  test("不正な入力はフォールバック (指定なければ既定期間)", () => {
    expect(parsePeriod("invalid")).toEqual(parsePeriod(undefined));
    const fallback = { key: "2025-1", year: 2025, month: 1, isAll: false };
    expect(parsePeriod("9999-13", fallback)).toEqual(fallback);
    expect(parsePeriod("../etc/passwd", fallback)).toEqual(fallback);
    expect(parsePeriod("", fallback)).toEqual(fallback);
  });
});

describe("periodLabel / shortPeriodLabel", () => {
  test("ラベル生成", () => {
    const period = parsePeriod("2026-10");
    expect(periodLabel(period)).toBe("2026年10月");
    expect(shortPeriodLabel(period)).toBe("2026.10");
    expect(periodLabel(parsePeriod("all"))).toBe("全期間");
  });
});

describe("periodHref", () => {
  test("m= を常に付与する", () => {
    expect(periodHref("/members", parsePeriod("2026-10"))).toBe("/members?m=2026-10");
    expect(periodHref("/members", parsePeriod("all"))).toBe("/members?m=all");
  });

  test("追加パラメータを保持する", () => {
    expect(periodHref("/compare", parsePeriod("all"), { user_id: "123" })).toBe(
      "/compare?user_id=123&m=all",
    );
  });
});

describe("recentMonths", () => {
  test("公開月から新しい順にnヶ月返す (年跨ぎ)", () => {
    const months = recentMonths(3, new Date(Date.UTC(2026, 0, 10)));
    expect(months.map((m) => m.key)).toEqual(["2025-12", "2025-11", "2025-10"]);
  });
});

describe("previousMonthOf", () => {
  test("前月を返す (1月は前年12月)", () => {
    expect(previousMonthOf(parsePeriod("2026-3"))).toEqual({ year: 2026, month: 2 });
    expect(previousMonthOf(parsePeriod("2026-1"))).toEqual({ year: 2025, month: 12 });
    expect(previousMonthOf(parsePeriod("all"))).toBeNull();
  });
});
