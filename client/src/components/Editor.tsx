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
  onSave?: (content: string) => void;
  onLinkClick?: (name: string) => void;
}

const wikiLinkMark = Decoration.mark({ class: "cm-wiki-link" });

function buildWikiLinkPlugin(onLinkClick?: (name: string) => void) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = this.buildDecorations(update.view);
        }
      }
      buildDecorations(view: EditorView): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();
        const re = /\[\[([^\]]+)\]\]/g;
        for (const { from, to } of view.visibleRanges) {
          const text = view.state.sliceDoc(from, to);
          let m: RegExpExecArray | null;
          re.lastIndex = 0;
          while ((m = re.exec(text)) !== null) {
            builder.add(from + m.index, from + m.index + m[0].length, wikiLinkMark);
          }
        }
        return builder.finish();
      }
    },
    { decorations: (v: any) => v.decorations }
  );
}

const wikiLinkStyle = EditorView.baseTheme({
  ".cm-wiki-link": {
    color: "#f0a500 !important",
    cursor: "pointer",
    textDecoration: "underline",
    textDecorationStyle: "dotted",
  },
});

export default function Editor({ path, content, readOnly, vaultFiles, onSave, onLinkClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flatVaultNames = useCallback((): string[] => {
    if (!vaultFiles) return [];
    const names: string[] = [];
    function walk(nodes: TreeNode[]) {
      for (const n of nodes) {
        if (n.type === "file" && n.name.endsWith(".md")) names.push(n.name.replace(/\.md$/, ""));
        if (n.children) walk(n.children);
      }
    }
    walk(vaultFiles);
    return names;
  }, [vaultFiles]);

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

    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLine(),
      history(),
      syntaxHighlighting(defaultHighlightStyle),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      markdown(),
      oneDark,
      buildWikiLinkPlugin(onLinkClick),
      wikiLinkStyle,
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !readOnly && onSave) {
          if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
          saveTimerRef.current = setTimeout(() => {
            onSave(update.state.doc.toString());
          }, 800);
        }
      }),
    ];

    if (!readOnly) {
      extensions.push(autocompletion({ override: [wikiLinkCompletion] }));
    } else {
      extensions.push(EditorState.readOnly.of(true));
    }

    extensions.push(
      EditorView.domEventHandlers({
        click(event, view) {
          if (!onLinkClick) return false;
          const target = event.target as HTMLElement;
          if (!target.classList.contains("cm-wiki-link")) return false;
          const pos = view.posAtDOM(target);
          const docText = view.state.doc.toString();
          const re = /\[\[([^\]]+)\]\]/g;
          let m: RegExpExecArray | null;
          while ((m = re.exec(docText)) !== null) {
            if (pos >= m.index && pos <= m.index + m[0].length) {
              onLinkClick(m[1]);
              return true;
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
