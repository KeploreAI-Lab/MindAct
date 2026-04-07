import React, { useEffect, useRef, useCallback } from "react";
import { EditorState, Extension, RangeSetBuilder } from "@codemirror/state";
import {
  EditorView, ViewPlugin, DecorationSet, Decoration,
  ViewUpdate, keymap, lineNumbers, highlightActiveLine,
} from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import { autocompletion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { TreeNode } from "../store";

interface Props {
  path: string;
  content: string;
  readOnly?: boolean;
  vaultFiles?: TreeNode[];
  platformFiles?: TreeNode[];
  onSave?: (content: string) => void;
  onContentChange?: (content: string) => void;
  onLinkClick?: (name: string) => void;
  onCrossLinkClick?: (name: string) => void;
}

const wikiLinkMark = Decoration.mark({ class: "cm-wiki-link" });
const crossLinkMark = Decoration.mark({ class: "cm-cross-link" });

function buildLinkPlugin() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) { this.decorations = this.buildDecorations(view); }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) this.decorations = this.buildDecorations(update.view);
      }
      buildDecorations(view: EditorView): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();
        const wikiRe = /\[\[([^\]]+)\]\]/g;
        const crossRe = /\{\{([^}]+)\}\}/g;
        for (const { from, to } of view.visibleRanges) {
          const text = view.state.sliceDoc(from, to);
          // Collect all matches with their positions, then sort and add in order
          const marks: { start: number; end: number; deco: Decoration }[] = [];
          let m: RegExpExecArray | null;
          wikiRe.lastIndex = 0;
          while ((m = wikiRe.exec(text)) !== null) {
            marks.push({ start: from + m.index, end: from + m.index + m[0].length, deco: wikiLinkMark });
          }
          crossRe.lastIndex = 0;
          while ((m = crossRe.exec(text)) !== null) {
            marks.push({ start: from + m.index, end: from + m.index + m[0].length, deco: crossLinkMark });
          }
          marks.sort((a, b) => a.start - b.start);
          for (const { start, end, deco } of marks) builder.add(start, end, deco);
        }
        return builder.finish();
      }
    },
    { decorations: (v: any) => v.decorations }
  );
}

const linkStyles = EditorView.baseTheme({
  ".cm-wiki-link": {
    color: "#f0a500 !important",
    cursor: "pointer",
    textDecoration: "underline",
    textDecorationStyle: "dotted",
  },
  ".cm-cross-link": {
    color: "#7ec8e3 !important",
    cursor: "pointer",
    textDecoration: "underline",
    textDecorationStyle: "dashed",
    fontStyle: "italic",
  },
});

export default function Editor({ path, content, readOnly, vaultFiles, platformFiles, onSave, onContentChange, onLinkClick, onCrossLinkClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flatNames = useCallback((nodes: TreeNode[] | undefined): string[] => {
    if (!nodes) return [];
    const names: string[] = [];
    function walk(ns: TreeNode[]) {
      for (const n of ns) {
        if (n.type === "file" && n.name.endsWith(".md")) names.push(n.name.replace(/\.md$/, ""));
        if (n.children) walk(n.children);
      }
    }
    walk(nodes);
    return names;
  }, []);

  const flatVaultNames = useCallback(() => flatNames(vaultFiles), [vaultFiles, flatNames]);
  const flatPlatformNames = useCallback(() => flatNames(platformFiles), [platformFiles, flatNames]);

  useEffect(() => {
    if (!containerRef.current) return;

    const wikiLinkCompletion = (context: CompletionContext): CompletionResult | null => {
      const match = context.matchBefore(/\[\[[^\]]*$/);
      if (!match) return null;
      const query = match.text.slice(2);
      const names = flatVaultNames();
      return {
        from: match.from + 2,
        options: names
          .filter(n => n.toLowerCase().includes(query.toLowerCase()))
          .map(n => ({ label: n, apply: n + "]]" })),
      };
    };

    const crossLinkCompletion = (context: CompletionContext): CompletionResult | null => {
      const match = context.matchBefore(/\{\{[^}]*$/);
      if (!match) return null;
      const query = match.text.slice(2).trimStart();
      const names = flatPlatformNames();
      return {
        from: match.from + 2,
        options: names
          .filter(n => n.toLowerCase().includes(query.toLowerCase()))
          .map(n => ({ label: n, apply: " " + n + " }}" })),
      };
    };

    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLine(),
      history(),
      syntaxHighlighting(defaultHighlightStyle),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      markdown(),
      oneDark,
      buildLinkPlugin(),
      linkStyles,
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !readOnly) {
          const text = update.state.doc.toString();
          onContentChange?.(text);
          if (onSave) {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
            saveTimerRef.current = setTimeout(() => onSave(text), 800);
          }
        }
      }),
    ];

    if (!readOnly) {
      extensions.push(autocompletion({ override: [wikiLinkCompletion, crossLinkCompletion] }));
    } else {
      extensions.push(EditorState.readOnly.of(true));
    }

    extensions.push(
      EditorView.domEventHandlers({
        click(event, view) {
          const target = event.target as HTMLElement;
          const docText = view.state.doc.toString();
          const pos = view.posAtDOM(target);
          let m: RegExpExecArray | null;

          if (target.classList.contains("cm-wiki-link") && onLinkClick) {
            const re = /\[\[([^\]]+)\]\]/g;
            while ((m = re.exec(docText)) !== null) {
              if (pos >= m.index && pos <= m.index + m[0].length) { onLinkClick(m[1]); return true; }
            }
          }
          if (target.classList.contains("cm-cross-link") && onCrossLinkClick) {
            const re = /\{\{([^}]+)\}\}/g;
            while ((m = re.exec(docText)) !== null) {
              if (pos >= m.index && pos <= m.index + m[0].length) { onCrossLinkClick(m[1].trim()); return true; }
            }
          }
          return false;
        },
      })
    );

    const state = EditorState.create({ doc: content, extensions });
    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [path]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== content) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: content } });
    }
  }, [content]);

  return (
    <div
      ref={containerRef}
      style={{ flex: 1, overflow: "auto", height: "100%" }}
    />
  );
}
