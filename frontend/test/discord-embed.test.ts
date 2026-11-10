import { describe, expect, test } from "bun:test";
import { buildComponentEmbed, socialMetadata } from "../src/lib/discord-embed";
import { isPublishedReportMonth, latestPublishedReportPath } from "../src/lib/report-period";

describe("buildComponentEmbed", () => {
  const base = {
    title: "共通のかかわり (2026年10月)",
    url: "https://analytics.ymkw.top/relation",
    description: "やまかわてるき鯖のメンバー間の結び付き。",
    thumbnailUrl: "https://cdn.discordapp.com/icons/1/a.webp",
    buttons: [
      { label: "メンバー", url: "https://analytics.ymkw.top/members" },
      { label: "比較", url: "https://analytics.ymkw.top/compare" },
    ],
  };

  test("Container(type 17)を頂点にSection/Separator/ActionRow/フッターを構成する", () => {
    const payload = buildComponentEmbed({ ...base, footer: "やまかわてるき鯖 ・ 2026年10月" });
    const container = payload.component as { type: number; components: Array<{ type: number }> };
    expect(container.type).toBe(17);
    const types = container.components.map((component) => component.type);
    expect(types).toContain(9); // Section
    expect(types).toContain(14); // Separator
    expect(types).toContain(1); // Action Row
    expect(types).toContain(10); // Text Display (フッター)
  });

  test("見出しはページURLへのリンクになる", () => {
    const payload = buildComponentEmbed(base);
    const container = payload.component as {
      components: Array<{ components: Array<{ content: string }> }>;
    };
    const heading = container.components[0].components[0].content;
    expect(heading).toContain(`[共通のかかわり (2026年10月)](${base.url})`);
  });

  test("3,000バイト上限を超える長文は自動的に削られる", () => {
    const longText = "あ".repeat(4000); // マルチバイトでバイト数を圧迫する
    const payload = buildComponentEmbed({ ...base, description: longText });
    const json = JSON.stringify(payload);
    expect(Buffer.byteLength(json, "utf8")).toBeLessThan(3000);
    // 見出しとボタンは生きている
    const container = payload.component as {
      components: Array<{ type: number; components?: Array<{ label?: string }> }>;
    };
    expect(container.components.some((component) => component.type === 1)).toBe(true);
  });

  test("</script> が含まれてもJSONを壊さない (エスケープは呼び出し側のserializeJsonLd担当)", () => {
    const payload = buildComponentEmbed({ ...base, description: "</script><script>alert(1)</script>" });
    const json = JSON.stringify(payload);
    // 生の "</script" がそのまま入るのは、serializeJsonLdで \u003c に変換してから出力する前提
    expect(json).toContain("</script>");
    // JSON自体はパースできる
    expect(JSON.parse(json).component.type).toBe(17);
  });

  test("serializeJsonLd による埋め込み文字列がscriptタグを壊さない", async () => {
    const { serializeJsonLd } = await import("../src/lib/seo");
    const payload = buildComponentEmbed({ ...base, description: "</script>x" });
    const embedded = serializeJsonLd(payload);
    expect(embedded).not.toContain("</script>");
    expect(JSON.parse(embedded).component.type).toBe(17);
  });
});

describe("socialMetadata", () => {
  test("OGとTwitterカードを生成する", () => {
    const meta = socialMetadata({
      title: "メンバー",
      description: "説明",
      url: "https://analytics.ymkw.top/members",
      imageUrl: "https://cdn.discordapp.com/icons/1/a.webp",
    });
    expect(meta.openGraph?.title).toBe("メンバー");
    expect(meta.openGraph?.url).toBe("https://analytics.ymkw.top/members");
    expect((meta.twitter as { card?: string })?.card).toBe("summary");
  });

  test("画像がなければsummaryカード (画像なし)", () => {
    const meta = socialMetadata({ title: "t", description: "d", url: "https://example.com" });
    expect((meta.twitter as { card?: string })?.card).toBe("summary");
    expect(meta.twitter?.images).toBeUndefined();
  });
});

describe("shared/report-period", () => {
  test("公開済み月判定がJST基準で動く", () => {
    // 2026-03-15 UTC → 公開は 2026-02 まで
    const now = new Date(Date.UTC(2026, 2, 15));
    expect(latestPublishedReportPath(now)).toBe("/month/2026/2");
    expect(isPublishedReportMonth(2026, 2, now)).toBe(true);
    expect(isPublishedReportMonth(2026, 3, now)).toBe(false);
    expect(isPublishedReportMonth(2026, 13, now)).toBe(false);
  });
});
