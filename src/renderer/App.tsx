import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { DragTarget, EdgeType, EditorState, Resizing } from './editorTypes'
import { createInitialState } from './editorTypes'
import { addObject, hasEdge, makeGml, parseGmlEditorData, startConnect } from './editorLogic'
import fs from 'node:fs'

type ModalDraft = {
  cn: string
  en: string
  code: string
  color: string
}

const NODE_WIDTH = 260
const NODE_HEIGHT = 120
const PRESET_COLORS = [
  '#7289da',
  '#e67e22',
  '#43b581',
  '#f04747',
  '#00a8ff',
  '#9b59b6',
  '#f1c40f',
  '#2c3e50',
]

type FileHandle = FileSystemFileHandle

function ensureGmlName(name: string): string {
  const trimmed = (name || '').trim()
  if (!trimmed) return 'dialog_system.gml'
  return trimmed.toLowerCase().endsWith('.gml') ? trimmed : `${trimmed}.gml`
}

function getNodeAnchor(
  from: { x: number; y: number },
  to: { x: number; y: number },
  isSource: boolean,
): { x: number; y: number } {
  const centerFrom = { x: from.x + NODE_WIDTH / 2, y: from.y + NODE_HEIGHT / 2 }
  const centerTo = { x: to.x + NODE_WIDTH / 2, y: to.y + NODE_HEIGHT / 2 }
  const dx = centerTo.x - centerFrom.x
  const dy = centerTo.y - centerFrom.y

  const horizontal = Math.abs(dx) > Math.abs(dy)
  if (isSource) {
    if (horizontal) {
      return dx >= 0
        ? { x: from.x + NODE_WIDTH, y: centerFrom.y }
        : { x: from.x, y: centerFrom.y }
    }
    return dy >= 0
      ? { x: centerFrom.x, y: from.y + NODE_HEIGHT }
      : { x: centerFrom.x, y: from.y }
  }

  if (horizontal) {
    return dx >= 0
      ? { x: to.x, y: centerTo.y }
      : { x: to.x + NODE_WIDTH, y: centerTo.y }
  }
  return dy >= 0
    ? { x: centerTo.x, y: to.y }
    : { x: centerTo.x, y: to.y + NODE_HEIGHT }
}

export default function App() {
  const [state, setState] = useState<EditorState>(() => createInitialState())
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [currentFileName, setCurrentFileName] = useState<string>('新文件')
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null)
  const [currentFileHandle, setCurrentFileHandle] = useState<FileHandle | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const stateRef = useRef(state)
  const suppressDirtyRef = useRef(false)
  const firstStateRef = useRef(true)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState<ModalDraft>({ cn: '', en: '', code: '', color: '#7289da' })

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const lineCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const minimapCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const fileMenuRef = useRef<HTMLDivElement | null>(null)
  const [fileMenuOpen, setFileMenuOpen] = useState(false)

  const [windowSize, setWindowSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
  const zoomPercent = Math.round(state.view.zoom * 100)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    if (firstStateRef.current) {
      firstStateRef.current = false
      return
    }
    if (suppressDirtyRef.current) {
      suppressDirtyRef.current = false
      return
    }
    setIsDirty(true)
  }, [state])

  useEffect(() => {
    const titleName = currentFileName || '新文件'
    document.title = `${isDirty ? '*' : ''}${titleName} - Dialogue Editor`
  }, [currentFileName, isDirty])

  useEffect(() => {
    // 初始将视口移动到工作区中心
    setState((prev) => ({
      ...prev,
      view: {
        ...prev.view,
        x: window.innerWidth / 2 - 5000,
        y: window.innerHeight / 2 - 5000,
      },
    }))
  }, [])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!fileMenuOpen) return
      const el = fileMenuRef.current
      if (el && e.target instanceof Node && el.contains(e.target)) return
      setFileMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [fileMenuOpen])

  useEffect(() => {
    const onResize = () => setWindowSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Initialize canvas sizes.
  useEffect(() => {
    if (lineCanvasRef.current) {
      lineCanvasRef.current.width = 10000
      lineCanvasRef.current.height = 10000
    }
    if (minimapCanvasRef.current) {
      minimapCanvasRef.current.width = 180
      minimapCanvasRef.current.height = 130
    }
  }, [])

  const connectingFromId = state.connecting?.fromId ?? null

  const minimapMeta = useMemo(() => {
    const W = 180
    const H = 130
    const pad = 10

    let minX = 0
    let minY = 0
    let maxX = 10000
    let maxY = 10000

    if (state.nodes.length || state.comments.length) {
      minX = Number.POSITIVE_INFINITY
      minY = Number.POSITIVE_INFINITY
      maxX = Number.NEGATIVE_INFINITY
      maxY = Number.NEGATIVE_INFINITY

      state.nodes.forEach((n) => {
        minX = Math.min(minX, n.x)
        minY = Math.min(minY, n.y)
        maxX = Math.max(maxX, n.x + NODE_WIDTH)
        maxY = Math.max(maxY, n.y + NODE_HEIGHT)
      })
      state.comments.forEach((c) => {
        minX = Math.min(minX, c.x)
        minY = Math.min(minY, c.y)
        maxX = Math.max(maxX, c.x + c.w)
        maxY = Math.max(maxY, c.y + c.h)
      })

      if (!Number.isFinite(minX)) {
        minX = 0
        minY = 0
        maxX = 10000
        maxY = 10000
      }
    }

    const spanX = Math.max(1, maxX - minX)
    const spanY = Math.max(1, maxY - minY)
    const scale = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanY)
    const offsetX = pad - minX * scale
    const offsetY = pad - minY * scale

    // Visible world rect.
    const worldLeft = -state.view.x / state.view.zoom
    const worldTop = -state.view.y / state.view.zoom
    const worldW = windowSize.w / state.view.zoom
    const worldH = windowSize.h / state.view.zoom

    const viewLeft = worldLeft * scale + offsetX
    const viewTop = worldTop * scale + offsetY
    const viewW = worldW * scale
    const viewH = worldH * scale

    return {
      W,
      H,
      scale,
      offsetX,
      offsetY,
      bounds: { minX, minY, maxX, maxY },
      viewRect: { left: viewLeft, top: viewTop, width: viewW, height: viewH },
    }
  }, [state.nodes, state.comments, state.view.x, state.view.y, state.view.zoom, windowSize.w, windowSize.h])

  const minimapViewStyle = useMemo(
    () =>
      ({
        width: minimapMeta.viewRect.width + 'px',
        height: minimapMeta.viewRect.height + 'px',
        left: minimapMeta.viewRect.left + 'px',
        top: minimapMeta.viewRect.top + 'px',
      }) satisfies React.CSSProperties,
    [minimapMeta.viewRect.height, minimapMeta.viewRect.left, minimapMeta.viewRect.top, minimapMeta.viewRect.width],
  )

  // Draw edges whenever nodes/edges change.
  useEffect(() => {
    const canvas = lineCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, 10000, 10000)

    state.edges.forEach((edge) => {
      const from = state.nodes.find((n) => n.id === edge.fromId)
      const to = state.nodes.find((n) => n.id === edge.toId)
      if (!from || !to) return

      const start = getNodeAnchor(from, to, true)
      const end = getNodeAnchor(from, to, false)
      const startX = start.x
      const startY = start.y
      const endX = end.x
      const endY = end.y
      const curveStrength = Math.min(120, Math.max(40, Math.hypot(endX - startX, endY - startY) * 0.35))
      const cp1X = startX + (endX - startX) * 0.2
      const cp1Y = startY + (endY > startY ? curveStrength : -curveStrength)
      const cp2X = endX - (endX - startX) * 0.2
      const cp2Y = endY - (endY > startY ? curveStrength : -curveStrength)

      ctx.beginPath()
      ctx.moveTo(startX, startY)
      ctx.bezierCurveTo(cp1X, cp1Y, cp2X, cp2Y, endX, endY)

      if (edge.type === 'true') ctx.strokeStyle = '#43b581'
      else if (edge.type === 'false') ctx.strokeStyle = '#f04747'
      else ctx.strokeStyle = '#7289da'

      ctx.lineWidth = 3
      ctx.stroke()

      ctx.fillStyle = ctx.strokeStyle as string
      ctx.beginPath()
      ctx.arc(endX, endY, 5, 0, Math.PI * 2)
      ctx.fill()
    })
  }, [state.edges, state.nodes])

  // Draw minimap whenever nodes/comments change.
  useEffect(() => {
    const canvas = minimapCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, 180, 130)
    const { scale, offsetX, offsetY } = minimapMeta

    ctx.fillStyle = theme === 'light' ? '#64748b' : '#555'
    state.nodes.forEach((n) => ctx.fillRect(n.x * scale + offsetX, n.y * scale + offsetY, 5, 4))
    ctx.strokeStyle = theme === 'light' ? '#94a3b8' : '#333'
    state.comments.forEach((c) =>
      ctx.strokeRect(c.x * scale + offsetX, c.y * scale + offsetY, c.w * scale, c.h * scale),
    )
  }, [state.nodes, state.comments, minimapMeta, theme])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const onMouseDown = (e: MouseEvent) => {
      // Middle mouse button panning.
      if (e.button === 1) {
        e.preventDefault()
        setState((prev) => ({
          ...prev,
          isPanning: true,
          lastMouse: { x: e.clientX, y: e.clientY },
        }))
      }
    }

    const onMouseMove = (e: MouseEvent) => {
      setState((prev) => {
        let next = prev

        if (prev.isPanning && prev.lastMouse) {
          next = {
            ...next,
            view: {
              ...next.view,
              x: next.view.x + (e.clientX - prev.lastMouse.x),
              y: next.view.y + (e.clientY - prev.lastMouse.y),
            },
            lastMouse: { x: e.clientX, y: e.clientY },
          }
        }

        if (prev.dragTarget) {
          const drag = prev.dragTarget
          const dx = (e.clientX - drag.ox) / prev.view.zoom
          const dy = (e.clientY - drag.oy) / prev.view.zoom

          if (drag.kind === 'node') {
            next = {
              ...next,
              nodes: next.nodes.map((n) =>
                n.id === drag.id ? { ...n, x: n.x + dx, y: n.y + dy } : n,
              ),
              dragTarget: { ...drag, ox: e.clientX, oy: e.clientY },
            }
          } else {
            next = {
              ...next,
              comments: next.comments.map((c) =>
                c.id === drag.id ? { ...c, x: c.x + dx, y: c.y + dy } : c,
              ),
              dragTarget: { ...drag, ox: e.clientX, oy: e.clientY },
            }
          }
        }

        if (prev.resizing) {
          const zoom = prev.view.zoom
          const deltaW = (e.clientX - prev.resizing.ox) / zoom
          const deltaH = (e.clientY - prev.resizing.oy) / zoom
          next = {
            ...next,
            comments: next.comments.map((c) =>
              c.id === prev.resizing!.id ? { ...c, w: prev.resizing!.startW + deltaW, h: prev.resizing!.startH + deltaH } : c,
            ),
          }
        }

        return next
      })
    }

    const onMouseUp = () => {
      setState((prev) => ({
        ...prev,
        isPanning: false,
        lastMouse: undefined,
        dragTarget: null,
        resizing: null,
      }))
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setState((prev) => {
        const delta = e.deltaY > 0 ? 0.9 : 1.1
        const nextZoom = Math.min(Math.max(0.1, prev.view.zoom * delta), 2)

        // Zoom to mouse point.
        const mouseX = (e.clientX - prev.view.x) / prev.view.zoom
        const mouseY = (e.clientY - prev.view.y) / prev.view.zoom

        return {
          ...prev,
          view: {
            zoom: nextZoom,
            x: e.clientX - mouseX * nextZoom,
            y: e.clientY - mouseY * nextZoom,
          },
        }
      })
    }

    viewport.addEventListener('mousedown', onMouseDown)
    viewport.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)

    return () => {
      viewport.removeEventListener('mousedown', onMouseDown)
      viewport.removeEventListener('wheel', onWheel as any)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  const beginDrag = (e: React.MouseEvent, target: DragTarget) => {
    e.stopPropagation()
    e.preventDefault()
    setState((prev) => ({ ...prev, dragTarget: target }))
  }

  const beginResize = (e: React.MouseEvent, commentId: string) => {
    e.stopPropagation()
    e.preventDefault()
    const current = stateRef.current
    const c = current.comments.find((x) => x.id === commentId)
    if (!c) return

    const resizing: Resizing = {
      id: commentId,
      ox: e.clientX,
      oy: e.clientY,
      startW: c.w,
      startH: c.h,
    }
    setState((prev) => ({ ...prev, resizing }))
  }

  const openModal = (id: number) => {
    setEditingId(id)
    const n = state.nodes.find((x) => x.id === id)
    if (n) setDraft({ cn: n.cn, en: n.en, code: n.code, color: n.color })
  }

  const closeModal = () => {
    setEditingId(null)
  }

  const saveModal = () => {
    if (editingId === null) return
    setState((prev) => {
      const nextNodes = prev.nodes.map((n) => (n.id === editingId ? { ...n, cn: draft.cn, en: draft.en, code: draft.code, color: draft.color } : n))
      return { ...prev, nodes: nextNodes }
    })
    closeModal()
  }

  const deleteCurrent = () => {
    if (editingId === null) return
    setState((prev) => {
      const nextNodes = prev.nodes.filter((n) => n.id !== editingId)
      const nextEdges = prev.edges.filter((e) => e.fromId !== editingId && e.toId !== editingId)
      return { ...prev, nodes: nextNodes, edges: nextEdges }
    })
    closeModal()
  }

  const onExport = () => {
    const gml = makeGml(state)
    const blob = new Blob([gml], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = ensureGmlName(currentFileName === '新文件' ? 'dialog_system.gml' : currentFileName)
    a.click()
  }

  const onImport = (file: File) => {
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const parsed = parseGmlEditorData(text)
      if (!parsed) {
        alert('此文件不含编辑器元数据！')
        return
      }
      suppressDirtyRef.current = true
      setState(parsed)
      setEditingId(null)
      setIsDirty(false)
      const anyFile = file as any
      const path = typeof anyFile.path === 'string' ? anyFile.path : null
      setCurrentFileName(file.name || '新文件')
      setCurrentFilePath(path)
      setCurrentFileHandle(null)
    }
    reader.readAsText(file)
  }

  const handleOpenClick = async () => {
    setFileMenuOpen(false)

    // Prefer File System Access API (no save dialog on overwrite).
    const picker = (window as any).showOpenFilePicker as undefined | (() => Promise<FileHandle[]>)
    if (picker) {
      try {
        const [handle] = await picker()
        if (!handle) return
        const file = await handle.getFile()
        const text = await file.text()
        const parsed = parseGmlEditorData(text)
        if (!parsed) {
          alert('此文件不含编辑器元数据！')
          return
        }
        suppressDirtyRef.current = true
        setState(parsed)
        setEditingId(null)
        setIsDirty(false)
        setCurrentFileHandle(handle)
        setCurrentFilePath(null)
        setCurrentFileName(file.name || '新文件')
        return
      } catch (e) {
        // fall back
        console.warn(e)
      }
    }

    if (fileInputRef.current) fileInputRef.current.click()
  }

  const handleSave = async () => {
    const gml = makeGml(state)
    setFileMenuOpen(false)

    if (currentFileHandle) {
      try {
        const writable = await currentFileHandle.createWritable()
        await writable.write(gml)
        await writable.close()
        setIsDirty(false)
        return
      } catch (e) {
        console.error(e)
        alert('保存文件失败，已尝试使用“另存为”。')
        onExport()
        return
      }
    }

    if (currentFilePath) {
      try {
        fs.writeFileSync(currentFilePath, gml, 'utf8')
        setIsDirty(false)
        return
      } catch (e) {
        console.error(e)
        alert('保存文件失败，已尝试使用“另存为”。')
        onExport()
        return
      }
    }

    onExport()
  }

  const handleSaveAs = async () => {
    setFileMenuOpen(false)
    const gml = makeGml(state)
    const saver = (window as any).showSaveFilePicker as
      | undefined
      | ((opts?: any) => Promise<FileHandle>)
    if (saver) {
      try {
        const handle = await saver({
          suggestedName: ensureGmlName(currentFileName === '新文件' ? 'dialog_system.gml' : currentFileName),
          types: [
            {
              description: 'GML 文件',
              accept: { 'text/plain': ['.gml'] },
            },
          ],
        })
        const writable = await handle.createWritable()
        await writable.write(gml)
        await writable.close()
        const file = await handle.getFile()
        setCurrentFileHandle(handle)
        setCurrentFilePath(null)
        setCurrentFileName(file.name || '新文件')
        setIsDirty(false)
        return
      } catch (e) {
        console.warn(e)
      }
    }
    onExport()
  }

  const viewportTransformStyle = useMemo(
    () =>
      ({
        transform: `translate(${state.view.x}px, ${state.view.y}px) scale(${state.view.zoom})`,
      }) satisfies React.CSSProperties,
    [state.view.x, state.view.y, state.view.zoom],
  )

  return (
    <>
      <div id="toolbar">
        <button
          onClick={() => {
            setState((prev) => addObject(prev, 'node', windowSize.w, windowSize.h))
          }}
        >
          + 对话节点
        </button>
        <button
          onClick={() => {
            setState((prev) => addObject(prev, 'condition', windowSize.w, windowSize.h))
          }}
          style={{ background: '#e67e22' }}
        >
          + 条件判定
        </button>
        <button
          onClick={() => {
            setState((prev) => addObject(prev, 'comment', windowSize.w, windowSize.h))
          }}
          style={{ background: '#5865f2' }}
        >
          + 注释区域
        </button>
        <div style={{ flexGrow: 1 }} />
        <div className={`file-menu ${fileMenuOpen ? 'open' : ''}`} ref={fileMenuRef}>
          <button
            className="file-menu-button"
            onClick={(e) => {
              e.stopPropagation()
              setFileMenuOpen((v) => !v)
            }}
          >
            文件 ▾
          </button>
          <div className="file-menu-dropdown" role="menu">
            <button
              onClick={handleOpenClick}
            >
              打开...
            </button>
            <button
              onClick={() => void handleSave()}
              disabled={!isDirty && !currentFilePath && !currentFileHandle}
            >
              保存
            </button>
            <button onClick={() => void handleSaveAs()}>另存为...</button>
          </div>
        </div>
        <input
          type="file"
          ref={fileInputRef}
          id="importInput"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onImport(f)
          }}
        />
        <button
          className="theme-toggle"
          onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
        >
          {theme === 'dark' ? '🌙' : '☀'}
        </button>
      </div>

      <div id="viewport" ref={viewportRef}>
        <div id="content-layer" style={viewportTransformStyle}>
          <canvas id="line-canvas" ref={lineCanvasRef} />

          <div id="objects-container">
            {state.comments.map((c) => (
              <div
                key={c.id}
                className="comment-box"
                style={{ left: c.x, top: c.y, width: c.w, height: c.h }}
              >
                <div
                  className="comment-handle"
                  onMouseDown={(e) => beginDrag(e, { kind: 'comment', id: c.id, ox: e.clientX, oy: e.clientY })}
                >
                  {c.text}
                </div>
                <div
                  className="comment-resizer"
                  onMouseDown={(e) => beginResize(e, c.id)}
                />
              </div>
            ))}

            {state.nodes.map((n) => {
              const isCond = n.type === 'condition'
              const isConnecting = connectingFromId === n.id
              return (
                <div
                  key={n.id}
                  className="node"
                  style={{
                    left: n.x,
                    top: n.y,
                    borderColor: n.color,
                    boxShadow: isConnecting ? '0 0 20px #f1c40f' : undefined,
                  }}
                >
                  <div
                    className="node-header"
                    onMouseDown={(e) => beginDrag(e, { kind: 'node', id: n.id, ox: e.clientX, oy: e.clientY })}
                  >
                    <span>{isCond ? `CONDITION #${n.id}` : `DIALOGUE #${n.id}`}</span>
                    <span
                      style={{ cursor: 'pointer' }}
                      onClick={(e) => {
                        e.stopPropagation()
                        openModal(n.id)
                      }}
                    >
                      ⚙️
                    </span>
                  </div>

                  <div className="node-body">
                    {n.cn}
                    {n.en ? (
                      <>
                        <hr style={{ opacity: 0.2 }} />
                        {n.en}
                      </>
                    ) : null}
                  </div>

                  <div className="node-footer">
                    {isCond ? (
                      <>
                        <button
                          className={`port ${hasEdge(state, n.id, 'true') ? 'connected' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            setState((prev) => startConnect(prev, n.id, 'true'))
                          }}
                        >
                          TRUE
                        </button>
                        <button
                          className={`port ${hasEdge(state, n.id, 'false') ? 'connected' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            setState((prev) => startConnect(prev, n.id, 'false'))
                          }}
                        >
                          FALSE
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className={`port ${hasEdge(state, n.id, 'default') ? 'connected' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            setState((prev) => startConnect(prev, n.id, 'default'))
                          }}
                        >
                          NEXT →
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div id="minimap">
        <canvas
          id="minimap-canvas"
          ref={minimapCanvasRef}
          onMouseDown={(e) => {
            const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect()
            const mx = e.clientX - rect.left
            const my = e.clientY - rect.top
            const worldX = (mx - minimapMeta.offsetX) / minimapMeta.scale
            const worldY = (my - minimapMeta.offsetY) / minimapMeta.scale
            setState((prev) => ({
              ...prev,
              view: {
                ...prev.view,
                x: -worldX * prev.view.zoom + window.innerWidth / 2,
                y: -worldY * prev.view.zoom + window.innerHeight / 2,
              },
            }))
          }}
        />
        <div id="minimap-zoom">缩放: {zoomPercent}%</div>
        <div id="minimap-view" style={minimapViewStyle} />
      </div>

      {editingId !== null ? (
        <div
          id="modal-overlay"
          style={{
            display: 'flex',
          }}
        >
          <div id="modal">
            <h3 id="m-title" style={{ margin: 0 }}>
              节点配置
            </h3>

            <div className="lang-box">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={{ fontSize: 12, color: '#888' }}>中文</label>
                <textarea
                  id="m-cn"
                  rows={4}
                  value={draft.cn}
                  onChange={(e) => setDraft((d) => ({ ...d, cn: e.target.value }))}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={{ fontSize: 12, color: '#888' }}>英文</label>
                <textarea
                  id="m-en"
                  rows={4}
                  value={draft.en}
                  onChange={(e) => setDraft((d) => ({ ...d, en: e.target.value }))}
                />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={{ fontSize: 12, color: '#888' }}>执行代码</label>
              <textarea
                id="m-code"
                rows={5}
                value={draft.code}
                onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value }))}
              />
            </div>

            <div className="color-row">
              <label>自定义颜色:</label>
              <input
                type="color"
                id="m-color"
                value={draft.color}
                onChange={(e) => setDraft((d) => ({ ...d, color: e.target.value }))}
              />
              <div className="preset-color-list">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color}
                    className={`preset-color ${draft.color === color ? 'active' : ''}`}
                    style={{ background: color }}
                    onClick={() => setDraft((d) => ({ ...d, color }))}
                    title={color}
                  />
                ))}
              </div>
              <div style={{ flexGrow: 1 }} />
              <button onClick={deleteCurrent} style={{ background: '#f04747' }}>
                删除此节点
              </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={closeModal} style={{ background: '#4f545c' }}>
                取消
              </button>
              <button onClick={saveModal}>保存配置</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

