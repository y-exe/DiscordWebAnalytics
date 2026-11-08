"use client";

import { useEffect, useState, type ReactNode } from "react";
import { GripVertical } from "lucide-react";

interface Item {
  id: string;
  node: ReactNode;
}

/**
 * カードをドラッグで並べ替え可能にするラッパー (comcom風)。
 * 並び順はlocalStorageに保存され、再訪時も維持される。
 */
export default function Reorderable({ storageKey, items }: { storageKey: string; items: Item[] }) {
  const [order, setOrder] = useState<string[] | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw) as string[];
        const ids = new Set(items.map((item) => item.id));
        const valid = saved.filter((id) => ids.has(id));
        const rest = items.map((item) => item.id).filter((id) => !valid.includes(id));
        setOrder([...valid, ...rest]);
        return;
      }
    } catch {
      // 破損した保存値は無視
    }
    setOrder(items.map((item) => item.id));
    // itemsのid構成は安定している前提
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const ordered = useMemoOrder(items, order);

  const persist = (next: string[]) => {
    setOrder(next);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // 保存できない環境では無視
    }
  };

  const handleDragOver = (targetId: string) => {
    if (!draggingId || draggingId === targetId) return;
    const current = ordered.map((item) => item.id);
    const from = current.indexOf(draggingId);
    const to = current.indexOf(targetId);
    if (from === -1 || to === -1) return;
    current.splice(to, 0, ...current.splice(from, 1));
    persist(current);
  };

  return (
    <>
      {ordered.map((item) => (
        <div
          key={item.id}
          className={`group/reorder relative ${draggingId === item.id ? "opacity-50" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            handleDragOver(item.id);
          }}
        >
          <button
            type="button"
            draggable
            onDragStart={() => setDraggingId(item.id)}
            onDragEnd={() => setDraggingId(null)}
            aria-label="カードを移動"
            className="absolute right-1 top-1/2 z-10 hidden h-6 w-6 -translate-y-1/2 cursor-grab place-items-center rounded-md text-muted-foreground/50 hover:bg-muted hover:text-foreground group-hover/reorder:grid active:cursor-grabbing"
          >
            <GripVertical className="h-4 w-4" />
          </button>
          {item.node}
        </div>
      ))}
    </>
  );
}

function useMemoOrder(items: Item[], order: string[] | null): Item[] {
  if (!order) return items;
  const map = new Map(items.map((item) => [item.id, item]));
  const result: Item[] = [];
  for (const id of order) {
    const item = map.get(id);
    if (item) {
      result.push(item);
      map.delete(id);
    }
  }
  for (const item of map.values()) result.push(item);
  return result;
}
