"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import Graph from "graphology";
import noverlap from "graphology-layout-noverlap";
import type { Attributes } from "graphology-types";
import type { EdgeReducer, NodeReducer } from "sigma/types";
import louvain from "graphology-communities-louvain";
import PageToolbar from "@/components/shell/PageToolbar";
import PeriodPicker from "@/components/shell/PeriodPicker";
import { BoostBadge, ServerTagChip, UserAvatar } from "./discord/DiscordIdentity";
import { DEFAULT_AVATAR_URL } from "./RankTopCard";
import { fetchAPI } from "@/lib/api";
import { formatDiscordDate, profileBannerStyle, snowflakeToDate } from "@/lib/discord-assets";
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
function avatarForGraph(url: string | null | undefined, renderSize: number): string {
  // 大きく表示されるアイコンほど高解像度で取得する
  const wanted = renderSize >= 16 ? 256 : renderSize >= 8 ? 128 : 64;
  if (!url) return DEFAULT_AVATAR_URL;
  if (url.includes("size=")) return url.replace(/size=\d+/, "size=" + wanted);
  return url.includes("?") ? url + "&size=" + wanted : url + "?size=" + wanted;
}

const CROP_SIZE = 96;

let cachedFallbackCircle: string | null = null;

/** デフォルトアバターの円形クロップ。失敗した場合は単色円を生成する */
async function circularFallbackAvatar(): Promise<string> {
  if (cachedFallbackCircle) return cachedFallbackCircle;
  try {
    cachedFallbackCircle = cropToCircle(await loadImageElement(DEFAULT_AVATAR_URL));
  } catch {
    const canvas = document.createElement("canvas");
    canvas.width = CROP_SIZE;
    canvas.height = CROP_SIZE;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#99aab5";
      ctx.beginPath();
      ctx.arc(CROP_SIZE / 2, CROP_SIZE / 2, CROP_SIZE / 2, 0, Math.PI * 2);
      ctx.fill();
      cachedFallbackCircle = canvas.toDataURL("image/png");
    }
  }
  return cachedFallbackCircle ?? DEFAULT_AVATAR_URL;
}

/** 画像を円形にクロップしたdataURLを返す。ringColor指定時は外周にリングを焼き込む
 * (node-imageレイヤーは円形クリップを行わないため)。リング幅は全員一定 (画素ベース) */
function cropToCircle(img: HTMLImageElement, ringColor?: string, ringFraction?: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = CROP_SIZE;
  canvas.height = CROP_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return avatarForGraph(img.src, 64);
  const center = CROP_SIZE / 2;
  ctx.beginPath();
  ctx.arc(center, center, center, 0, Math.PI * 2);
  ctx.closePath();
  if (ringColor) {
    // 外周リング (焼き込み)
    ctx.fillStyle = ringColor;
    ctx.fill();
  }
  const innerRadius = ringColor ? Math.max(center * (1 - (ringFraction ?? 0.2)) - 1.5, 1) : center;
  ctx.save();
  ctx.beginPath();
  ctx.arc(center, center, innerRadius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(img, 0, 0, CROP_SIZE, CROP_SIZE);
  ctx.restore();
  return canvas.toDataURL("image/webp", 0.85);
}

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("load error"));
    img.src = url;
  });
}

/** 全アバターを円形クロップし、user_id → dataURL のマップを返す。
 * クロップ結果は (URL+リング色+太さ) ごとにキャッシュして再計算を避ける */
async function cropAvatars(
  nodes: { user_id: string; avatar: string | null }[],
  ringFor: (userId: string) => { color: string; fraction: number },
  sizeFor: (userId: string) => number,
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  let done = 0;
  const BATCH = 64;
  for (let i = 0; i < nodes.length; i += BATCH) {
    const batch = nodes.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (node) => {
        const url = avatarForGraph(node.avatar, sizeFor(node.user_id));
        const ring = ringFor(node.user_id);
        const cacheKey = `${url}|${ring.color}|${Math.round(ring.fraction * 100)}`;
        const cachedCrop = cropCache.get(cacheKey);
        result.set(node.user_id, cachedCrop ?? (await cropUncached(url, ring)));
        done += 1;
        onProgress?.(done, nodes.length);
      }),
    );
  }
  return result;
}

async function cropUncached(
  url: string,
  ring: { color: string; fraction: number },
): Promise<string> {
  try {
    const cropped = cropToCircle(await loadImageElement(url), ring.color, ring.fraction);
    cropCache.set(`${url}|${ring.color}|${Math.round(ring.fraction * 100)}`, cropped);
    return cropped;
  } catch {
    return circularFallbackAvatar();
  }
}

interface CommunityInfo {
  index: number;
  name: string;
  color: string;
  size: number;
  named: boolean;
}

/** /graph/relation のレスポンスキャッシュ (月次=10分 / 全期間=1日 = backendのTTLに準拠) */
const graphFetchCache = new Map<string, { ts: number; nodes: GraphNode[]; edges: GraphEdge[] }>();

/** 円形クロップ画像のキャッシュ (元URL+リング色+リング太さごと) */
const cropCache = new Map<string, string>();

/** 計算済みレイアウト (テーマ切替時に再計算しないための保持)。dataオブジェクトごとに保持 */
interface LayoutRecord {
  positions: Map<string, { x: number; y: number }>;
  assignment: Map<string, number>;
  infos: Array<{ index: number; name: string; size: number; named: boolean }>;
}
const layoutStore = new WeakMap<object, LayoutRecord>();

interface SigmaLike {
  kill(): void;
  refresh(options?: { skipIndexation?: boolean }): void;
  getNodeDisplayData(node: string): { x: number; y: number } | null;
  getCamera(): {
    setState(state: { x?: number; y?: number; ratio?: number; angle?: number }): void;
  };
  on(
    event: string,
    handler: (payload: { node?: string; edge?: string; event?: unknown }) => void,
  ): SigmaLike;
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
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [cardData, setCardData] = useState<UserInsightsCard | null>(null);
  const [focused, setFocused] = useState<{ id: string } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sigmaRef = useRef<SigmaLike | null>(null);
  /** 界隈一覧をホバー中のコミュニティ (その界隈だけを表示する) */
  const communityFilterRef = useRef<number | null>(null);
  /** 界隈一覧カードの開閉 (モバイルでは初期状態を閉じる) */
  const [communitiesOpen, setCommunitiesOpen] = useState(true);
  useEffect(() => {
    if (window.innerWidth < 768) setCommunitiesOpen(false);
  }, []);

  const base = period.isAll
    ? "/graph/relation/total"
    : `/graph/relation/${period.year}/${period.month}`;

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setFailed(false);
    setFocused(null);

    // 取得キャッシュ (テーマ切替や行き来した場合の再読み込みを防ぐ)。
    // キャッシュ済みオブジェクトをそのままstateにする (オブジェクト同一性が
    // 切れるとレイアウトのWeakMapキャッシュが効かなくなるため)
    const ttl = period.isAll ? 86400000 : 600000;
    const cached = graphFetchCache.get(base);
    if (cached && Date.now() - cached.ts < ttl) {
      setData(cached);
      return;
    }

    fetchAPI(base, { retries: 1, timeout: 120000 })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { nodes: GraphNode[]; edges: GraphEdge[] };
        // 表示は上位500人まで。500位の発言数が501位と同率なら、その発言数の
        // メンバーは全員除外する (同率の一部だけ表示されることがないように)
        const sorted = [...body.nodes].sort((a, b) => b.count - a.count);
        let capped = sorted.slice(0, 500);
        const countAtBoundary = capped[capped.length - 1]?.count ?? 0;
        const countAfterBoundary = sorted[500]?.count ?? -1;
        if (countAtBoundary > 0 && countAtBoundary === countAfterBoundary) {
          capped = capped.filter((node) => node.count !== countAtBoundary);
        }
        const cappedIds = new Set(capped.map((node) => node.user_id));
        const payload = {
          nodes: capped,
          edges: body.edges.filter((edge) => cappedIds.has(edge.a) && cappedIds.has(edge.b)),
        };
        // stateにもキャッシュにも同じオブジェクトを入れる (同一性維持)
        const stored = { ts: Date.now(), nodes: payload.nodes, edges: payload.edges };
        graphFetchCache.set(base, stored);
        if (!cancelled) setData(stored);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [base, period.isAll]);

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
      const [{ default: Sigma }, rendering, nodeImage] = await Promise.all([
        import("sigma"),
        import("sigma/rendering"),
        import("@sigma/node-image"),
      ]);
      const { sdfCircle } = rendering;
      const { layerImage } = nodeImage;
      if (disposed) return;

      const palette = isDark ? DARK_PALETTE : LIGHT_PALETTE;
      const neutralColor = isDark ? "#6b7280" : "#a1a8b3";
      const backgroundColor = isDark ? "#0a0a0a" : "#ffffff";
      const edgeColor = isDark ? "#242c37" : "#dfe4ea";
      const edgeCrossColor = isDark ? "#4d5f78" : "#a3b0c2";
      const edgeActiveColor = isDark ? "#8fa3bd" : "#64748b";
      const labelColor = isDark ? "#e2e8f0" : "#111827";

      const graph = new Graph({ type: "undirected", multi: false, allowSelfLoops: false });
      // サイズは発言数に比例 (アイコンの面積が発言数に比例: √スケール)。
      // 発言数が多い人ほど明確に大きく表示される
      const __sizes: number[] = [];
      const sizeByName = new Map<string, number>();
      for (const node of data.nodes) {
        const __size = 3 + 37 * Math.sqrt(node.count / maxCount);
        __sizes.push(__size);
        sizeByName.set(node.user_id, __size);
        graph.addNode(node.user_id, {
          label: node.display_name,
          size: __size,
          count: node.count,
          topChannel: node.top_channel,
          x: (Math.random() - 0.5) * 100,
          y: (Math.random() - 0.5) * 100,
        });
      }
      for (const edge of data.edges) {
        if (!graph.hasEdge(edge.a, edge.b) && graph.hasNode(edge.a) && graph.hasNode(edge.b)) {
          graph.addEdgeWithKey(`${edge.a}|${edge.b}`, edge.a, edge.b, { weight: edge.weight });
        }
      }

      // 計算済みレイアウトがあれば界隈検出をやり直さない (テーマ切替等の再計算を防ぐ)
      const cachedLayout = layoutStore.get(data);
      let communityOf: Map<string, number>;
      let communityInfos: CommunityInfo[];
      if (cachedLayout) {
        // 界隈の割当と情報は再利用。パレット色 (テーマ依存) のみ組み直す
        communityOf = cachedLayout.assignment;
        communityInfos = cachedLayout.infos.map((info) => ({
          ...info,
          color: info.named ? palette[info.index % palette.length] : neutralColor,
        }));
      } else {
        // Louvainコミュニティ検出 (決定的シード)
        let rawCommunities: Record<string, number | string> = {};
        if (graph.size > 0) {
          try {
            rawCommunities = louvain(graph, {
              rng: seededRandom(0x9e3779b9),
              resolution: 1,
            }) as Record<string, number | string>;
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
        communityOf = new Map<string, number>();
        communityInfos = [];
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
      }
      setCommunities(communityInfos);

      graph.forEachNode((node) => {
        const index = communityOf.get(node) ?? -1;
        const info = communityInfos[index];
        graph.setNodeAttribute(node, "community", index);
        graph.setNodeAttribute(node, "color", info ? info.color : neutralColor);
      });

      // アバターを円形クロップし、界隈色のリング (全員ほぼ一定の太さ) を焼き込む。
      // クロップ完了までの進捗をレイアウト進捗の前半として表示する
      const croppedAvatars = await cropAvatars(
        data.nodes,
        (userId) => {
          const info = communityInfos[communityOf.get(userId) ?? -1];
          const size = Number((graph.getNodeAttributes(userId) as { size?: number })?.size ?? 10);
          // リング幅を全員ほぼ一定 (約3単位) にする。小さいアイコンでは上限0.4で抑える
          return {
            color: info ? info.color : neutralColor,
            fraction: Math.min(0.4, 3 / Math.max(size, 2.5)),
          };
        },
        (userId) => Number((graph.getNodeAttributes(userId) as { size?: number })?.size ?? 8),
        (done: number, total: number) => {
          if (!disposed) setLayoutProgress(Math.round((done / total) * 50));
        },
      );
      if (disposed) return;
      graph.forEachNode((node) => {
        graph.setNodeAttribute(node, "image", croppedAvatars.get(node) ?? DEFAULT_AVATAR_URL);
      });

      // レイアウト: 全体で「一つの円」。最大界隈は中央の円盤、他の界隈は
      // 外側の円環を扇形に分割して配置する。隙間はできず、界隈ごとに固まり、
      // 発言数が多い人ほど内側 (=画面中央寄り) に配置される。
      // 計算済みレイアウトがあれば再利用し、無ければ計算して保存する
      if (cachedLayout) {
        graph.forEachNode((node) => {
          const p = cachedLayout.positions.get(node);
          if (p) graph.mergeNodeAttributes(node, { x: p.x, y: p.y });
        });
      } else {
        const groups = new Map<number, string[]>();
        graph.forEachNode((node, attrs) => {
          const bucket = groups.get(attrs.community) ?? [];
          bucket.push(node);
          groups.set(attrs.community, bucket);
        });
        const nodeRadius = new Map<string, number>();
        graph.forEachNode((node, attrs) => {
          nodeRadius.set(node, Math.max(Number(attrs.size) * 1.12, 2.8));
        });
        const areaOf = (userId: string): number => {
          const r = nodeRadius.get(userId) ?? 3;
          return Math.PI * r * r;
        };
        const groupArea = new Map<number, number>();
        for (const [communityIndex, members] of groups) {
          groupArea.set(
            communityIndex,
            members.reduce((sum, member) => sum + areaOf(member), 0),
          );
        }
        const totalArea = [...groupArea.values()].reduce((a, b) => a + b, 0);
        const R = Math.sqrt((totalArea * 1.35) / Math.PI);

        // 発言数降順で内側の輪から埋める扇形フィラー
        const fillRadial = (
          members: string[],
          thetaStart: number,
          thetaEnd: number,
          rInner: number,
          rOuter: number,
        ) => {
          const sorted = [...members]
            .map((member) => ({
              member,
              count: Number((graph.getNodeAttributes(member) as { count?: number })?.count ?? 0),
            }))
            .sort((a, b) => b.count - a.count)
            .map((entry) => entry.member);
          const span = thetaEnd - thetaStart;
          const step = 14;
          let index = 0;
          for (let r = rInner; r <= rOuter && index < sorted.length; r += step) {
            const arc = Math.max(span * r, step);
            const capacity = Math.max(1, Math.floor(arc / step));
            const n = Math.min(capacity, sorted.length - index);
            for (let j = 0; j < n; j += 1) {
              const theta = thetaStart + (span * (j + 0.5)) / n;
              const member = sorted[index];
              index += 1;
              localPositions.set(member, { x: Math.cos(theta) * r, y: Math.sin(theta) * r });
            }
          }
        };

        const localPositions = new Map<string, { x: number; y: number }>();
        // 最大界隈を中央の円盤に
        const ordered = [...groups.keys()].sort(
          (a, b) => (groupArea.get(b) ?? 0) - (groupArea.get(a) ?? 0),
        );
        const biggest = ordered[0];
        const biggestArea = groupArea.get(biggest) ?? 0;
        const innerDiscRadius = Math.sqrt((biggestArea * 1.4) / Math.PI);
        fillRadial(groups.get(biggest) ?? [], 0, Math.PI * 2, 8, innerDiscRadius);

        // 残りの界隈を外側の円環に扇形で配置 (面積に比例)
        const others = ordered.slice(1);
        const othersArea = others.reduce(
          (sum, communityIndex) => sum + (groupArea.get(communityIndex) ?? 0),
          0,
        );
        let thetaCursor = -Math.PI / 2;
        for (const communityIndex of others) {
          const members = groups.get(communityIndex) ?? [];
          const area = groupArea.get(communityIndex) ?? 0;
          const span = othersArea > 0 ? (Math.PI * 2 * area) / othersArea : 0;
          fillRadial(members, thetaCursor, thetaCursor + span, innerDiscRadius + 4, R);
          thetaCursor += span;
        }

        graph.forEachNode((node, attrs) => {
          const p = localPositions.get(node);
          if (p) graph.mergeNodeAttributes(node, { x: p.x, y: p.y });
        });
        // 残った僅かな重なりを解消 (隙間が出ないようmargin最小)
        noverlap.assign(graph, {
          maxIterations: 200,
          settings: { ratio: 1, margin: 1, gridSize: 40 },
        });
        // 間隔を1.5倍に広げる (アイコンサイズは据え置き。sigmaが全体を収めるため
        // 相対的に隙間が1.5倍になる)
        {
          let minX = Infinity;
          let maxX = -Infinity;
          let minY = Infinity;
          let maxY = -Infinity;
          graph.forEachNode((node, attrs) => {
            minX = Math.min(minX, attrs.x);
            maxX = Math.max(maxX, attrs.x);
            minY = Math.min(minY, attrs.y);
            maxY = Math.max(maxY, attrs.y);
          });
          const centerX = (minX + maxX) / 2;
          const centerY = (minY + maxY) / 2;
          graph.forEachNode((node, attrs) => {
            graph.mergeNodeAttributes(node, {
              x: centerX + (attrs.x - centerX) * 1.5,
              y: centerY + (attrs.y - centerY) * 1.5,
            });
          });
        }
        // 再計算を避けるため、計算済みのレイアウトと界隈割当を保存する
        const positions = new Map<string, { x: number; y: number }>();
        graph.forEachNode((node, attrs) => {
          positions.set(node, { x: attrs.x, y: attrs.y });
        });
        layoutStore.set(data, {
          positions,
          assignment: communityOf,
          infos: communityInfos.map(({ index, name, size, named }) => ({
            index,
            name,
            size,
            named,
          })),
        });
      }
      setLayoutProgress(100);

      // この間にページ遷移等でアンマウントされた場合、ここから先は実行しない
      // (切断済みコンテナへのrenderで "Container has no width" が出てしまうため)
      if (disposed || container.isConnected === false) return;

      const neighborSet = new Set<string>();
      let hovered: string | null = null;
      // カメラ操作 (ズーム/パン) 中は enter/leave が連発して点滅するため、
      // 変更を「保留」にして操作終了後に確実に反映する (取りこぼしも点滅もなし)
      let cameraInteracting = false;
      let interactTimer: number | undefined;
      let pendingHover: string | null | undefined;
      const applyPendingHover = () => {
        if (pendingHover === undefined) return;
        hovered = pendingHover;
        pendingHover = undefined;
        neighborSet.clear();
        if (hovered) graph.forEachNeighbor(hovered, (neighbor) => neighborSet.add(neighbor));
        sigma?.refresh();
      };
      const markCameraInteracting = (hold: number) => {
        cameraInteracting = true;
        if (interactTimer) window.clearTimeout(interactTimer);
        interactTimer = window.setTimeout(() => {
          cameraInteracting = false;
          applyPendingHover();
        }, hold);
      };
      container.addEventListener("wheel", () => markCameraInteracting(450), { passive: true });
      container.addEventListener("pointerdown", () => markCameraInteracting(450));
      container.addEventListener("pointerup", () => markCameraInteracting(180));
      container.addEventListener("pointerleave", () => markCameraInteracting(180));

      sigma = new Sigma(graph, container, {
        primitives: {
          nodes: {
            shapes: [sdfCircle()],
            layers: [
              // リングはクロップ画像に焼き込み済みなので、画像レイヤーのみ
              layerImage({ drawingMode: "image", imageAttribute: "image", padding: 0 }),
            ],
          },
        },
        settings: {
          labelDensity: 0.7,
          labelGridCellSize: 140,
          labelRenderedSizeThreshold: 999,
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
          // sigma v4ではreducerのdataにグラフ属性 (size/label/color等) が含まれないため、
          // attrs (グラフ属性) から明示的に運ぶ必要がある
          const res: Record<string, unknown> = {
            ...data,
            label: attrs.label,
            size: attrs.size,
            color: attrs.color,
            image: attrs.image,
            borderColor: attrs.color,
          };
          // 界隈フィルタ中はその界隈のメンバーだけ表示し、名前を常に出す
          if (communityFilterRef.current !== null) {
            if ((communityOf.get(node) ?? -1) === communityFilterRef.current) {
              res.forceLabel = true;
              res.labelVisibility = "visible";
              res.zIndex = 2;
            } else {
              res.visibility = "hidden";
            }
          }
          if (hovered) {
            if (node === hovered) {
              res.forceLabel = true;
              res.labelVisibility = "visible";
              res.zIndex = 2;
            } else if (neighborSet.has(node)) {
              // 関係がある人たちの名前をすべて表示する
              res.forceLabel = true;
              res.labelVisibility = "visible";
              res.zIndex = 1;
            } else {
              // 関係のない人は非表示
              res.visibility = "hidden";
            }
          }
          return res;
        }) as unknown as NodeReducer,
        edgeReducer: ((edge: string, data: Partial<Record<string, unknown>>) => {
          const res: Record<string, unknown> = { ...data };
          const [source, target] = graph.extremities(edge);
          const isCross = communityOf.get(source) !== communityOf.get(target);
          // 界隈フィルタ中は同じ界隈内の結び付きのみ表示する
          if (communityFilterRef.current !== null) {
            if (
              communityOf.get(source) !== communityFilterRef.current ||
              communityOf.get(target) !== communityFilterRef.current
            ) {
              res.visibility = "hidden";
            }
          }
          if (hovered) {
            if (source === hovered || target === hovered) {
              res.color = edgeActiveColor;
              res.size = 2;
              res.zIndex = 1;
            } else {
              res.visibility = "hidden";
            }
          } else {
            res.color = isCross ? edgeCrossColor : edgeColor;
            res.size = isCross ? 0.75 : 0.4;
          }
          return res;
        }) as unknown as EdgeReducer,
      }) as unknown as SigmaLike;

      sigma.on("enterNode", ({ node }) => {
        const next = node ?? null;
        if (cameraInteracting) {
          pendingHover = next;
          return;
        }
        hovered = next;
        neighborSet.clear();
        graph.forEachNeighbor(next, (neighbor) => neighborSet.add(neighbor));
        sigma?.refresh();
      });
      sigma.on("leaveNode", () => {
        if (cameraInteracting) {
          pendingHover = null;
          return;
        }
        hovered = null;
        neighborSet.clear();
        sigma?.refresh();
      });
      sigma.on("clickNode", ({ node }) => {
        if (typeof node !== "string") return;
        setFocused({ id: node });
      });

      sigmaRef.current = sigma;
      (globalThis as unknown as Record<string, unknown>).__sigma = sigma;
      (globalThis as unknown as Record<string, unknown>).__graph = graph;
      setLayoutRunning(false);
      setLayoutProgress(100);
    };

    void run();

    return () => {
      disposed = true;
      sigmaRef.current = null;
      sigma?.kill();
    };
  }, [data, isDark, maxCount]);

  /** メンバー詳細ページ (/users/{id}/insights) と同じ形状のプロフィール部分 */
  interface UserInsightsCard {
    user: {
      user_id: string;
      display_name: string;
      username: string;
      avatar: string | null;
      avatar_fallback?: string | null;
      banner: string | null;
      accent_color: string | null;
      avatar_decoration: string | null;
      nameplate: { asset: string; palette: string } | null;
      primary_guild_tag: string | null;
      primary_guild_badge: string | null;
      joined_at: string | null;
      premium_since: string | null;
    } | null;
    messages: number;
  }

  const searchMatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!data || !q) return [];
    return data.nodes
      .filter(
        (node) =>
          node.display_name.toLowerCase().includes(q) || node.username.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [data, searchQuery]);

  // 選択中メンバーの詳細 (バナー・タグ・参加日など) を取得
  useEffect(() => {
    if (!focused) {
      setCardData(null);
      return;
    }
    let cancelled = false;
    setCardData(null);
    const path = period.isAll
      ? "/users/" + focused.id + "/insights/total"
      : "/users/" + focused.id + "/insights/" + period.year + "/" + period.month;
    fetchAPI(path, { retries: 1 })
      .then(async (res) => {
        if (!res.ok) return;
        const body = (await res.json()) as UserInsightsCard;
        if (!cancelled) setCardData(body);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [focused, period]);

  const focusUser = (userId: string) => {
    setFocused({ id: userId });
    const sigma = sigmaRef.current;
    if (!sigma) return;
    try {
      const display = sigma.getNodeDisplayData(userId);
      if (display) {
        sigma.getCamera().setState({ x: display.x, y: display.y, ratio: 0.35 });
      }
    } catch {
      // 表示データが取得できない場合は無視
    }
  };

  const title = period.isAll ? "全期間" : periodLabel(period);

  // フルスクリーンステージ: グラフが画面全体、パネルはフローティングポップアップ (VRCX-0風)
  if (!data) {
    return (
      <div className="fixed inset-0 top-14 grid place-items-center bg-canvas md:left-72 md:top-0">
        <div className="h-10 w-72 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  const focusedNode = focused
    ? (data.nodes.find((node) => node.user_id === focused.id) ?? null)
    : null;

  if (failed) {
    return (
      <div className="fixed inset-0 top-14 grid place-items-center bg-canvas md:left-72 md:top-0">
        <p className="text-sm font-bold text-muted-foreground">データの読み込みに失敗しました。</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 top-14 z-30 flex flex-col bg-canvas md:left-72 md:top-0">
      {/* グラフ (全画面) */}
      <div ref={containerRef} className="absolute inset-0 touch-none" />

      {/* 上部: タイトル + 期間ピッカー + 検索 (モバイルでは縦積み、PCでは横並び) */}
      <div className="absolute left-3 right-3 top-3 z-20 flex flex-col gap-2 md:left-4 md:right-4 md:top-4 md:flex-row md:items-center md:gap-3">
        <div className="rounded-xl border border-border bg-card/95 px-3.5 py-2.5 shadow-lg backdrop-blur">
          <p className="text-sm font-black text-foreground">共通のかかわり</p>
          <p className="mt-0.5 text-xs font-bold text-muted-foreground">
            {title}にアクティブだったメンバー{data.nodes.length}人 ・ 結び付き
            {data.edges.length}本
          </p>
          <p className="mt-0.5 hidden text-[11px] font-bold text-muted-foreground md:block">
            ドラッグで視点移動 / ホイールでズーム / アイコンをクリックで詳細
          </p>
        </div>
        <div className="shrink-0 self-start rounded-xl border border-border bg-card/95 p-2 shadow-lg backdrop-blur md:self-auto">
          <PeriodPicker period={period} mode="query" />
        </div>
        <div className="w-full shrink-0 md:ml-auto md:w-72">
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => {
              window.setTimeout(() => setSearchOpen(false), 150);
            }}
            placeholder="メンバーを検索…"
            className="w-full rounded-xl border border-border bg-card/95 px-4 py-2 text-sm font-bold text-foreground shadow-lg backdrop-blur outline-none placeholder:text-muted-foreground"
          />
          {searchOpen && searchMatches.length > 0 && (
            <div className="mt-1 max-h-64 overflow-y-auto rounded-xl border border-border bg-card/95 shadow-lg backdrop-blur">
              {searchMatches.map((match) => (
                <button
                  key={match.user_id}
                  type="button"
                  onClick={() => {
                    focusUser(match.user_id);
                    setSearchQuery("");
                    setSearchOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-bold text-foreground transition-colors hover:bg-muted"
                >
                  <img
                    src={avatarForGraph(match.avatar, 8)}
                    alt=""
                    className="h-6 w-6 rounded-full"
                  />
                  <span className="truncate">{match.display_name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 左下: 界隈一覧 (開閉式。ホバーでその界隈だけを表示する) */}
      <div className="absolute bottom-3 left-3 z-10 max-h-[60dvh] w-72 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-xl border border-border bg-card/95 shadow-xl backdrop-blur md:bottom-4 md:left-4">
        <button
          type="button"
          onClick={() => setCommunitiesOpen((open) => !open)}
          aria-expanded={communitiesOpen}
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
        >
          <span className="min-w-0">
            <span className="block text-sm font-black text-foreground">
              界隈 (コミュニティ){" "}
              <span className="font-bold text-muted-foreground">
                {communities.filter((c) => c.size >= 2).length}
              </span>
            </span>
            {communitiesOpen && (
              <span className="mt-0.5 block text-xs font-bold text-muted-foreground">
                自動検出したグループと代表チャンネル
              </span>
            )}
          </span>
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${communitiesOpen ? "" : "rotate-180"}`}
            aria-hidden="true"
          >
            <path d="M3 10l5-5 5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {communitiesOpen && (
          <ul className="space-y-1 px-4 pb-3 text-xs font-bold">
            {communities
              .filter((community) => community.size >= 2)
              .slice(0, 9)
              .map((community) => (
                <li
                  key={community.index}
                  onMouseEnter={() => {
                    // この界隈のメンバーだけをグラフに表示する
                    communityFilterRef.current = community.index;
                    sigmaRef.current?.refresh();
                  }}
                  onMouseLeave={() => {
                    communityFilterRef.current = null;
                    sigmaRef.current?.refresh();
                  }}
                  className="flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-muted"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: community.color }}
                    />
                    <span
                      className={
                        "truncate " +
                        (community.named ? "text-foreground" : "text-muted-foreground")
                      }
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
                <li className="flex items-center justify-between gap-2 border-t border-border px-2 pt-1.5 text-muted-foreground">
                  <span className="truncate">孤立メンバー</span>
                  <span className="shrink-0">{isolated}人</span>
                </li>
              );
            })()}
          </ul>
        )}
      </div>

      {/* 右下: 選択中メンバーの情報カード (メンバー詳細ページと同じプロフィール) */}
      {focusedNode &&
        focused &&
        (() => {
          const insights = cardData?.user ?? null;
          // 詳細取得中でも選択ノードの情報で最低限のカードを出す
          const identity = insights ?? {
            user_id: focusedNode.user_id,
            display_name: focusedNode.display_name,
            username: focusedNode.username,
            avatar: focusedNode.avatar,
            avatar_fallback: null,
            banner: null,
            accent_color: null,
            avatar_decoration: null,
            nameplate: null,
            primary_guild_tag: null,
            primary_guild_badge: null,
            joined_at: null,
            premium_since: null,
          };
          const accountCreatedAt = snowflakeToDate(focusedNode.user_id);
          return (
            <div className="absolute bottom-4 right-4 z-30 w-72 overflow-hidden rounded-xl border border-border bg-card shadow-xl">
              <div
                className="h-20 w-full"
                style={profileBannerStyle({
                  banner: identity.banner,
                  accentColor: identity.accent_color,
                  userId: focusedNode.user_id,
                })}
              />
              <div className="px-4 pb-4">
                <div className="-mt-9 mb-2">
                  <UserAvatar user={identity} size={64} />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-black leading-snug text-foreground">
                    {identity.display_name}
                  </p>
                  <ServerTagChip
                    tag={identity.primary_guild_tag}
                    badge={identity.primary_guild_badge}
                  />
                  {identity.premium_since && <BoostBadge />}
                </div>
                <p className="text-xs font-bold text-muted-foreground">@{identity.username}</p>
                <dl className="mt-2 space-y-1 text-xs font-bold text-muted-foreground">
                  <div className="flex justify-between gap-2">
                    <dt>発言数</dt>
                    <dd className="truncate text-foreground">
                      {(cardData?.messages ?? focusedNode.count).toLocaleString("ja-JP")}件
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>主なチャンネル</dt>
                    <dd className="truncate text-foreground">
                      {focusedNode.top_channel ?? "その他"}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>参加日</dt>
                    <dd className="truncate text-foreground">
                      {identity.joined_at ? formatDiscordDate(identity.joined_at) : "—"}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>アカウント作成日</dt>
                    <dd className="truncate text-foreground">
                      {formatDiscordDate(accountCreatedAt?.toISOString() ?? null)}
                    </dd>
                  </div>
                </dl>
                <a
                  href={"/members/" + focusedNode.user_id + "?m=" + period.key}
                  className="mt-3 block rounded-lg bg-accent-data px-3 py-1.5 text-center text-xs font-black text-white hover:opacity-90"
                >
                  メンバー詳細を見る
                </a>
                <button
                  type="button"
                  onClick={() => setFocused(null)}
                  className="mt-2 block w-full text-center text-[11px] font-bold text-muted-foreground hover:text-foreground"
                >
                  閉じる
                </button>
              </div>
            </div>
          );
        })()}

      {/* 読み込み中表示 */}
      {layoutRunning && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-canvas/70">
          <div className="rounded-full border border-border bg-card px-4 py-2 text-xs font-black text-foreground shadow-lg">
            {layoutProgress < 50
              ? "アバター準備中… " + layoutProgress * 2 + "%"
              : "レイアウト計算中… " + Math.round((layoutProgress - 50) * 2) + "%"}
          </div>
        </div>
      )}
    </div>
  );
}
