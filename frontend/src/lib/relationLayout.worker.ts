/**
 * 関係性グラフのレイアウト計算ワーカー (VRCX-0のgraphLayoutWorkerと同じ構成)。
 * ForceAtlas2 (Barnes-Hut) + noverlap をメインスレッドの外で走らせる。
 */
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import noverlap from "graphology-layout-noverlap";

interface WorkerNode {
  id: string;
  x: number;
  y: number;
}

interface WorkerEdge {
  source: string;
  target: string;
}

interface LayoutRequest {
  nodes: WorkerNode[];
  edges: WorkerEdge[];
  iterations: number;
  spacing: number;
}

const ctx = globalThis as unknown as {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
};

ctx.addEventListener("message", (event: MessageEvent) => {
  const { nodes, edges, iterations, spacing } = event.data as LayoutRequest;
  try {
    const graph = new Graph({ type: "undirected", multi: false, allowSelfLoops: false });
    for (const node of nodes) {
      graph.addNode(node.id, { x: node.x, y: node.y, size: 5 });
    }
    for (const edge of edges) {
      if (!graph.hasEdge(edge.source, edge.target)) {
        graph.addEdge(edge.source, edge.target);
      }
    }

    const chunk = 50;
    const total = Math.max(iterations, chunk);
    const inferred = forceAtlas2.inferSettings(graph);
    // 進捗を通知しながらチャンク実行 ( ForceAtlas2.assignは反復数の一括指定のみなので、
    // 少ない反復を繰り返して進捗を出す )
    let done = 0;
    const step = () => {
      const run = Math.min(chunk, total - done);
      forceAtlas2.assign(graph, {
        iterations: run,
        settings: {
          ...inferred,
          barnesHutOptimize: true,
          barnesHutTheta: 0.8,
          strongGravityMode: true,
          gravity: 1.38,
          scalingRatio: spacing,
          slowDown: 2,
        },
      });
      done += run;
      if (done < total) {
        ctx.postMessage({ type: "progress", progress: Math.round((done / total) * 100) });
        setTimeout(step, 0);
        return;
      }

      noverlap.assign(graph, {
        maxIterations: 60,
        settings: { ratio: 1.1, margin: 3, gridSize: 30 },
      });

      const positions: Record<string, { x: number; y: number }> = {};
      graph.forEachNode((node, attrs) => {
        positions[node] = { x: attrs.x, y: attrs.y };
      });
      ctx.postMessage({ type: "done", positions });
    };
    step();
  } catch (error) {
    ctx.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
