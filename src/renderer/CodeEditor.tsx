import React, { useEffect, useMemo, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { RangeSetBuilder } from '@codemirror/state'
import { javascript } from '@codemirror/lang-javascript'
import { syntaxTree } from '@codemirror/language'

export type HighlightRule = {
  pattern: string
  color: string
}

export type CodeStyleProfile = {
  name: string
  fontFamily: string
  fontSize: number
  rules: HighlightRule[]
  functionColor: string
}

/**
 * 轻量代码编辑器封装（CodeMirror 6）：
 * - 行号
 * - 基础 JS 语法支持（@codemirror/lang-javascript）
 * - 用户自定义关键字高亮（pattern -> color）
 * - 函数名自动识别高亮（基于语法树）
 *
 * 注意：这里的“用户关键字高亮”不是完整语法高亮，只是便于用户快速标记自定义词汇。
 * 真正语法高亮仍由 CodeMirror 的语言包提供（我们只叠加装饰）。
 */
/**
 * 这里用“词边界 + 用户定义关键字列表”的方式做轻量高亮。
 * 优点：实现简单、可由用户直接配置；缺点：不是完整语法高亮。
 */
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
  profile: CodeStyleProfile
  theme: 'dark' | 'light'
  height?: number
}) {
  const { value, onChange, profile, theme, height = 160 } = props

  const [extensionsKey, setExtensionsKey] = useState(0)
  useEffect(() => {
    setExtensionsKey((k) => k + 1)
  }, [profile, theme])

  const rules = profile.rules
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
          if ((!regex || !colorMap.size) && !profile.functionColor) return Decoration.none
          const builder = new RangeSetBuilder<Decoration>()
          const text = view.state.doc.toString()

          // 1) 用户关键字高亮
          if (regex && colorMap.size) {
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
                  attributes: { style: `color: ${color}; font-weight: 650;` },
                }),
              )
            }
          }

          // 2) 函数名自动识别（基于语法树）：对函数声明/函数表达式/箭头函数的 name/变量名着色
          const funcColor = profile.functionColor?.trim()
          if (funcColor) {
            const tree = syntaxTree(view.state)
            tree.iterate({
              enter(node) {
                const t = node.type.name
                // FunctionDeclaration: name 通常是 Identifier
                if (t === 'FunctionDeclaration') {
                  // 向下找第一个 Identifier
                  const cur = node.node
                  let found = false
                  cur.firstChild && cur.firstChild
                  cur.cursor().iterate((c) => {
                    if (found) return false
                    if (c.type.name === 'Identifier') {
                      builder.add(
                        c.from,
                        c.to,
                        Decoration.mark({
                          attributes: { style: `color: ${funcColor}; font-weight: 650;` },
                        }),
                      )
                      found = true
                      return false
                    }
                    return undefined
                  })
                }
                // VariableDefinition + ArrowFunction / FunctionExpression 的组合：标记变量名
                if (t === 'VariableDefinition') {
                  const cur = node.node
                  const first = cur.firstChild
                  if (first && first.type.name === 'Identifier') {
                    builder.add(
                      first.from,
                      first.to,
                      Decoration.mark({
                        attributes: { style: `color: ${funcColor}; font-weight: 650;` },
                      }),
                    )
                  }
                }
              },
            })
          }

          return builder.finish()
        }
      },
      {
        decorations: (v) => v.decorations,
      },
    )
  }, [colorMap, profile.functionColor, regex])

  const themeExt = useMemo(
    () =>
      EditorView.theme({
        '&': {
          fontFamily: profile.fontFamily,
          fontSize: `${profile.fontSize}px`,
          backgroundColor: theme === 'light' ? '#ffffff' : '#111827',
          color: theme === 'light' ? '#0f172a' : '#e5e7eb',
        },
        '.cm-gutters': {
          backgroundColor: theme === 'light' ? '#f8fafc' : 'rgba(255,255,255,0.04)',
          borderRight: '1px solid rgba(127, 127, 127, 0.25)',
        },
        '.cm-content': {
          caretColor: theme === 'light' ? '#0f172a' : '#e5e7eb',
        },
      }),
    [profile.fontFamily, profile.fontSize, theme],
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
    <div
      style={{
        border: theme === 'light' ? '1px solid rgba(15,23,42,0.15)' : '1px solid rgba(255,255,255,0.12)',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
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

