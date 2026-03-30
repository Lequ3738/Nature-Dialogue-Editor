import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { CommentBox, DragTarget, Edge, EdgeType, EditorState, Node, Resizing } from './editorTypes'
import { createInitialState } from './editorTypes'
import { addObject, hasEdge, makeGml, parseGmlEditorData, startConnect } from './editorLogic'
import fs from 'node:fs'
import CodeEditor, { type HighlightRule } from './CodeEditor'

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

function isFilePickerCancelled(err: unknown): boolean {
  const e = err as any
  const name = typeof e?.name === 'string' ? e.name : ''
  // File System Access API: user cancel is usually AbortError
  if (name === 'AbortError' || name === 'NotAllowedError') return true
  // Sometimes DOMException uses a numeric code.
  if (typeof e?.code === 'number' && e.code === 20) return true
  return false
}

function hexToRgba(hex: string, alpha: number): string {
  const h = (hex || '').trim().replace('#', '')
  if (h.length === 3) {
    const r = parseInt(h[0] + h[0], 16)
    const g = parseInt(h[1] + h[1], 16)
    const b = parseInt(h[2] + h[2], 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }
  if (h.length >= 6) {
    const r = parseInt(h.slice(0, 2), 16)
    const g = parseInt(h.slice(2, 4), 16)
    const b = parseInt(h.slice(4, 6), 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }
  return `rgba(0, 0, 0, ${alpha})`
}

function getIpcRenderer(): any | null {
  try {
    const req = (window as any).require
    if (typeof req !== 'function') return null
    const electron = req('electron')
    return electron?.ipcRenderer ?? null
  } catch {
    return null
  }
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
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [commentDraft, setCommentDraft] = useState<string>('')
  const [commentColorDraft, setCommentColorDraft] = useState<string>('#5865f2')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [highlightRules, setHighlightRules] = useState<HighlightRule[]>(() => {
    try {
      const raw = localStorage.getItem('dialogueEditor.highlightRules')
      if (!raw) return [{ pattern: 'if', color: '#3b82f6' }, { pattern: 'function', color: '#a855f7' }]
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      return parsed.filter(Boolean)
    } catch {
      return [{ pattern: 'if', color: '#3b82f6' }, { pattern: 'function', color: '#a855f7' }]
    }
  })
  const [highlightRulesText, setHighlightRulesText] = useState<string>('')

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const lineCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const minimapCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const fileMenuRef = useRef<HTMLDivElement | null>(null)
  const [fileMenuOpen, setFileMenuOpen] = useState(false)
  const [minimapSize, setMinimapSize] = useState(() => ({ w: 260, h: 180 }))
  const minimapResizeRef = useRef<null | { edge: 'left' | 'top'; ox: number; oy: number; w: number; h: number }>(null)

  const [windowSize, setWindowSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
  const zoomPercent = Math.round(state.view.zoom * 100)
  const isNewUntitled = currentFileName === '新文件' && !currentFilePath && !currentFileHandle
  const hasWorkspaceContent = state.nodes.length > 0 || state.comments.length > 0 || state.edges.length > 0
  const isNewEmpty = isNewUntitled && !hasWorkspaceContent

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    try {
      localStorage.setItem('dialogueEditor.highlightRules', JSON.stringify(highlightRules))
    } catch {
      // ignore
    }
  }, [highlightRules])

  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--view-x', String(state.view.x))
    root.style.setProperty('--view-y', String(state.view.y))
    root.style.setProperty('--view-zoom', String(state.view.zoom))
  }, [state.view.x, state.view.y, state.view.zoom])

  useEffect(() => {
    if (firstStateRef.current) {
      firstStateRef.current = false
      return
    }
    if (suppressDirtyRef.current) {
      suppressDirtyRef.current = false
      return
    }
    // 新文件且空白时，不认为是已修改（例如只做了平移/缩放）。
    if (isNewEmpty) return
    setIsDirty(true)
  }, [state])

  useEffect(() => {
    const titleName = currentFileName || '新文件'
    document.title = `${titleName}${isDirty ? '*' : ''} - 对话编辑器`
  }, [currentFileName, isDirty])

  useEffect(() => {
    const ipc = getIpcRenderer()
    if (!ipc) return
    ipc.send('editor:dirty', { dirty: isDirty, fileName: currentFileName })
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

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const cur = minimapResizeRef.current
      if (!cur) return
      const minW = 200
      const minH = 140
      const maxW = 520
      const maxH = 420

      if (cur.edge === 'left') {
        const dx = cur.ox - e.clientX
        const nextW = Math.max(minW, Math.min(maxW, cur.w + dx))
        setMinimapSize((s) => ({ ...s, w: nextW }))
      } else {
        const dy = cur.oy - e.clientY
        const nextH = Math.max(minH, Math.min(maxH, cur.h + dy))
        setMinimapSize((s) => ({ ...s, h: nextH }))
      }
    }
    const onUp = () => {
      minimapResizeRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  // Initialize canvas sizes.
  useEffect(() => {
    if (lineCanvasRef.current) {
      lineCanvasRef.current.width = 10000
      lineCanvasRef.current.height = 10000
    }
    if (minimapCanvasRef.current) {
      const dpr = window.devicePixelRatio || 1
      minimapCanvasRef.current.width = minimapSize.w * dpr
      minimapCanvasRef.current.height = minimapSize.h * dpr
    }
  }, [minimapSize.h, minimapSize.w])

  const connectingFromId = state.connecting?.fromId ?? null

  const minimapMeta = useMemo(() => {
    const W = minimapSize.w
    const H = minimapSize.h
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

    let viewLeft = worldLeft * scale + offsetX
    let viewTop = worldTop * scale + offsetY
    let viewW = worldW * scale
    let viewH = worldH * scale

    // Clamp viewport indicator inside minimap.
    viewW = Math.min(W, Math.max(0, viewW))
    viewH = Math.min(H, Math.max(0, viewH))
    viewLeft = Math.min(W - viewW, Math.max(0, viewLeft))
    viewTop = Math.min(H - viewH, Math.max(0, viewTop))

    return {
      W,
      H,
      scale,
      offsetX,
      offsetY,
      bounds: { minX, minY, maxX, maxY },
      viewRect: { left: viewLeft, top: viewTop, width: viewW, height: viewH },
    }
  }, [minimapSize.h, minimapSize.w, state.nodes, state.comments, state.view.x, state.view.y, state.view.zoom, windowSize.w, windowSize.h])

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

  // Draw minimap: render a scaled snapshot of the current workspace.
  useEffect(() => {
    const canvas = minimapCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const W = minimapMeta.W
    const H = minimapMeta.H
    const { scale, offsetX, offsetY } = minimapMeta

    // Reset transform and clear using physical pixels.
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    // Draw in CSS pixels.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // Background
    ctx.fillStyle = theme === 'light' ? '#f8fafc' : 'rgba(0,0,0,0.55)'
    ctx.fillRect(0, 0, W, H)

    // Grid (based on main grid spacing)
    const worldGrid = 40
    const miniGrid = worldGrid * scale
    const gridStep = Math.max(4, Math.min(14, miniGrid))
    const dot = theme === 'light' ? 'rgba(148,163,184,0.55)' : 'rgba(148,163,184,0.35)'
    ctx.fillStyle = dot
    const xStart = 0
    const yStart = 0
    for (let x = xStart; x <= W; x += gridStep) {
      for (let y = yStart; y <= H; y += gridStep) {
        ctx.fillRect(x, y, 1, 1)
      }
    }

    const worldToMini = (x: number, y: number) => ({
      x: x * scale + offsetX,
      y: y * scale + offsetY,
    })

    const roundRect = (x: number, y: number, w: number, h: number, r: number) => {
      const rr = Math.min(r, w / 2, h / 2)
      ctx.beginPath()
      ctx.moveTo(x + rr, y)
      ctx.arcTo(x + w, y, x + w, y + h, rr)
      ctx.arcTo(x + w, y + h, x, y + h, rr)
      ctx.arcTo(x, y + h, x, y, rr)
      ctx.arcTo(x, y, x + w, y, rr)
      ctx.closePath()
    }

    const drawNode = (n: Node, isConnecting: boolean) => {
      const { x, y } = worldToMini(n.x, n.y)
      const w = NODE_WIDTH * scale
      const h = NODE_HEIGHT * scale
      const r = 10 * scale
      const headerH = 30 * scale
      const footerH = 26 * scale

      // Node body
      ctx.fillStyle = theme === 'light' ? '#ffffff' : '#2f3136'
      roundRect(x, y, w, h, r)
      ctx.fill()

      // Border
      ctx.lineWidth = Math.max(1, 2 * scale)
      ctx.strokeStyle = n.color
      ctx.stroke()

      // Header stripe
      ctx.fillStyle = theme === 'light' ? 'rgba(59,130,246,0.06)' : 'rgba(255,255,255,0.06)'
      ctx.fillRect(x, y, w, headerH)

      // Footer stripe
      ctx.fillStyle = theme === 'light' ? 'rgba(59,130,246,0.05)' : 'rgba(255,255,255,0.04)'
      ctx.fillRect(x, y + h - footerH, w, footerH)

      // Ports (small indicators)
      const portY = y + h - footerH + footerH / 2
      if (n.type === 'condition') {
        const leftX = x + w * 0.25
        const rightX = x + w * 0.75
        ctx.fillStyle = hasEdge(state, n.id, 'true') ? '#43b581' : n.color
        ctx.beginPath()
        ctx.arc(leftX, portY, Math.max(1.5, 3.5 * scale), 0, Math.PI * 2)
        ctx.fill()

        ctx.fillStyle = hasEdge(state, n.id, 'false') ? '#f04747' : n.color
        ctx.beginPath()
        ctx.arc(rightX, portY, Math.max(1.5, 3.5 * scale), 0, Math.PI * 2)
        ctx.fill()
      } else {
        const midX = x + w * 0.5
        ctx.fillStyle = isConnecting ? '#f1c40f' : n.color
        ctx.beginPath()
        ctx.arc(midX, portY, Math.max(1.5, 3.5 * scale), 0, Math.PI * 2)
        ctx.fill()
      }
    }

    const drawComment = (c: CommentBox) => {
      const { x, y } = worldToMini(c.x, c.y)
      const w = c.w * scale
      const h = c.h * scale
      const r = 6 * scale

      // Fill (transparent)
      ctx.fillStyle = theme === 'light' ? 'rgba(59,130,246,0.03)' : 'rgba(255,255,255,0.02)'
      roundRect(x, y, w, h, r)
      ctx.fill()

      // Border dashed
      ctx.setLineDash([6 * scale, 5 * scale])
      ctx.lineWidth = Math.max(1, 2 * scale)
      ctx.strokeStyle = theme === 'light' ? 'rgba(100,116,139,0.9)' : '#9aa6bd'
      ctx.stroke()
      ctx.setLineDash([])

      // Handle
      const handleH = 18 * scale
      const handleY = y - 28 * scale
      const handleW = Math.max(30 * scale, w * 0.6)
      ctx.fillStyle = theme === 'light' ? 'rgba(148,163,184,0.25)' : 'rgba(148,163,184,0.18)'
      ctx.strokeStyle = theme === 'light' ? 'rgba(100,116,139,0.65)' : '#7e899d'
      ctx.lineWidth = Math.max(1, 1.5 * scale)
      roundRect(x, handleY, handleW, handleH, 6 * scale)
      ctx.fill()
      ctx.stroke()
    }

    const drawEdge = (edge: Edge) => {
      const fromNode = state.nodes.find((n) => n.id === edge.fromId)
      const toNode = state.nodes.find((n) => n.id === edge.toId)
      if (!fromNode || !toNode) return

      const start = getNodeAnchor(fromNode, toNode, true)
      const end = getNodeAnchor(fromNode, toNode, false)
      const startMini = worldToMini(start.x, start.y)
      const endMini = worldToMini(end.x, end.y)

      const startX = startMini.x
      const startY = startMini.y
      const endX = endMini.x
      const endY = endMini.y

      const curve = Math.min(30, Math.max(10, Math.hypot(endX - startX, endY - startY) * 0.25))
      const cp1X = startX + (endX - startX) * 0.2
      const cp2X = endX - (endX - startX) * 0.2
      const cp1Y = startY + (endY > startY ? curve : -curve)
      const cp2Y = endY - (endY > startY ? curve : -curve)

      ctx.beginPath()
      ctx.moveTo(startX, startY)
      ctx.bezierCurveTo(cp1X, cp1Y, cp2X, cp2Y, endX, endY)
      ctx.strokeStyle = edge.type === 'true' ? '#43b581' : edge.type === 'false' ? '#f04747' : '#7289da'
      ctx.lineWidth = Math.max(1, 2 * scale)
      ctx.stroke()

      ctx.fillStyle = ctx.strokeStyle as any
      ctx.beginPath()
      ctx.arc(endX, endY, Math.max(1.5, 4 * scale), 0, Math.PI * 2)
      ctx.fill()
    }

    // Comment boxes (behind edges)
    state.comments.forEach(drawComment)
    // Edges
    state.edges.forEach(drawEdge)
    // Nodes (front)
    state.nodes.forEach((n) => drawNode(n, connectingFromId === n.id))
  }, [state.nodes, state.comments, state.edges, minimapMeta, theme, connectingFromId])

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
    // Only left button drags objects. Middle button reserved for viewport panning.
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    setState((prev) => ({ ...prev, dragTarget: target }))
  }

  const beginResize = (e: React.MouseEvent, commentId: string) => {
    if (e.button !== 0) return
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

  const editingNode = useMemo(() => {
    if (editingId === null) return null
    return state.nodes.find((x) => x.id === editingId) ?? null
  }, [editingId, state.nodes])

  const closeModal = () => {
    setEditingId(null)
  }

  const openCommentModal = (id: string) => {
    setEditingCommentId(id)
    const c = state.comments.find((x) => x.id === id)
    setCommentDraft(c?.text ?? '')
    setCommentColorDraft(c?.color ?? '#5865f2')
  }

  const closeCommentModal = () => {
    setEditingCommentId(null)
  }

  const saveCommentModal = () => {
    if (!editingCommentId) return
    setState((prev) => ({
      ...prev,
      comments: prev.comments.map((c) =>
        c.id === editingCommentId ? { ...c, text: commentDraft, color: commentColorDraft } : c,
      ),
    }))
    closeCommentModal()
  }

  const deleteComment = () => {
    if (!editingCommentId) return
    setState((prev) => ({
      ...prev,
      comments: prev.comments.filter((c) => c.id !== editingCommentId),
    }))
    closeCommentModal()
  }

  const saveModal = () => {
    if (editingId === null) return
    setState((prev) => {
      const editingNode = prev.nodes.find((x) => x.id === editingId) ?? null
      const nextNodes = prev.nodes.map((n) => {
        if (n.id !== editingId) return n
        if (editingNode?.type === 'condition') {
          return { ...n, code: draft.code, color: draft.color }
        }
        return { ...n, cn: draft.cn, en: draft.en, code: draft.code, color: draft.color }
      })
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
        // User cancelled picker: don't show fallback file input dialog again.
        if (isFilePickerCancelled(e)) return
        // Unexpected failure: fall back
        console.warn(e)
      }
    }

    if (fileInputRef.current) fileInputRef.current.click()
  }

  const handleSave = async () => {
    const gml = makeGml(state)
    setFileMenuOpen(false)

    const fallbackSavedName = ensureGmlName(
      currentFileName === '新文件' ? 'dialog_system.gml' : currentFileName,
    )

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
        setCurrentFileName(fallbackSavedName)
        setIsDirty(false)
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
        setCurrentFileName(fallbackSavedName)
        setIsDirty(false)
        onExport()
        return
      }
    }

    // No handle/path available (e.g. "new file" or environment without persistent FS access).
    // Keep existing download behavior, but update UI to reflect "saved".
    setCurrentFileName(fallbackSavedName)
    setIsDirty(false)
    onExport()
  }

  const handleSaveAs = async () => {
    setFileMenuOpen(false)
    const gml = makeGml(state)
    const suggestedName = ensureGmlName(currentFileName === '新文件' ? 'dialog_system.gml' : currentFileName)
    const saver = (window as any).showSaveFilePicker as
      | undefined
      | ((opts?: any) => Promise<FileHandle>)
    if (saver) {
      try {
        const handle = await saver({
          suggestedName,
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
        if (isFilePickerCancelled(e)) return
        console.warn(e)
      }
    }
    // Fallback to download.
    // Also update current file name so the UI switches away from "新文件".
    setCurrentFileHandle(null)
    setCurrentFilePath(null)
    setCurrentFileName(suggestedName)
    setIsDirty(false)
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
        <button
          className="theme-toggle"
          onClick={() => {
            setHighlightRulesText(
              highlightRules.map((r) => `${r.pattern}=${r.color}`).join('\n'),
            )
            setSettingsOpen(true)
          }}
          title="设置"
        >
          ⚙
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
                style={{
                  left: c.x,
                  top: c.y,
                  width: c.w,
                  height: c.h,
                  borderColor: c.color,
                  background: hexToRgba(c.color, theme === 'light' ? 0.08 : 0.06),
                }}
              >
                <div
                  className="comment-handle"
                  style={{
                    background: c.color,
                    borderColor: c.color,
                    color: '#fff',
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    openCommentModal(c.id)
                  }}
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

      <div id="minimap" style={{ width: minimapSize.w, height: minimapSize.h }}>
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
        <div
          className="minimap-resize minimap-resize-left"
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            minimapResizeRef.current = { edge: 'left', ox: e.clientX, oy: e.clientY, w: minimapSize.w, h: minimapSize.h }
          }}
        />
        <div
          className="minimap-resize minimap-resize-top"
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            minimapResizeRef.current = { edge: 'top', ox: e.clientX, oy: e.clientY, w: minimapSize.w, h: minimapSize.h }
          }}
        />
        <div id="minimap-zoom">缩放: {zoomPercent}%</div>
        <div id="minimap-view" style={minimapViewStyle} />
      </div>

      {editingCommentId !== null ? (
        <div id="modal-overlay" style={{ display: 'flex' }}>
          <div id="modal">
            <h3 style={{ margin: 0 }}>注释配置</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 12, color: '#888' }}>注释文字</label>
              <textarea
                rows={4}
                value={commentDraft}
                onChange={(e) => setCommentDraft(e.target.value)}
              />
            </div>
            <div className="color-row">
              <label>注释颜色:</label>
              <input
                type="color"
                value={commentColorDraft}
                onChange={(e) => setCommentColorDraft(e.target.value)}
              />
              <div className="preset-color-list">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color}
                    className={`preset-color ${commentColorDraft === color ? 'active' : ''}`}
                    style={{ background: color }}
                    onClick={() => setCommentColorDraft(color)}
                    title={color}
                  />
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <button onClick={deleteComment} style={{ background: '#f04747' }}>
                删除注释框
              </button>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={closeCommentModal} style={{ background: '#4f545c' }}>
                  取消
                </button>
                <button onClick={saveCommentModal}>保存</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
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

            {editingNode?.type !== 'condition' ? (
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
            ) : null}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={{ fontSize: 12, color: '#888' }}>执行代码</label>
              <CodeEditor
                value={draft.code}
                onChange={(next) => setDraft((d) => ({ ...d, code: next }))}
                rules={highlightRules}
                height={180}
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

      {settingsOpen ? (
        <div id="modal-overlay" style={{ display: 'flex' }}>
          <div id="modal">
            <h3 style={{ margin: 0 }}>编辑器设置</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 12, color: '#888' }}>
                高亮规则（每行一条：pattern=#RRGGBB）
              </label>
              <textarea
                rows={10}
                value={highlightRulesText}
                onChange={(e) => setHighlightRulesText(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                onClick={() => setSettingsOpen(false)}
                style={{ background: '#4f545c' }}
              >
                取消
              </button>
              <button
                onClick={() => {
                  const next: HighlightRule[] = highlightRulesText
                    .split('\n')
                    .map((line) => line.trim())
                    .filter(Boolean)
                    .map((line) => {
                      const [pattern, color] = line.split('=')
                      return { pattern: (pattern ?? '').trim(), color: (color ?? '').trim() }
                    })
                    .filter((r) => r.pattern && r.color)
                  setHighlightRules(next)
                  setSettingsOpen(false)
                }}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

