"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import PageToolbar from "@/components/shell/PageToolbar";
import PeriodPicker from "@/components/shell/PeriodPicker";
import { DEFAULT_AVATAR_URL } from "./RankTopCard";
import { fetchAPI } from "@/lib/api";
import { periodLabel } from "@/lib/period";

interface GraphNode {
  user_id: string;
  display_name: string;
  username: string;
  avatar: string | null;
  avatar_decoration: string | null;
  count: number;
  top_channel: string | null;
}

interface GraphEdge {
  a: string;
  b: string;
  weight: number;
}

/** ノードの配色パレット (主活動チャンネルごとに色を分ける) */
const NODE_PALETTE = [
  "#3964fe",
  "#e8425a",
  "#35c5b0",
  "#f0c64e",
  "#9b6ef3",
  "#4fae6a",
  "#eb6f91",
  "#5cb3f6",
];

function colorForChannel(channel: string | null): string {
  if (!channel) return "#9ca3af";
  let hash = 0;
  for (let i = 0; i < channel.length; i += 1) hash = (hash * 31 + channel.charCodeAt(i)) >>> 0;
  return NODE_PALETTE[hash % NODE_PALETTE.length];
}

interface SimNode extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
}

export default function RelationGraphView({
  period,
}: {
  period: { key: string; year: number | null; month: number | null; isAll: boolean };
}) {
  const [data, setData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const base = period.isAll
    ? "/graph/relation/total"
    : `/graph/relation/${period.year}/${period.month}`;

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setFailed(false);
    fetchAPI(base, { retries: 1 })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { nodes: GraphNode[]; edges: GraphEdge[] };
        if (!cancelled) setData(body);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [base]);

  const maxCount = useMemo(
    () => (data ? Math.max(...data.nodes.map((node) => node.count), 1) : 1),
    [data],
  );
  const topPairs = useMemo(() => {
    if (!data) return [];
    const byId = new Map(data.nodes.map((node) => [node.user_id, node]));
    return [...data.edges]
      .slice(0, 8)
      .map((edge) => ({ edge, a: byId.get(edge.a), b: byId.get(edge.b) }))
      .filter((pair) => pair.a && pair.b);
  }, [data]);

  // ===== グラフ描画 (canvas 力学シミュレーション) =====
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !data || data.nodes.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = container.clientWidth;
    let height = container.clientHeight;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    // ビュー変換: 世界原点=キャンバス中央で初期化する
    const view = { scale: 1, x: width / 2, y: height / 2 };

    const resize = () => {
      const prevWidth = width;
      const prevHeight = height;
      width = container.clientWidth;
      height = container.clientHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      // 中央基準を保つ
      view.x += (width - prevWidth) / 2;
      view.y += (height - prevHeight) / 2;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    // 初期配置: 黄金角螺旋
    const golden = Math.PI * (3 - Math.sqrt(5));
    const simNodes: SimNode[] = data.nodes.map((node, index) => ({
      ...node,
      color: colorForChannel(node.top_channel),
      radius: 9 + 11 * Math.sqrt(node.count / maxCount),
      x: Math.cos(index * golden) * (40 + 6 * index),
      y: Math.sin(index * golden) * (40 + 6 * index),
      vx: 0,
      vy: 0,
    }));
    const nodeById = new Map(simNodes.map((node) => [node.user_id, node]));
    const simEdges = data.edges
      .map((edge) => {
        const a = nodeById.get(edge.a);
        const b = nodeById.get(edge.b);
        return a && b ? { a, b, weight: edge.weight } : null;
      })
      .filter((edge): edge is { a: SimNode; b: SimNode; weight: number } => edge !== null);
    const maxWeight = Math.max(...simEdges.map((edge) => edge.weight), 1);

    // アバターの事前読み込み
    const images = new Map<string, HTMLImageElement | null>();
    for (const node of simNodes) {
      const img = new Image();
      img.src = node.avatar || DEFAULT_AVATAR_URL;
      images.set(node.user_id, img);
    }

    let alpha = 1;
    let dragNode: SimNode | null = null;
    let panning = false;
    let lastPointer = { x: 0, y: 0 };
    let hoverNode: SimNode | null = null;

    const toWorld = (cx: number, cy: number): { x: number; y: number } => {
      const rect = canvas.getBoundingClientRect();
      const px = cx - rect.left;
      const py = cy - rect.top;
      return { x: (px - view.x) / view.scale, y: (py - view.y) / view.scale };
    };

    const pickNode = (cx: number, cy: number): SimNode | null => {
      const world = toWorld(cx, cy);
      let closest: SimNode | null = null;
      let closestDist = Infinity;
      for (const node of simNodes) {
        const dx = world.x - node.x;
        const dy = world.y - node.y;
        const dist = Math.hypot(dx, dy);
        if (dist < node.radius + 6 && dist < closestDist) {
          closest = node;
          closestDist = dist;
        }
      }
      return closest;
    };

    const step = () => {
      const n = simNodes.length;
      // 反発
      for (let i = 0; i < n; i += 1) {
        for (let j = i + 1; j < n; j += 1) {
          const a = simNodes[i];
          const b = simNodes[j];
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let dist = Math.hypot(dx, dy);
          if (dist < 1) {
            dx = (Math.random() - 0.5) * 2;
            dy = (Math.random() - 0.5) * 2;
            dist = 1;
          }
          const force = (2600 * alpha) / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          a.vx += fx;
          a.vy += fy;
          b.vx -= fx;
          b.vy -= fy;
        }
      }
      // バネ (結び付きが強いほど短く引き寄せる)
      for (const edge of simEdges) {
        const dx = edge.b.x - edge.a.x;
        const dy = edge.b.y - edge.a.y;
        const dist = Math.hypot(dx, dy) || 1;
        const strength = 0.012 + 0.03 * (edge.weight / maxWeight);
        const target = 150 - 70 * (edge.weight / maxWeight);
        const force = (dist - target) * strength * alpha;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        edge.a.vx += fx;
        edge.a.vy += fy;
        edge.b.vx -= fx;
        edge.b.vy -= fy;
      }
      // 中央への引力 + 減衰
      for (const node of simNodes) {
        if (node === dragNode) {
          node.vx = 0;
          node.vy = 0;
          continue;
        }
        node.vx -= node.x * 0.012 * alpha;
        node.vy -= node.y * 0.012 * alpha;
        node.vx *= 0.85;
        node.vy *= 0.85;
        const speed = Math.hypot(node.vx, node.vy);
        if (speed > 24) {
          node.vx = (node.vx / speed) * 24;
          node.vy = (node.vy / speed) * 24;
        }
        node.x += node.vx;
        node.y += node.vy;
      }
      alpha *= 0.985;
    };

    const draw = () => {
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.translate(view.x, view.y);
      ctx.scale(view.scale, view.scale);

      const highlight = new Set<string>();
      if (hoverNode) {
        highlight.add(hoverNode.user_id);
        for (const edge of simEdges) {
          if (edge.a === hoverNode) highlight.add(edge.b.user_id);
          if (edge.b === hoverNode) highlight.add(edge.a.user_id);
        }
      }

      // エッジ
      for (const edge of simEdges) {
        const isHighlighted =
          hoverNode && (edge.a === hoverNode || edge.b === hoverNode) ? true : false;
        const alphaEdge = isHighlighted ? 0.9 : hoverNode ? 0.05 : 0.12 + 0.5 * (edge.weight / maxWeight);
        ctx.strokeStyle = isHighlighted ? "#3964fe" : `rgba(120,130,150,${alphaEdge})`;
        ctx.lineWidth = isHighlighted ? 2.4 : 0.8 + 2.6 * (edge.weight / maxWeight);
        ctx.beginPath();
        ctx.moveTo(edge.a.x, edge.a.y);
        ctx.lineTo(edge.b.x, edge.b.y);
        ctx.stroke();
      }

      // ノード
      for (const node of simNodes) {
        const dimmed = hoverNode && !highlight.has(node.user_id);
        ctx.globalAlpha = dimmed ? 0.18 : 1;
        const ringColor = node === hoverNode ? "#3964fe" : node.color;
        const img = images.get(node.user_id);
        const imageReady = img && img.complete && img.naturalWidth > 0;
        // 外周リング
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius + 2, 0, Math.PI * 2);
        ctx.fillStyle = ringColor;
        ctx.fill();
        // アバター (円形クリップ)
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
          ctx.font = `bold ${Math.max(9, Math.round(node.radius * 0.8))}px system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(node.display_name.slice(0, 2), node.x, node.y + 1);
        }
        // ラベル: ホバー対象とその隣接ノード、または大きいノード
        const showLabel =
          hoverNode === node ||
          (hoverNode && highlight.has(node.user_id)) ||
          (!hoverNode && node.radius >= 15);
        if (showLabel) {
          ctx.font = "bold 10px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.lineWidth = 3;
          ctx.strokeStyle = "rgba(0,0,0,0.55)";
          const label = node.display_name.length > 10 ? `${node.display_name.slice(0, 9)}…` : node.display_name;
          ctx.strokeText(label, node.x, node.y + node.radius + 4);
          ctx.fillStyle = "#e8eaed";
          ctx.fillText(label, node.x, node.y + node.radius + 4);
        }
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    };

    let raf = 0;
    const loop = () => {
      if (alpha > 0.012 || dragNode) step();
      draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const onPointerDown = (event: PointerEvent) => {
      const node = pickNode(event.clientX, event.clientY);
      if (node) {
        dragNode = node;
        alpha = Math.max(alpha, 0.35);
      } else {
        panning = true;
      }
      lastPointer = { x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (dragNode) {
        const world = toWorld(event.clientX, event.clientY);
        dragNode.x = world.x;
        dragNode.y = world.y;
        dragNode.vx = 0;
        dragNode.vy = 0;
        return;
      }
      if (panning) {
        view.x += event.clientX - lastPointer.x;
        view.y += event.clientY - lastPointer.y;
        lastPointer = { x: event.clientX, y: event.clientY };
        return;
      }
      hoverNode = pickNode(event.clientX, event.clientY);
      canvas.style.cursor = hoverNode ? "grab" : "default";
    };
    const onPointerUp = () => {
      dragNode = null;
      panning = false;
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      const nextScale = Math.min(4, Math.max(0.35, view.scale * factor));
      view.x = px - ((px - view.x) * nextScale) / view.scale;
      view.y = py - ((py - view.y) * nextScale) / view.scale;
      view.scale = nextScale;
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [data, maxCount]);

  const title = period.isAll ? "全期間" : periodLabel(period);

  if (failed) {
    return (
      <div className="app-card-padded text-center text-sm text-muted-foreground">
        データの読み込みに失敗しました。
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <div className="h-9 w-64 animate-pulse rounded-xl bg-muted" />
        <div className="h-[560px] animate-pulse rounded-2xl bg-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageToolbar
        title="関係性"
        subtitle={`${title}にアクティブだったメンバー同士の結び付き`}
        right={<PeriodPicker period={period} mode="query" />}
      />

      {data.nodes.length === 0 ? (
        <div className="app-card-padded text-center text-sm text-muted-foreground">
          この期間にデータがありません。
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="app-card overflow-hidden xl:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
              <div>
                <p className="text-sm font-black text-foreground">メンバーの関係値グラフ</p>
                <p className="mt-0.5 text-xs font-bold text-muted-foreground">
                  同じチャンネルで発言しているメンバー同士を線で結びました。線が太いほど仲良しです。
                </p>
              </div>
              <div className="flex gap-4 text-xs font-bold text-muted-foreground">
                <span>メンバー {data.nodes.length}人</span>
                <span>結び付き {data.edges.length}本</span>
              </div>
            </div>
            <div ref={containerRef} className="relative h-[520px] w-full touch-none">
              <canvas ref={canvasRef} className="block h-full w-full" />
              <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/45 px-3 py-1 text-[11px] font-bold text-white">
                ドラッグで移動 / ホイールでズーム / ノードをつまんで動かせます
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="app-card-padded">
              <p className="text-sm font-black text-foreground">結び付きが強いペア</p>
              <p className="mt-0.5 mb-4 text-xs font-bold text-muted-foreground">
                同じチャンネルでの発言量が重なる組み合わせ
              </p>
              {topPairs.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">データがありません</p>
              ) : (
                <ul className="space-y-3">
                  {topPairs.map(({ edge, a, b }) => {
                    const maxPair = topPairs[0]?.edge.weight ?? 1;
                    return (
                      <li key={`${edge.a}-${edge.b}`}>
                        <div className="mb-1 flex items-center justify-between gap-2 text-xs font-bold">
                          <span className="flex min-w-0 items-center gap-1">
                            <span className="truncate text-foreground">{a?.display_name}</span>
                            <span className="shrink-0 text-muted-foreground">×</span>
                            <span className="truncate text-foreground">{b?.display_name}</span>
                          </span>
                          <span className="shrink-0 text-muted-foreground">
                            {edge.weight.toLocaleString("ja-JP")}
                          </span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-accent-data"
                            style={{
                              width: `${Math.max(4, Math.round((edge.weight / maxPair) * 100))}%`,
                            }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="app-card-padded">
              <p className="text-sm font-black text-foreground">中心人物</p>
              <p className="mt-0.5 mb-3 text-xs font-bold text-muted-foreground">
                結び付きの総量が大きいメンバー
              </p>
              <ol className="space-y-1.5 text-xs font-bold">
                {data.nodes.slice(0, 8).map((node, index) => (
                  <li key={node.user_id} className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="w-4 shrink-0 text-muted-foreground">{index + 1}.</span>
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: colorForChannel(node.top_channel) }} />
                      <span className="truncate text-foreground">{node.display_name}</span>
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {node.count.toLocaleString("ja-JP")}件
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
