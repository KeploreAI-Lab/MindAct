import React, { useState, useEffect, useRef } from "react";
import { TreeNode } from "../store";

interface Props {
  nodes: TreeNode[];
  onFileClick: (node: TreeNode) => void;
  onFileDelete?: (node: TreeNode) => void;
  activeFile?: string | null;
  filterQuery?: string;
}

function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  if (!query) return nodes;
  const q = query.toLowerCase();
  return nodes.flatMap(n => {
    if (n.type === "file") {
      return n.name.toLowerCase().includes(q) ? [n] : [];
    }
    const children = filterTree(n.children || [], query);
    return children.length ? [{ ...n, children }] : [];
  });
}

export default function FileTree({ nodes, onFileClick, onFileDelete, activeFile, filterQuery }: Props) {
  const displayed = filterQuery ? filterTree(nodes, filterQuery) : nodes;
  return (
    <div style={{ fontSize: 12, userSelect: "none" }}>
      {displayed.map(n => (
        <FileNode key={n.path} node={n} depth={0} onFileClick={onFileClick} onFileDelete={onFileDelete} activeFile={activeFile} />
      ))}
    </div>
  );
}

function FileNode({ node, depth, onFileClick, onFileDelete, activeFile }: {
  node: TreeNode; depth: number;
  onFileClick: (n: TreeNode) => void;
  onFileDelete?: (n: TreeNode) => void;
  activeFile?: string | null;
}) {
  const [open, setOpen] = useState(true);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const isActive = node.path === activeFile;

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  if (node.type === "dir") {
    return (
      <div>
        <div
          onClick={() => setOpen(!open)}
          style={{
            display: "flex", alignItems: "center", gap: 4,
            padding: `3px 8px 3px ${8 + depth * 14}px`,
            cursor: "pointer", color: "#ccc",
          }}
          onMouseEnter={e => (e.currentTarget.style.background = "#2a2a2a")}
          onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
        >
          <span style={{ fontSize: 10, width: 10, textAlign: "center" }}>{open ? "▾" : "▸"}</span>
          <span style={{ fontSize: 16 }}>📁</span>
          <span>{node.name}</span>
        </div>
        {open && node.children?.map(c => (
          <FileNode key={c.path} node={c} depth={depth + 1} onFileClick={onFileClick} onFileDelete={onFileDelete} activeFile={activeFile} />
        ))}
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      <div
        onClick={() => onFileClick(node)}
        onContextMenu={e => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}
        style={{
          display: "flex", alignItems: "center", gap: 4,
          padding: `3px 8px 3px ${8 + depth * 14 + 14}px`,
          cursor: "pointer",
          background: isActive ? "#094771" : "transparent",
          color: isActive ? "#fff" : "#bbb",
          borderLeft: isActive ? "2px solid #007acc" : "2px solid transparent",
        }}
        onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = "#2a2a2a"; }}
        onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
      >
        <span style={{ fontSize: 14 }}>{fileIcon(node.name)}</span>
        <span>{node.name}</span>
      </div>

      {menu && (
        <div
          ref={menuRef}
          style={{
            position: "fixed", left: menu.x, top: menu.y,
            background: "#252526", border: "1px solid #444", borderRadius: 4,
            zIndex: 9999, minWidth: 140, boxShadow: "0 4px 16px #0008",
          }}
        >
          <div
            onClick={() => { setMenu(null); onFileDelete?.(node); }}
            style={{
              padding: "7px 14px", cursor: "pointer", color: "#e05555", fontSize: 12,
              display: "flex", alignItems: "center", gap: 8,
            }}
            onMouseEnter={e => (e.currentTarget.style.background = "#3a1a1a")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
          >
            🗑 删除文件
          </div>
        </div>
      )}
    </div>
  );
}

function fileIcon(name: string): string {
  if (name.endsWith(".md")) return "📝";
  if (name.endsWith(".ts") || name.endsWith(".tsx")) return "📘";
  if (name.endsWith(".js") || name.endsWith(".jsx")) return "📒";
  if (name.endsWith(".json")) return "📋";
  if (name.endsWith(".py")) return "🐍";
  if (name.endsWith(".css")) return "🎨";
  if (name.endsWith(".html")) return "🌐";
  if (name.endsWith(".sh")) return "⚙️";
  return "📄";
}
