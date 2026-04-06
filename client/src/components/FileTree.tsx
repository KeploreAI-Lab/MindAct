import React, { useState } from "react";
import { TreeNode } from "../store";

interface Props {
  nodes: TreeNode[];
  onFileClick: (node: TreeNode) => void;
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

export default function FileTree({ nodes, onFileClick, activeFile, filterQuery }: Props) {
  const displayed = filterQuery ? filterTree(nodes, filterQuery) : nodes;
  return (
    <div style={{ fontSize: 12, userSelect: "none" }}>
      {displayed.map(n => (
        <FileNode key={n.path} node={n} depth={0} onFileClick={onFileClick} activeFile={activeFile} />
      ))}
    </div>
  );
}

function FileNode({ node, depth, onFileClick, activeFile }: {
  node: TreeNode; depth: number;
  onFileClick: (n: TreeNode) => void;
  activeFile?: string | null;
}) {
  const [open, setOpen] = useState(true);
  const isActive = node.path === activeFile;

  if (node.type === "dir") {
    return (
      <div>
        <div
          onClick={() => setOpen(!open)}
          style={{
            display: "flex", alignItems: "center", gap: 4,
            padding: `3px 8px 3px ${8 + depth * 14}px`,
            cursor: "pointer",
            color: "#ccc",
          }}
          onMouseEnter={e => (e.currentTarget.style.background = "#2a2a2a")}
          onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
        >
          <span style={{ fontSize: 10, width: 10, textAlign: "center" }}>{open ? "▾" : "▸"}</span>
          <span style={{ fontSize: 16 }}>📁</span>
          <span>{node.name}</span>
        </div>
        {open && node.children?.map(c => (
          <FileNode key={c.path} node={c} depth={depth + 1} onFileClick={onFileClick} activeFile={activeFile} />
        ))}
      </div>
    );
  }

  return (
    <div
      onClick={() => onFileClick(node)}
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
