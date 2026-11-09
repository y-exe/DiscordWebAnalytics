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

interface Cluster {
  name: string;
  color: string;
  nodes: GraphNode[];
  totalCount: number;
  /** 背景ハローの半径 */
  haloRadius: number;
}

/** 界隈 (クラスタ) ごとの配色。サイズ順に割り当てる */
const CLUSTER_PALETTE = [
  "#3964fe",
  "#e8425a",
  "#35c5b0",
  "#f0c64e",
  "#9b6ef3",
  "#4fae6a",
  "#eb6f91",
  "#5cb3f6",
  "#f0854e",
  "#54d48d",
];

/** クラスタ内のノードを黄金角螺旋で敷き詰める座標を返す (決定的レイアウト) */
function layoutClusters(data: { nodes: GraphNode[]; edges: GraphEdge[] }) {

  // クラスタ半径: ノードの大きさから黄金角螺旋 (フィロタキシス) で
  // 隣接ノードが重ならない間隔を確保したサイズ
  const maxCount = Math.max(...data.nodes.map((node) => node.count), 1);
  const nodeRadius = (node: GraphNode): number => 11 + 12 * Math.sqrt(node.count / maxCount);
  const clusterRadius = (clusterNodes: GraphNode[]): number => {
    const mean =
      clusterNodes.reduce((sum, node) => sum + nodeRadius(node), 0) / clusterNodes.length;
    const spacing = 2.05 * mean;
    const maxOrbit = spacing * Math.sqrt(Math.max(clusterNodes.length - 0.4, 1));
    const maxNode = Math.max(...clusterNodes.map((node) => nodeRadius(node)));
    return maxOrbit + maxNode + 22;
  };
  // 主活動チャンネルごとにグループ化
  const grouped = new Map<string, GraphNode[]>();
  for (const node of data.nodes) {
    const key = node.top_channel ?? "その他";
    const list = grouped.get(key) ?? [];
    list.push(node);
    grouped.set(key, list);
  }
  const clusters: Cluster[] = [...grouped.entries()]
    .map(([name, nodes], index) => ({
      name,
      nodes: [...nodes].sort((a, b) => b.count - a.count),
      color: CLUSTER_PALETTE[index % CLUSTER_PALETTE.length],
      totalCount: nodes.reduce((sum, node) => sum + node.count, 0),
      haloRadius: clusterRadius(nodes) + 12,
    }))
    .sort((a, b) => b.nodes.length - a.nodes.length);
  // クラスタ中心を Ring上に配置。隣接クラスタが重ならないようRを決める
  const radii = clusters.map((cluster) => clusterRadius(cluster.nodes));
  const K = clusters.length;
  const sinHalf = Math.sin(Math.PI / Math.max(K, 2));
  const minSpacing = Math.max(
    ...radii.map((radius, index) => radius + radii[(index + 1) % K]),
    240,
  );
  const ringRadius = Math.max(240, minSpacing / (2 * sinHalf) + 70);

  interface PositionedNode extends GraphNode {
    x: number;
    y: number;
    radius: number;
    color: string;
  }
  const nodeById = new Map<string, PositionedNode>();
  const clusterOfNode = new Map<string, string>();
  const golden = Math.PI * (3 - Math.sqrt(5));

  clusters.forEach((cluster, clusterIndex) => {
    const cr = clusterRadius(cluster.nodes);
    const angle = -Math.PI / 2 + (2 * Math.PI * clusterIndex) / K;
    const cx = Math.cos(angle) * ringRadius;
    const cy = Math.sin(angle) * ringRadius;
    cluster.nodes.forEach((node, nodeIndex) => {
      const mean =
        cluster.nodes.reduce((sum, entry) => sum + nodeRadius(entry), 0) / cluster.nodes.length;
      const spacing = 2.05 * mean;
      const orbit = spacing * Math.sqrt(nodeIndex + 0.6);
      const nodeAngle = nodeIndex * golden + clusterIndex;
      nodeById.set(node.user_id, {
        ...node,
        x: cx + Math.cos(nodeAngle) * orbit,
        y: cy + Math.sin(nodeAngle) * orbit,
        radius: nodeRadius(node),
        color: cluster.color,
      });
      clusterOfNode.set(node.user_id, cluster.name);
    });
  });

  return { clusters, nodes: nodeById, clusterOfNode, ringRadius };
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

  const layout = useMemo(() => (data && data.nodes.length > 0 ? layoutClusters(data) : null), [data]);

  const topPairs = useMemo(() => {
    if (!data) return [];
    const byId = layout?.nodes ?? null;
    return [...data.edges]
      .slice(0, 8)
      .map((edge) => ({ edge, a: byId?.get(edge.a), b: byId?.get(edge.b) }))
      .filter((pair) => pair.a && pair.b);
  }, [data, layout]);

  // ===== グラフ描画 (静的クラスタレイアウト) =====
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !layout || !data) return;
    const graphLayout = layout;
    const graphData = data;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = container.clientWidth;
    let height = container.clientHeight;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    const view = { scale: 1, x: 0, y: 0 };

    const fitView = () => {
      // ノード全体のバウンディングボックスを画面に収める
      const nodes = [...graphLayout.nodes.values()];
      const margin = 110;
      const minX = Math.min(...nodes.map((node) => node.x - node.radius)) - margin;
      const maxX = Math.max(...nodes.map((node) => node.x + node.radius)) + margin;
      const minY = Math.min(...nodes.map((node) => node.y - node.radius)) - margin;
      const maxY = Math.max(...nodes.map((node) => node.y + node.radius)) + margin;
      const scaleX = width / Math.max(maxX - minX, 1);
      const scaleY = height / Math.max(maxY - minY, 1);
      view.scale = Math.min(scaleX, scaleY, 1.3);
      view.x = width / 2 - ((minX + maxX) / 2) * view.scale;
      view.y = height / 2 - ((minY + maxY) / 2) * view.scale;
    };

    const resize = () => {
      width = container.clientWidth;
      height = container.clientHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      fitView();
      draw();
    };

    // アバターの事前読み込み (読み込み完了ごとに再描画)
    const images = new Map<string, HTMLImageElement>();
    for (const node of graphLayout.nodes.values()) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => draw();
      img.src = node.avatar || DEFAULT_AVATAR_URL;
      images.set(node.user_id, img);
    }

    let hoverNode: { user_id: string } | null = null;

    const maxWeight = Math.max(
      ...data
        ? data.edges.map((edge) => edge.weight)
        : [1],
      1,
    );

    function draw() {
      ctx?.save();
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx?.clearRect(0, 0, width, height);
      if (!ctx) return;
      ctx.translate(view.x, view.y);
      ctx.scale(view.scale, view.scale);

      const highlight = new Set<string>();
      if (hoverNode) {
        highlight.add(hoverNode.user_id);
        for (const edge of graphData.edges ?? []) {
          if (edge.a === hoverNode.user_id) highlight.add(edge.b);
          if (edge.b === hoverNode.user_id) highlight.add(edge.a);
        }
      }

      // クラスタの背景ハロー + 界隈名
      for (const cluster of graphLayout.clusters) {
        const members = cluster.nodes.map((node) => graphLayout.nodes.get(node.user_id)).filter(Boolean);
        const cx = members.reduce((sum, node) => sum + (node?.x ?? 0), 0) / members.length;
        const cy = members.reduce((sum, node) => sum + (node?.y ?? 0), 0) / members.length;
        const cr = cluster.haloRadius;
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, cr, 0, Math.PI * 2);
        ctx.fillStyle = `${cluster.color}14`;
        ctx.fill();
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = `${cluster.color}55`;
        ctx.lineWidth = 1.4 / view.scale;
        ctx.stroke();
        ctx.setLineDash([]);
        // 界隈ラベル
        ctx.font = "bold 15px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.lineWidth = 4;
        ctx.strokeStyle = "rgba(0,0,0,0.65)";
        ctx.strokeText(cluster.name, cx, cy - cr - 10);
        ctx.fillStyle = cluster.color;
        ctx.fillText(cluster.name, cx, cy - cr - 10);
      }

      // エッジ
      for (const edge of graphData.edges ?? []) {
        const a = graphLayout.nodes.get(edge.a);
        const b = graphLayout.nodes.get(edge.b);
        if (!a || !b) continue;
        const isHighlighted =
          hoverNode && (edge.a === hoverNode.user_id || edge.b === hoverNode.user_id);
        const alphaEdge = isHighlighted
          ? 0.95
          : hoverNode
            ? 0.04
            : 0.1 + 0.55 * (edge.weight / maxWeight);
        ctx.strokeStyle = isHighlighted ? "#3964fe" : `rgba(120,130,150,${alphaEdge})`;
        ctx.lineWidth = isHighlighted ? 2.6 : 0.8 + 2.8 * (edge.weight / maxWeight);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      // ノード (アバター + リング + 全員にラベル)
      for (const node of graphLayout.nodes.values()) {
        const dimmed = hoverNode && !highlight.has(node.user_id);
        ctx.globalAlpha = dimmed ? 0.16 : 1;
        const ringColor = hoverNode?.user_id === node.user_id ? "#3964fe" : node.color;
        const img = images.get(node.user_id);
        const imageReady = img && img.complete && img.naturalWidth > 0;
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius + 2.5, 0, Math.PI * 2);
        ctx.fillStyle = ringColor;
        ctx.fill();
        if (imageReady) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(img, node.x - node.radius, node.y - node.radius, node.radius * 2, node.radius * 2);
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
        // 全ノードに名前ラベル (静的レイアウトなので常時表示)
        const label =
          node.display_name.length > 12 ? `${node.display_name.slice(0, 11)}…` : node.display_name;
        ctx.font = "bold 10px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(0,0,0,0.6)";
        ctx.strokeText(label, node.x, node.y + node.radius + 5);
        ctx.fillStyle = "#e8eaed";
        ctx.fillText(label, node.x, node.y + node.radius + 5);
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    const toWorld = (cx: number, cy: number): { x: number; y: number } => {
      const rect = canvas.getBoundingClientRect();
      const px = cx - rect.left;
      const py = cy - rect.top;
      return { x: (px - view.x) / view.scale, y: (py - view.y) / view.scale };
    };

    const pickNode = (cx: number, cy: number) => {
      const world = toWorld(cx, cy);
      let closest: { user_id: string } | null = null;
      let closestDist = Infinity;
      for (const node of graphLayout.nodes.values()) {
        const dist = Math.hypot(world.x - node.x, world.y - node.y);
        if (dist < node.radius + 6 && dist < closestDist) {
          closest = node;
          closestDist = dist;
        }
      }
      return closest;
    };

    let panning = false;
    let lastPointer = { x: 0, y: 0 };

    const onPointerDown = (event: PointerEvent) => {
      panning = true;
      lastPointer = { x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (panning) {
        view.x += event.clientX - lastPointer.x;
        view.y += event.clientY - lastPointer.y;
        lastPointer = { x: event.clientX, y: event.clientY };
        draw();
        return;
      }
      const picked = pickNode(event.clientX, event.clientY);
      if (picked !== hoverNode) {
        hoverNode = picked;
        canvas.style.cursor = picked ? "pointer" : "grab";
        draw();
      }
    };
    const onPointerUp = () => {
      panning = false;
    };
    const onPointerLeave = () => {
      panning = false;
      if (hoverNode) {
        hoverNode = null;
        draw();
      }
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      const nextScale = Math.min(4, Math.max(0.3, view.scale * factor));
      view.x = px - ((px - view.x) * nextScale) / view.scale;
      view.y = py - ((py - view.y) * nextScale) / view.scale;
      view.scale = nextScale;
      draw();
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [layout, data]);

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

      {data.nodes.length === 0 || !layout ? (
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
                  主な活動場所 (界隈) ごとに色分けしてグループ化しました。線が太いほど発言が重なる相手です。
                </p>
              </div>
              <div className="flex gap-4 text-xs font-bold text-muted-foreground">
                <span>メンバー {data.nodes.length}人</span>
                <span>結び付き {data.edges.length}本</span>
              </div>
            </div>
            <div ref={containerRef} className="relative h-[540px] w-full touch-none">
              <canvas ref={canvasRef} className="block h-full w-full" />
              <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/45 px-3 py-1 text-[11px] font-bold text-white">
                ドラッグで視点移動 / ホイールでズーム
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="app-card-padded">
              <p className="text-sm font-black text-foreground">界隈</p>
              <p className="mt-0.5 mb-3 text-xs font-bold text-muted-foreground">
                最も多く発言したチャンネルごとのグループ
              </p>
              <ul className="space-y-1.5 text-xs font-bold">
                {layout?.clusters.map((cluster) => (
                  <li key={cluster.name} className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span
                        className="h-3 w-3 shrink-0 rounded-full"
                        style={{ backgroundColor: cluster.color }}
                      />
                      <span className="truncate text-foreground">{cluster.name}</span>
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {cluster.nodes.length}人
                    </span>
                  </li>
                ))}
              </ul>
            </div>

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
                {data.nodes.slice(0, 8).map((node, index) => {
                  const clusterName = layout?.clusterOfNode.get(node.user_id);
                  const cluster = layout?.clusters.find((entry) => entry.name === clusterName);
                  return (
                    <li key={node.user_id} className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="w-4 shrink-0 text-muted-foreground">{index + 1}.</span>
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: cluster?.color ?? "#9ca3af" }}
                        />
                        <span className="truncate text-foreground">{node.display_name}</span>
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {node.count.toLocaleString("ja-JP")}件
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
