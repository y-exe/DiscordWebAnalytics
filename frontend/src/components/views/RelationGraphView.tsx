"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import Graph from "graphology";
import { layerImage } from "@sigma/node-image";
import { layerFill, sdfCircle } from "sigma/rendering";
import type { Attributes } from "graphology-types";
import type { EdgeReducer, NodeReducer } from "sigma/types";
import louvain from "graphology-communities-louvain";
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
  count: number;
  top_channel: string | null;
}

interface GraphEdge {
  a: string;
  b: string;
  weight: number;
}

/** VRCX-0のMutual Friendsグラフと同じコミュニティパレット (dark/light) */
const DARK_PALETTE = [
  "#7c8cf8",
  "#5ec98d",
  "#e8b45c",
  "#ef7a83",
  "#5fb6e0",
  "#b085e8",
  "#4ec9c0",
  "#f0925e",
  "#e984c4",
];
const LIGHT_PALETTE = [
  "#4f5fd9",
  "#2f9e63",
  "#c08321",
  "#d2545f",
  "#2f8fc4",
  "#8a5cd0",
  "#1f9a92",
  "#cf6b32",
  "#c85aa0",
];
const NAMED_COMMUNITY_LIMIT = 6;
const MIN_NAMED_SIZE = 3;

/** Louvain用のシード済み乱数 (VRCX-0と同じシードで決定的にする) */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + 0x6d2b79f5) >>> 0;
    return ((value ^ (value >>> 15)) >>> 0) / 4294967296;
  };
}

/** グラフ用アバターURL (サイズを64pxに抑えて帯域を節約) */
function avatarForGraph(url: string | null | undefined): string {
  if (!url) return DEFAULT_AVATAR_URL;
  if (url.includes("size=")) return url.replace(/size=d+/, "size=64");
  return url.includes("?") ? url + "&size=64" : url + "?size=64";
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

/** VRCX-0のNODE_DIM_STRENGTH相当: 背景色へ混ぜて落とす */
function dimColor(hex: string, background: string, strength: number): string {
  const [r1, g1, b1] = hexToRgb(hex);
  const [r2, g2, b2] = hexToRgb(background);
  const mix = (a: number, b: number) => Math.round(a + (b - a) * strength);
  return `rgb(${mix(r1, r2)},${mix(g1, g2)},${mix(b1, b2)})`;
}

interface CommunityInfo {
  index: number;
  name: string;
  color: string;
  size: number;
  named: boolean;
}

interface SigmaLike {
  kill(): void;
  refresh(options?: { skipIndexation?: boolean }): void;
  getCamera(): {
    setState(state: { x?: number; y?: number; ratio?: number; angle?: number }): void;
  };
  on(event: string, handler: (payload: { node: string; edge?: string }) => void): SigmaLike;
}

export default function RelationGraphView({
  period,
}: {
  period: { key: string; year: number | null; month: number | null; isAll: boolean };
}) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const [data, setData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [layoutRunning, setLayoutRunning] = useState(false);
  const [layoutProgress, setLayoutProgress] = useState(0);
  const [communities, setCommunities] = useState<CommunityInfo[]>([]);
  const [focused, setFocused] = useState<{ id: string; label: string } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sigmaRef = useRef<SigmaLike | null>(null);
  const workerRef = useRef<Worker | null>(null);

  const base = period.isAll
    ? "/graph/relation/total"
    : `/graph/relation/${period.year}/${period.month}`;

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setFailed(false);
    setFocused(null);
    fetchAPI(base, { retries: 1, timeout: 120000 })
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

  // ===== sigma.js 描画 (VRCX-0: Louvainコミュニティ + ForceAtlas2) =====
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !data || data.nodes.length === 0) return;

    let disposed = false;
    let sigma: SigmaLike | null = null;
    setLayoutRunning(true);

    const run = async () => {
      const { default: Sigma } = await import("sigma");
      if (disposed) return;

      const palette = isDark ? DARK_PALETTE : LIGHT_PALETTE;
      const neutralColor = isDark ? "#6b7280" : "#a1a8b3";
      const backgroundColor = isDark ? "#0a0a0a" : "#ffffff";
      const edgeColor = isDark ? "#242c37" : "#dfe4ea";
      const edgeCrossColor = isDark ? "#4d5f78" : "#a3b0c2";
      const edgeActiveColor = isDark ? "#8fa3bd" : "#64748b";
      const labelColor = isDark ? "#e2e8f0" : "#111827";

      const graph = new Graph({ type: "undirected", multi: false, allowSelfLoops: false });
      for (const node of data.nodes) {
        graph.addNode(node.user_id, {
          label: node.display_name,
          size: 3 + 9 * Math.sqrt(node.count / maxCount),
          count: node.count,
          topChannel: node.top_channel,
          image: avatarForGraph(node.avatar),
          x: (Math.random() - 0.5) * 100,
          y: (Math.random() - 0.5) * 100,
        });
      }
      for (const edge of data.edges) {
        if (!graph.hasEdge(edge.a, edge.b) && graph.hasNode(edge.a) && graph.hasNode(edge.b)) {
          graph.addEdgeWithKey(`${edge.a}|${edge.b}`, edge.a, edge.b, { weight: edge.weight });
        }
      }

      // Louvainコミュニティ検出 (決定的シード)
      let rawCommunities: Record<string, number | string> = {};
      if (graph.size > 0) {
        try {
          rawCommunities = louvain(graph, { rng: seededRandom(0x9e3779b9), resolution: 1 }) as Record<
            string,
            number | string
          >;
        } catch {
          rawCommunities = {};
        }
      }

      // コミュニティごとのメンバーと代表チャンネル (界隈名)
      const members = new Map<string, GraphNode[]>();
      for (const node of data.nodes) {
        const key = String(rawCommunities[node.user_id] ?? "isolated");
        const bucket = members.get(key);
        if (bucket) bucket.push(node);
        else members.set(key, [node]);
      }
      const ranked = [...members.values()].sort((a, b) => b.length - a.length);
      const communityOf = new Map<string, number>();
      const communityInfos: CommunityInfo[] = [];
      ranked.forEach((memberNodes, index) => {
        const named = memberNodes.length >= MIN_NAMED_SIZE && index < NAMED_COMMUNITY_LIMIT;
        // コミュニティ内で最も多い主活動チャンネルを界隈名にする
        const channelCount = new Map<string, number>();
        for (const node of memberNodes) {
          if (!node.top_channel) continue;
          channelCount.set(node.top_channel, (channelCount.get(node.top_channel) ?? 0) + 1);
        }
        const dominant = [...channelCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        for (const node of memberNodes) communityOf.set(node.user_id, index);
        communityInfos.push({
          index,
          name: dominant ?? "その他",
          color: named ? palette[index % palette.length] : neutralColor,
          size: memberNodes.length,
          named,
        });
      });
      setCommunities(communityInfos);

      graph.forEachNode((node) => {
        const index = communityOf.get(node) ?? -1;
        const info = communityInfos[index];
        graph.setNodeAttribute(node, "community", index);
        graph.setNodeAttribute(node, "color", info ? info.color : neutralColor);
      });

      // レイアウト計算はワーカーへ (VRCX-0と同じ構成)。進捗を表示しつつUIをブロックしない
      const worker = new Worker(new URL("../../lib/relationLayout.worker.ts", import.meta.url));
      workerRef.current = worker;
      worker.onerror = () => {
        if (!disposed) {
          setLayoutRunning(false);
          setLayoutProgress(0);
        }
      };
      worker.postMessage({
        nodes: data.nodes.map((node) => ({
          id: node.user_id,
          x: graph.getNodeAttribute(node.user_id, "x"),
          y: graph.getNodeAttribute(node.user_id, "y"),
        })),
        edges: data.edges.map((edge) => ({ source: edge.a, target: edge.b })),
        iterations: 800,
        spacing: 60,
      });
      worker.onmessage = (event: MessageEvent) => {
        const payload = event.data as
          | { type: "progress"; progress: number }
          | { type: "done"; positions: Record<string, { x: number; y: number }> }
          | { type: "error"; message: string };
        if (payload.type === "progress") {
          setLayoutProgress(payload.progress);
          return;
        }
        if (payload.type === "error") {
          console.error("layout worker:", payload.message);
          setLayoutRunning(false);
          return;
        }
        for (const [id, pos] of Object.entries(payload.positions)) {
          if (graph.hasNode(id)) {
            graph.setNodeAttribute(id, "x", pos.x);
            graph.setNodeAttribute(id, "y", pos.y);
          }
        }
        worker.terminate();
        if (disposed) {
          sigmaRef.current = null;
          setLayoutRunning(false);
          return;
        }
        setLayoutProgress(100);

      const neighborSet = new Set<string>();
      let hovered: string | null = null;

      sigma = new Sigma(graph, container, {
        primitives: {
          nodes: {
            shapes: [sdfCircle()],
            layers: [layerFill(), layerImage({ drawingMode: "image", imageAttribute: "image", padding: 0.06 })],
          },
        },
        settings: {
          labelDensity: 0.7,
          labelGridCellSize: 140,
          labelRenderedSizeThreshold: 10,
          minCameraRatio: 0.08,
          maxCameraRatio: 12,
        },
        styles: {
          nodes: {
            labelColor: labelColor,
          },
          edges: {
            color: edgeColor,
            size: 0.4,
          },
        },
        nodeReducer: ((
          node: string,
          data: Partial<Record<string, unknown>>,
          attrs: Record<string, unknown>,
        ) => {
          // sigma v4のdisplay dataはカスタム属性を運ばないため、ここでimageを注入する
          const res: Record<string, unknown> = { ...data, image: attrs.image };
          if (hovered) {
            if (node === hovered) {
              res.size = Number(data.size ?? 0) * 1.55;
              res.forceLabel = true;
              res.zIndex = 2;
            } else if (neighborSet.has(node)) {
              res.forceLabel = true;
              res.zIndex = 1;
            } else {
              res.color = dimColor(String(data.color ?? neutralColor), backgroundColor, 0.9);
            }
          }
          return res;
        }) as unknown as NodeReducer,
        edgeReducer: ((edge: string, data: Partial<Record<string, unknown>>) => {
          const res: Record<string, unknown> = { ...data };
          const [source, target] = graph.extremities(edge);
          const isCross = communityOf.get(source) !== communityOf.get(target);
          if (hovered) {
            if (source === hovered || target === hovered) {
              res.color = edgeActiveColor;
              res.size = 2;
              res.zIndex = 1;
            } else {
              res.hidden = true;
            }
          } else {
            res.color = isCross ? edgeCrossColor : edgeColor;
            res.size = isCross ? 0.75 : 0.4;
          }
          return res;
        }) as unknown as EdgeReducer,
      }) as unknown as SigmaLike;

      // グラフ全体が収まるようにカメラを合わせる
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      graph.forEachNode((_node, attrs) => {
        minX = Math.min(minX, attrs.x);
        maxX = Math.max(maxX, attrs.x);
        minY = Math.min(minY, attrs.y);
        maxY = Math.max(maxY, attrs.y);
      });
      const width = Math.max(maxX - minX, 1);
      const height = Math.max(maxY - minY, 1);
      sigma.getCamera().setState({
        x: (minX + maxX) / 2,
        y: (minY + maxY) / 2,
        ratio: Math.max(width, height) * 1.1,
        angle: 0,
      });

      sigma.on("enterNode", ({ node }) => {
        hovered = node;
        neighborSet.clear();
        graph.forEachNeighbor(node, (neighbor) => neighborSet.add(neighbor));
        sigma?.refresh();
      });
      sigma.on("leaveNode", () => {
        hovered = null;
        neighborSet.clear();
        sigma?.refresh();
      });
      sigma.on("clickNode", ({ node }) => {
        const attrs = graph.getNodeAttributes(node);
        setFocused({ id: node, label: String(attrs.label ?? "") });
      });

      sigmaRef.current = sigma;
      setLayoutRunning(false);
      setLayoutProgress(100);
      };
    };

    void run();

    return () => {
      disposed = true;
      sigmaRef.current = null;
      workerRef.current?.terminate();
      workerRef.current = null;
      sigma?.kill();
    };
  }, [data, isDark, maxCount]);

  const topPairs = useMemo(() => {
    if (!data) return [];
    const byId = new Map(data.nodes.map((node) => [node.user_id, node]));
    return [...data.edges]
      .slice(0, 8)
      .map((edge) => ({ edge, a: byId.get(edge.a), b: byId.get(edge.b) }))
      .filter((pair) => pair.a && pair.b);
  }, [data]);

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
        <div className="h-[620px] animate-pulse rounded-2xl bg-muted" />
      </div>
    );
  }

  const focusedNode = focused
    ? data.nodes.find((node) => node.user_id === focused.id) ?? null
    : null;

  return (
    <div className="space-y-5">
      <PageToolbar
        title="関係性"
        subtitle={`${title}にアクティブだったメンバー${data.nodes.length}人の関係値グラフ (界隈=コミュニティごとに色分け)`}
        right={<PeriodPicker period={period} mode="query" />}
      />

      {data.nodes.length === 0 ? (
        <div className="app-card-padded text-center text-sm text-muted-foreground">
          この期間にデータがありません。
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="app-card relative overflow-hidden xl:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
              <div>
                <p className="text-sm font-black text-foreground">メンバーの関係値グラフ</p>
                <p className="mt-0.5 text-xs font-bold text-muted-foreground">
                  同じチャンネルで発言しているメンバー同士を線で結び、
                  界隈 (コミュニティ検出) ごとに色分けしました。
                </p>
              </div>
              <div className="flex gap-4 text-xs font-bold text-muted-foreground">
                <span>メンバー {data.nodes.length}人</span>
                <span>結び付き {data.edges.length}本</span>
              </div>
            </div>
            <div ref={containerRef} className="relative h-[620px] w-full bg-transparent" />
            {layoutRunning && (
              <div className="absolute inset-0 top-[57px] grid place-items-center bg-canvas/60 backdrop-blur-[2px]">
                <div className="rounded-full bg-card px-4 py-2 text-xs font-black text-foreground shadow">
                  レイアウト計算中… {layoutProgress}%
                </div>
              </div>
            )}
            {focusedNode && (
              <div className="absolute right-4 top-4 w-56 rounded-xl border border-border bg-card p-4 shadow-lg">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-black leading-snug text-foreground">
                    {focusedNode.display_name}
                  </p>
                  <button
                    type="button"
                    aria-label="閉じる"
                    onClick={() => setFocused(null)}
                    className="text-xs font-bold text-muted-foreground hover:text-foreground"
                  >
                    ✕
                  </button>
                </div>
                <p className="mt-1 text-xs font-bold text-muted-foreground">
                  {focusedNode.count.toLocaleString("ja-JP")}件 ・
                  {focusedNode.top_channel ?? "その他"}
                </p>
                <a
                  href={`/members/${focusedNode.user_id}?m=${period.key}`}
                  className="mt-3 block rounded-lg bg-accent-data px-3 py-1.5 text-center text-xs font-black text-white hover:opacity-90"
                >
                  メンバー詳細へ
                </a>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="app-card-padded">
              <p className="text-sm font-black text-foreground">界隈 (コミュニティ)</p>
              <p className="mt-0.5 mb-3 text-xs font-bold text-muted-foreground">
                自動検出したグループと代表チャンネル
              </p>
              <ul className="space-y-1.5 text-xs font-bold">
                {communities.filter((community) => community.size >= 2).slice(0, 9).map((community) => (
                  <li key={community.index} className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span
                        className="h-3 w-3 shrink-0 rounded-full"
                        style={{ backgroundColor: community.color }}
                      />
                      <span
                        className={`truncate ${community.named ? "text-foreground" : "text-muted-foreground"}`}
                      >
                        {community.named ? community.name : "その他"}
                      </span>
                    </span>
                    <span className="shrink-0 text-muted-foreground">{community.size}人</span>
                  </li>
                ))}
                {(() => {
                  const isolated = communities
                    .filter((community) => community.size < 2)
                    .reduce((sum, community) => sum + community.size, 0);
                  if (isolated === 0) return null;
                  return (
                    <li className="flex items-center justify-between gap-2 border-t border-border pt-1.5 text-muted-foreground">
                      <span className="truncate">孤立メンバー</span>
                      <span className="shrink-0">{isolated}人</span>
                    </li>
                  );
                })()}
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
          </div>
        </div>
      )}
    </div>
  );
}
