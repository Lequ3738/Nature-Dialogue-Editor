import React, { useEffect, useMemo, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { RangeSetBuilder } from '@codemirror/state'
import { javascript } from '@codemirror/lang-javascript'

export type HighlightRule = {
  pattern: string
  color: string
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildRuleRegex(rules: HighlightRule[]) {
  const parts = rules
    .map((r) => r.pattern?.trim())
    .filter(Boolean)
    .map((p) => escapeRegExp(p))
  if (!parts.length) return null
  return new RegExp(`\\b(?:${parts.join('|')})\\b`, 'g')
}

export default function CodeEditor(props: {
  value: string
  onChange: (next: string) => void
  rules: HighlightRule[]
  height?: number
}) {
  const { value, onChange, rules, height = 160 } = props

  const [extensionsKey, setExtensionsKey] = useState(0)
  useEffect(() => {
    setExtensionsKey((k) => k + 1)
  }, [rules])

  const regex = useMemo(() => buildRuleRegex(rules), [rules])
  const colorMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of rules) {
      const k = r.pattern?.trim()
      const c = r.color?.trim()
      if (k && c) map.set(k, c)
    }
    return map
  }, [rules])

  const highlightPlugin = useMemo(() => {
    return ViewPlugin.fromClass(
      class {
        decorations: DecorationSet
        constructor(view: EditorView) {
          this.decorations = this.compute(view)
        }
        update(update: ViewUpdate) {
          if (update.docChanged || update.viewportChanged) {
            this.decorations = this.compute(update.view)
          }
        }
        compute(view: EditorView): DecorationSet {
          if (!regex || !colorMap.size) return Decoration.none
          const builder = new RangeSetBuilder<Decoration>()
          const text = view.state.doc.toString()
          let m: RegExpExecArray | null
          const local = new RegExp(regex.source, 'g')
          while ((m = local.exec(text))) {
            const match = m[0]
            const from = m.index
            const to = from + match.length
            const color = colorMap.get(match) ?? '#3b82f6'
            builder.add(
              from,
              to,
              Decoration.mark({
                attributes: { style: `color: ${color}; font-weight: 600;` },
              }),
            )
          }
          return builder.finish()
        }
      },
      {
        decorations: (v) => v.decorations,
      },
    )
  }, [colorMap, regex])

  const themeExt = useMemo(
    () =>
      EditorView.theme({
        '&': {
          fontFamily: 'Consolas, ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
          fontSize: '12px',
        },
        '.cm-gutters': {
          backgroundColor: 'transparent',
          borderRight: '1px solid rgba(127, 127, 127, 0.25)',
        },
      }),
    [],
  )

  const extensions = useMemo(
    () => [
      javascript(),
      themeExt,
      highlightPlugin,
    ],
    [highlightPlugin, themeExt],
  )

  return (
    <div style={{ border: '1px solid rgba(127, 127, 127, 0.35)', borderRadius: 8, overflow: 'hidden' }}>
      <CodeMirror
        key={extensionsKey}
        value={value}
        height={`${height}px`}
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          highlightActiveLine: true,
        }}
        extensions={extensions}
        onChange={(v) => onChange(v)}
      />
    </div>
  )
}

