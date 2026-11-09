"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import PageToolbar from "@/components/shell/PageToolbar";
import PeriodPicker from "@/components/shell/PeriodPicker";
import { DEFAULT_AVATAR_URL } from "./RankTopCard";
import { fetchAPI } from "@/lib/api";
import { periodLabel } from "@/lib/period";

interface MemberLite {
  user_id: string;
  display_name: string;
  username: string;
  avatar: string | null;
  avatar_decoration: string | null;
}

interface Partner {
  user_id: string;
  display_name: string;
  username: string;
  avatar: string | null;
  avatar_decoration: string | null;
  weight: number;
}

interface PartnersPayload {
  center: (MemberLite & { count: number }) | null;
  partners: Partner[];
}

/** comcom風のノード配色 (パステル) */
const NODE_PALETTE = [
  "#2fb7a4",
  "#9b59d0",
  "#f0854e",
  "#f0b429",
  "#eb6f91",
  "#3964fe",
  "#4fae6a",
  "#5cb3f6",
];

function colorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return NODE_PALETTE[hash % NODE_PALETTE.length];
}

/** 選択メンバーを中心に、絡みの多い相手を放射状に並べる星型ネットワーク (comcom風) */
export default function RelationGraphView({
  period,
}: {
  period: { key: string; year: number | null; month: number | null; isAll: boolean };
}) {
  const [members, setMembers] = useState<MemberLite[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [payload, setPayload] = useState<PartnersPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  const membersBase = period.isAll
    ? "/users/members/total"
    : `/users/members/${period.year}/${period.month}`;

  // 全メンバー (検索用)
  useEffect(() => {
    let cancelled = false;
    setMembers([]);
    setSelectedId(null);
    setQuery("");
    fetchAPI(membersBase)
      .then(async (res) => {
        if (!res.ok) return;
        const body = (await res.json()) as MemberLite[];
        if (!cancelled) setMembers(Array.isArray(body) ? body : []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [membersBase]);

  // メンバー一覧が揃ったら発言数トップのメンバーを既定表示にする
  useEffect(() => {
    if (!selectedId && members.length > 0) setSelectedId(members[0].user_id);
  }, [members, selectedId]);

  const partnersBase = useMemo(() => {
    if (!selectedId) return null;
    return period.isAll
      ? `/graph/partners/${selectedId}/total`
      : `/graph/partners/${selectedId}/${period.year}/${period.month}`;
  }, [selectedId, period]);

  useEffect(() => {
    if (!partnersBase) return;
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    setPayload(null);
    fetchAPI(partnersBase, { retries: 1 })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as PartnersPayload;
        if (!cancelled) setPayload(body);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [partnersBase]);

  const maxWeight = useMemo(
    () => (payload ? Math.max(...payload.partners.map((partner) => partner.weight), 1) : 1),
    [payload],
  );

  // ===== 星型ネットワーク描画 =====
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !payload || !payload.center) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = container.clientWidth;
    let height = container.clientHeight;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    const satellites = payload.partners.slice(0, 24);
    const maxW = Math.max(...satellites.map((partner) => partner.weight), 1);
    const centerColor = colorForUser(payload.center.user_id);

    interface StarNode {
      user_id: string;
      display_name: string;
      avatar: string | null;
      weight: number;
      color: string;
      radius: number;
      x: number;
      y: number;
    }

    const centerNode: StarNode = {
      user_id: payload.center.user_id,
      display_name: payload.center.display_name,
      avatar: payload.center.avatar,
      weight: payload.center.count,
      color: centerColor,
      radius: 30,
      x: 0,
      y: 0,
    };

    let ringRadius = 0;
    let starNodes: StarNode[] = [];
    const layout = () => {
      ringRadius = Math.max(130, Math.min(width, height) / 2 - 78);
      // 絡みが強い順に上から時計回り
      starNodes = satellites.map((partner, index) => {
        const angle = -Math.PI / 2 + (2 * Math.PI * index) / Math.max(satellites.length, 1);
        return {
          user_id: partner.user_id,
          display_name: partner.display_name,
          avatar: partner.avatar,
          weight: partner.weight,
          color: colorForUser(partner.user_id),
          radius: 15 + 9 * Math.sqrt(partner.weight / maxW),
          x: Math.cos(angle) * ringRadius,
          y: Math.sin(angle) * ringRadius,
        };
      });
    };

    // アバター読み込み
    const images = new Map<string, HTMLImageElement | null>();
    const ensureImage = (user_id: string, avatar: string | null) => {
      if (images.has(user_id)) return;
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => draw();
      img.src = avatar || DEFAULT_AVATAR_URL;
      images.set(user_id, img);
    };
    ensureImage(centerNode.user_id, centerNode.avatar);
    for (const node of starNodes) ensureImage(node.user_id, node.avatar);

    let hoverNode: StarNode | null = null;

    function draw() {
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.translate(width / 2, height / 2);

      const labelColor = "#8b909a";
      // エッジ (サーモン色、絡みが強いほど太い)
      for (const node of starNodes) {
        const isHighlighted = hoverNode === node;
        ctx.strokeStyle = isHighlighted
          ? "#f0854e"
          : `rgba(240,138,110,${isHighlighted ? 0.95 : 0.28 + 0.45 * (node.weight / maxW)})`;
        ctx.lineWidth = isHighlighted ? 10 : 2 + 9 * (node.weight / maxW);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(node.x, node.y);
        ctx.stroke();
      }

      // 中心メンバー
      ctx.globalAlpha = 1;
      if (hoverNode) {
        ctx.globalAlpha = 0.35;
      }
      drawNode(centerNode, true);
      ctx.globalAlpha = 1;

      // 衛星ノード
      for (const node of starNodes) {
        const dimmed = hoverNode && hoverNode !== node;
        ctx.globalAlpha = dimmed ? 0.35 : 1;
        drawNode(node, false);
        ctx.globalAlpha = 1;
      }

      function drawNode(node: StarNode, isCenter: boolean) {
        if (!ctx) return;
        const img = images.get(node.user_id);
        const imageReady = img && img.complete && img.naturalWidth > 0;
        // リング
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius + 2, 0, Math.PI * 2);
        ctx.fillStyle = node.color;
        ctx.fill();
        // 円の中身 (アバター or 頭文字)
        if (imageReady) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
          ctx.clip();
          const size = node.radius * 2;
          ctx.drawImage(img, node.x - node.radius, node.y - node.radius, size, size);
          ctx.restore();
        } else {
          ctx.beginPath();
          ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
          ctx.fillStyle = node.color;
          ctx.fill();
          ctx.fillStyle = "#fff";
          ctx.font = `bold ${Math.round(node.radius * 0.9)}px system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(node.display_name.slice(0, 1).toUpperCase(), node.x, node.y + 1);
        }
        // 名前ラベル
        const label =
          node.display_name.length > 12 ? `${node.display_name.slice(0, 11)}…` : node.display_name;
        ctx.font = isCenter ? "bold 12px system-ui, sans-serif" : "bold 11px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(0,0,0,0.5)";
        const labelY = isCenter ? node.radius + 6 : node.y + node.radius + 4;
        ctx.strokeText(label, node.x, labelY);
        ctx.fillStyle = labelColor;
        ctx.fillText(label, node.x, labelY);
        // 絡み数 (ホバー中のみ)
        if (hoverNode === node) {
          ctx.font = "bold 11px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          ctx.strokeText(`${node.weight.toLocaleString("ja-JP")}絡み`, node.x, node.y - node.radius - 6);
          ctx.fillStyle = "#f0854e";
          ctx.fillText(`${node.weight.toLocaleString("ja-JP")}絡み`, node.x, node.y - node.radius - 6);
        }
      }
    }

    const resize = () => {
      width = container.clientWidth;
      height = container.clientHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      layout();
      draw();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    const toLocal = (event: PointerEvent): { x: number; y: number } => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left - width / 2, y: event.clientY - rect.top - height / 2 };
    };

    const pick = (event: PointerEvent): StarNode | null => {
      const local = toLocal(event);
      let closest: StarNode | null = null;
      let closestDist = Infinity;
      for (const node of starNodes) {
        const dist = Math.hypot(local.x - node.x, local.y - node.y);
        if (dist < node.radius + 8 && dist < closestDist) {
          closest = node;
          closestDist = dist;
        }
      }
      return closest;
    };

    const onPointerMove = (event: PointerEvent) => {
      const picked = pick(event);
      if (picked !== hoverNode) {
        hoverNode = picked;
        canvas.style.cursor = picked ? "pointer" : "default";
        draw();
      }
    };
    const onPointerLeave = () => {
      if (hoverNode) {
        hoverNode = null;
        draw();
      }
    };
    const onClick = (event: MouseEvent) => {
      // クリックで衛星メンバーを中心に切替
      const rect = canvas.getBoundingClientRect();
      const local = { x: event.clientX - rect.left - width / 2, y: event.clientY - rect.top - height / 2 };
      for (const node of starNodes) {
        if (Math.hypot(local.x - node.x, local.y - node.y) < node.radius + 8) {
          setSelectedId(node.user_id);
          break;
        }
      }
    };

    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("click", onClick);

    return () => {
      observer.disconnect();
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("click", onClick);
    };
  }, [payload, maxWeight]);

  // ピッカー外クリックで閉じる
  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as globalThis.Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [pickerOpen]);

  const filteredMembers = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? members.filter(
          (member) =>
            member.display_name.toLowerCase().includes(q) || member.username.toLowerCase().includes(q),
        )
      : members;
    return base.slice(0, 50);
  }, [members, query]);

  const selectedMember = useMemo(
    () => members.find((member) => member.user_id === selectedId) ?? null,
    [members, selectedId],
  );

  const title = period.isAll ? "全期間" : periodLabel(period);

  return (
    <div className="space-y-5">
      <PageToolbar
        title="関係性"
        subtitle={`${title}に絡みの多いメンバーとのつながり (全${members.length}人から選択)`}
        right={<PeriodPicker period={period} mode="query" />}
      />

      {/* メンバー選択 */}
      <div ref={pickerRef} className="relative max-w-md">
        <button
          type="button"
          onClick={() => setPickerOpen((open) => !open)}
          className="flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-bold text-foreground transition-colors hover:bg-muted"
        >
          <span className="truncate">
            {selectedMember
              ? selectedMember.display_name
              : loading && !payload
                ? "読み込み中…"
                : "メンバーを選択"}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">▼</span>
        </button>
        {pickerOpen && (
          <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-border bg-card shadow-lg">
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="名前で検索…"
              className="w-full border-b border-border bg-transparent px-4 py-2.5 text-sm font-bold text-foreground outline-none placeholder:font-medium placeholder:text-muted-foreground"
            />
            <ul className="max-h-72 overflow-y-auto">
              {filteredMembers.map((member) => (
                <li key={member.user_id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(member.user_id);
                      setPickerOpen(false);
                      setQuery("");
                    }}
                    className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm font-bold transition-colors hover:bg-muted ${
                      member.user_id === selectedId ? "bg-sidebar-active text-sidebar-text-strong" : "text-foreground"
                    }`}
                  >
                    <span
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-black text-white"
                      style={{ backgroundColor: colorForUser(member.user_id) }}
                    >
                      {member.display_name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="truncate">{member.display_name}</span>
                  </button>
                </li>
              ))}
              {filteredMembers.length === 0 && (
                <li className="px-4 py-3 text-sm text-muted-foreground">見つかりません</li>
              )}
            </ul>
          </div>
        )}
      </div>

      {failed && (
        <div className="app-card-padded text-center text-sm text-muted-foreground">
          データの読み込みに失敗しました。
        </div>
      )}

      {!payload && !failed && (
        <div className="space-y-4">
          <div className="h-[460px] animate-pulse rounded-2xl bg-muted" />
        </div>
      )}

      {payload && !payload.center && !failed && (
        <div className="app-card-padded text-center text-sm text-muted-foreground">
          この期間に発言記録のないメンバーです。
        </div>
      )}

      {payload && payload.center && (
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="app-card overflow-hidden xl:col-span-2">
            <div className="border-b border-border px-5 py-3">
              <p className="text-sm font-black text-foreground">交流ネットワーク</p>
              <p className="mt-0.5 text-xs font-bold text-muted-foreground">
                {payload.center.display_name} さんとよく絡んでいるメンバーとのつながり。ノードをクリックで中心を切替。
              </p>
            </div>
            <div ref={containerRef} className="relative h-[440px] w-full">
              <canvas ref={canvasRef} className="block h-full w-full" />
              {payload.partners.length === 0 && (
                <p className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
                  この期間に絡んだメンバーがいません
                </p>
              )}
            </div>
          </div>

          <div className="app-card-padded">
            <p className="text-sm font-black text-foreground">よく絡むメンバー</p>
            <p className="mt-0.5 mb-4 text-xs font-bold text-muted-foreground">
              {payload.center.display_name} さんと同じチャンネルでの発言が重なる相手
            </p>
            {payload.partners.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">データがありません</p>
            ) : (
              <ul className="space-y-2.5">
                {payload.partners.slice(0, 12).map((partner, index) => (
                  <li key={partner.user_id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(partner.user_id)}
                      className="group block w-full text-left"
                    >
                      <div className="mb-1 flex items-center justify-between gap-2 text-xs font-bold">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span
                            className={`grid h-5 w-5 shrink-0 place-items-center rounded-md text-[10px] font-black ${
                              index === 0
                                ? "bg-destructive text-white"
                                : index < 3
                                  ? "bg-accent-data text-white"
                                  : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {index + 1}
                          </span>
                          <span className="truncate text-foreground group-hover:underline">
                            {partner.display_name}
                          </span>
                        </span>
                        <span className="shrink-0 text-muted-foreground">
                          {partner.weight.toLocaleString("ja-JP")}回
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-accent-data"
                          style={{
                            width: `${Math.max(4, Math.round((partner.weight / maxWeight) * 100))}%`,
                          }}
                        />
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
