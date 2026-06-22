import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Rnd } from 'react-rnd'
import { loadGeo, saveGeo } from '../lib/geo'
import { PanelHeader } from '../lib/PanelHeader'
import { CaptureIdContext } from '../lib/PanelHeader'
import { usePanelCtx } from '../lib/panel-context'
import { SynthKnob } from '../lib/SynthKnob'
import { BpmControl } from '../lib/BpmControl'
import { retroLedStyle } from '../lib/retro-tokens'
import { StrudelService, type StrudelState } from '../lib/strudel-service'
import { encodeWav } from '../lib/audio-utils'
import { getAvailableStyles, MUTATIONS } from '../lib/style-cards'
import {
  getApiKey, setApiKey, hasEnvKey, getModel, setModel,
  streamChat, extractStrudelCode, extractTweakLayers, applyTweakParam, setLayerGain, removeLayer,
  buildContextSnippet,
  type ChatMessage, type GeminiModel, type TweakParam, type TweakLayer,
} from '../lib/gemini-client'

type Message = { id: number; role: 'user' | 'model'; text: string; code?: string }

const PANEL_ID = 'analogbrain'
const MAX_RETRIES = 2
const DEFAULT_GEO = { x: 180 + Math.random() * 40, y: 60 + Math.random() * 40, w: 760, h: 0 }
const LS_PREFIX = 'abrain-'

function loadJson<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(LS_PREFIX + key); return v ? JSON.parse(v) : fallback } catch { return fallback }
}
function saveJson(key: string, value: any) {
  try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(value)) } catch {}
}
function loadNum(key: string, fallback: number): number {
  const v = localStorage.getItem(LS_PREFIX + key)
  return v != null ? Number(v) : fallback
}
function saveNum(key: string, v: number) {
  localStorage.setItem(LS_PREFIX + key, String(v))
}

const PHOSPHOR = '#33ff66'
const PHOSPHOR_DIM = '#1a9940'
const AMBER = '#ffaa22'
const SCREEN_BG = '#0a0e08'
const CODE_BG = '#0d110a'
const LAYER_COLORS = ['#ffaa22', '#44bbff', '#ff6688', '#88ff66', '#cc88ff', '#ffcc44', '#44ffcc', '#ff8844']
const scanlinesBg = 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.15) 2px, rgba(0,0,0,0.15) 4px)'

type XYAxis = { param: string; min: number; max: number; log?: boolean }
const XY_PRESETS: { label: string; x: XYAxis; y: XYAxis }[] = [
  { label: 'Filter', x: { param: 'lpf', min: 100, max: 20000, log: true }, y: { param: 'room', min: 0, max: 1 } },
  { label: 'Space', x: { param: 'delay', min: 0, max: 0.9 }, y: { param: 'room', min: 0, max: 1 } },
  { label: 'Tone', x: { param: 'lpf', min: 100, max: 20000, log: true }, y: { param: 'hpf', min: 20, max: 5000, log: true } },
]

function XYPad({ onMove, size = 80 }: {
  onMove: (x: number, y: number) => void
  size?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0.5, y: 0.5 })
  const dragging = useRef(false)

  const handle = useCallback((e: React.PointerEvent | PointerEvent) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
    const y = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height))
    setPos({ x, y })
    onMove(x, y)
  }, [onMove])

  useEffect(() => {
    const up = () => { dragging.current = false }
    const move = (e: PointerEvent) => { if (dragging.current) handle(e) }
    window.addEventListener('pointerup', up)
    window.addEventListener('pointermove', move)
    return () => { window.removeEventListener('pointerup', up); window.removeEventListener('pointermove', move) }
  }, [handle])

  return (
    <div ref={ref} onPointerDown={e => { dragging.current = true; handle(e) }}
      style={{
        width: size, height: size, borderRadius: 4, cursor: 'crosshair',
        background: `radial-gradient(circle at ${pos.x * 100}% ${(1 - pos.y) * 100}%, rgba(51,255,102,0.15), transparent 60%), rgba(0,0,0,0.3)`,
        border: '1px solid rgba(255,255,255,0.08)', position: 'relative', touchAction: 'none', flexShrink: 0,
      }}>
      <div style={{
        position: 'absolute',
        left: `${pos.x * 100}%`, bottom: `${pos.y * 100}%`,
        width: 8, height: 8, borderRadius: '50%',
        background: PHOSPHOR, boxShadow: `0 0 6px ${PHOSPHOR}`,
        transform: 'translate(-50%, 50%)', pointerEvents: 'none',
      }} />
    </div>
  )
}

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t }
function lerpLog(a: number, b: number, t: number): number {
  return Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * t)
}

export function AnalogBrainPanel({ onClose }: { onClose: () => void }) {
  const { scale, zOf, bringToFront, endDrag, isDragging } = usePanelCtx()
  const geo = loadGeo(PANEL_ID, DEFAULT_GEO)

  const [power, setPower] = useState(true)
  const [messages, setMessages] = useState<Message[]>(() => loadJson('messages', []))
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [strudelState, setStrudelState] = useState<StrudelState>({ playing: false, code: '', error: null, bpm: 120 })
  const [editCode, setEditCode] = useState(() => localStorage.getItem(LS_PREFIX + 'code') || '')
  const [volume, setVolume] = useState(() => loadNum('volume', 0.8))
  const [lpf, setLpf] = useState(() => loadNum('lpf', 20000))
  const [hpf, setHpf] = useState(() => loadNum('hpf', 20))
  const [delay, setDelay] = useState(() => loadNum('delay', 0))
  const [reverb, setReverb] = useState(() => loadNum('reverb', 0))
  const [bpm, setBpm] = useState(() => loadNum('bpm', 120))
  const [tweakLayers, setTweakLayers] = useState<TweakLayer[]>([])
  const [mutedLayers, setMutedLayers] = useState<Record<number, number>>({})
  const [expandedLayer, setExpandedLayer] = useState<number | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [exportDur, setExportDur] = useState(30)
  const [exportFmt, setExportFmt] = useState<'wav' | 'webm'>('wav')
  const [exporting, setExporting] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [apiKey, setApiKeyLocal] = useState(getApiKey)
  const [model, setModelLocal] = useState<GeminiModel>(getModel)
  const [thinking, setThinking] = useState(false)
  const [scenes, setScenes] = useState<Array<{ name: string; code: string; volume: number; lpf: number; hpf: number; delay: number; reverb: number; bpm: number; ts: number }>>(() => loadJson('scenes', []))
  const [xyPreset, setXyPreset] = useState(0)
  const [showXY, setShowXY] = useState(false)
  const [crossfadeA, setCrossfadeA] = useState<number | null>(null)
  const [crossfadeB, setCrossfadeB] = useState<number | null>(null)

  const [initMsgId] = useState(() => { const m: Message[] = loadJson('messages', []); return m.length ? Math.max(...m.map(x => x.id)) : 0 })
  const msgIdRef = useRef(initMsgId)
  const chatScrollRef = useRef<HTMLDivElement>(null)
  const serviceRef = useRef<StrudelService | null>(null)
  const chatHistoryRef = useRef<ChatMessage[]>(loadJson('chatHistory', []))

  useEffect(() => {
    const svc = StrudelService.get()
    serviceRef.current = svc
    const unsub = svc.subscribe(setStrudelState)
    svc.onReady(() => {
      svc.setVolume(volume)
      svc.setLPF(lpf)
      svc.setHPF(hpf)
      svc.setDelay(delay)
      svc.setReverb(reverb)
    })
    return () => { unsub() }
  }, [])

  // Scroll only the chat container — NOT scrollIntoView, which walks up and
  // scrolls every scrollable ancestor (including the canvas pan) into view.
  useEffect(() => {
    const el = chatScrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages])
  useEffect(() => { serviceRef.current?.setVolume(volume) }, [volume])

  // ── Persist state ──
  useEffect(() => { if (!streaming) saveJson('messages', messages) }, [messages, streaming])
  useEffect(() => { saveJson('chatHistory', chatHistoryRef.current) }, [messages])
  useEffect(() => { localStorage.setItem(LS_PREFIX + 'code', editCode) }, [editCode])
  useEffect(() => { saveNum('volume', volume) }, [volume])
  useEffect(() => { saveNum('lpf', lpf) }, [lpf])
  useEffect(() => { saveNum('hpf', hpf) }, [hpf])
  useEffect(() => { saveNum('delay', delay) }, [delay])
  useEffect(() => { saveNum('reverb', reverb) }, [reverb])
  useEffect(() => { saveNum('bpm', bpm); serviceRef.current?.setBPM(bpm) }, [bpm])
  useEffect(() => { saveJson('scenes', scenes) }, [scenes])

  // ── Mutations ──
  const applyMutation = useCallback(async (mutationId: string) => {
    const mut = MUTATIONS.find(m => m.id === mutationId)
    if (!mut || !editCode.trim()) return
    const updated = mut.apply(editCode)
    if (updated === editCode) return
    setEditCode(updated)
    setTweakLayers(extractTweakLayers(updated))
    serviceRef.current?.evaluate(updated).catch(() => {})
  }, [editCode])

  // ── Scene snapshots ──
  const saveScene = useCallback(() => {
    const scene = {
      name: `Scene ${scenes.length + 1}`,
      code: editCode, volume, lpf, hpf, delay, reverb, bpm,
      ts: Date.now(),
    }
    setScenes(prev => [...prev.slice(-11), scene])
  }, [editCode, volume, lpf, hpf, delay, reverb, bpm, scenes.length])

  const loadScene = useCallback((idx: number) => {
    const scene = scenes[idx]
    if (!scene) return
    setEditCode(scene.code)
    setVolume(scene.volume); setLpf(scene.lpf); setHpf(scene.hpf)
    setDelay(scene.delay); setReverb(scene.reverb); setBpm(scene.bpm)
    setTweakLayers(extractTweakLayers(scene.code))
    setMutedLayers({}); setExpandedLayer(null)
    serviceRef.current?.setVolume(scene.volume)
    serviceRef.current?.setLPF(scene.lpf)
    serviceRef.current?.setHPF(scene.hpf)
    serviceRef.current?.setDelay(scene.delay)
    serviceRef.current?.setReverb(scene.reverb)
    serviceRef.current?.setBPM(scene.bpm)
    serviceRef.current?.evaluate(scene.code).catch(() => {})
  }, [scenes])

  const deleteScene = useCallback((idx: number) => {
    setScenes(prev => prev.filter((_, i) => i !== idx))
  }, [])

  // ── XY Pad ──
  const handleXYMove = useCallback((x: number, y: number) => {
    const preset = XY_PRESETS[xyPreset]
    if (!preset) return
    const xVal = preset.x.log ? lerpLog(preset.x.min, preset.x.max, x) : lerp(preset.x.min, preset.x.max, x)
    const yVal = preset.y.log ? lerpLog(preset.y.min, preset.y.max, y) : lerp(preset.y.min, preset.y.max, y)
    const setParam = (p: string, v: number) => {
      if (p === 'lpf') { setLpf(v) }
      else if (p === 'hpf') { setHpf(v) }
      else if (p === 'delay') { setDelay(v) }
      else if (p === 'room' || p === 'reverb') { setReverb(v) }
    }
    setParam(preset.x.param, xVal)
    setParam(preset.y.param, yVal)
  }, [xyPreset])

  // ── Crossfader ──
  const handleCrossfade = useCallback((t: number) => {
    if (crossfadeA == null || crossfadeB == null) return
    const a = scenes[crossfadeA]
    const b = scenes[crossfadeB]
    if (!a || !b) return
    const v = (p: 'volume' | 'lpf' | 'hpf' | 'delay' | 'reverb' | 'bpm') => lerp(a[p], b[p], t)
    setVolume(v('volume')); serviceRef.current?.setVolume(v('volume'))
    setLpf(v('lpf')); setHpf(v('hpf'))
    setDelay(v('delay')); setReverb(v('reverb'))
    setBpm(Math.round(v('bpm')))
  }, [crossfadeA, crossfadeB, scenes])

  const evaluateCode = useCallback(async (code: string) => {
    try {
      await serviceRef.current?.evaluate(code)
      setTweakLayers(extractTweakLayers(code))
    } catch {}
  }, [])

  const handleTweak = useCallback((param: TweakParam, newValue: number) => {
    const updated = applyTweakParam(editCode, param, newValue)
    setEditCode(updated)
    setTweakLayers(extractTweakLayers(updated))
    serviceRef.current?.evaluate(updated).catch(() => {})
  }, [editCode])

  const handleLayerMute = useCallback((layerIndex: number, currentGain: number) => {
    const isMuted = layerIndex in mutedLayers
    let updated: string
    if (isMuted) {
      updated = setLayerGain(editCode, layerIndex, mutedLayers[layerIndex])
      setMutedLayers(prev => { const n = { ...prev }; delete n[layerIndex]; return n })
    } else {
      setMutedLayers(prev => ({ ...prev, [layerIndex]: currentGain }))
      updated = setLayerGain(editCode, layerIndex, 0)
    }
    setEditCode(updated)
    setTweakLayers(extractTweakLayers(updated))
    serviceRef.current?.evaluate(updated).catch(() => {})
  }, [editCode, mutedLayers])

  const handleLayerGain = useCallback((layerIndex: number, gain: number) => {
    if (layerIndex in mutedLayers) return
    const updated = setLayerGain(editCode, layerIndex, gain)
    setEditCode(updated)
    setTweakLayers(extractTweakLayers(updated))
    serviceRef.current?.evaluate(updated).catch(() => {})
  }, [editCode, mutedLayers])

  const handleRemoveLayer = useCallback((layerIndex: number) => {
    const updated = removeLayer(editCode, layerIndex)
    if (updated === editCode) return
    setEditCode(updated)
    setTweakLayers(extractTweakLayers(updated))
    setMutedLayers(prev => { const n = { ...prev }; delete n[layerIndex]; return n })
    if (expandedLayer != null) setExpandedLayer(null)
    serviceRef.current?.evaluate(updated).catch(() => {})
  }, [editCode, expandedLayer])

  const handleExport = useCallback(async () => {
    const svc = serviceRef.current
    if (!svc || exporting) return
    const stream = svc.getCaptureStream()
    if (!stream) return

    setExporting(true)
    try {
      const isWav = exportFmt === 'wav'
      const mimeType = 'audio/webm;codecs=opus'
      const recorder = new MediaRecorder(stream, { mimeType })
      const chunks: Blob[] = []
      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }

      const done = new Promise<Blob>(resolve => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }))
      })

      recorder.start(100)
      await new Promise(r => setTimeout(r, exportDur * 1000))
      recorder.stop()
      const webmBlob = await done

      let finalBlob: Blob
      let ext: string
      if (isWav) {
        const audioCtx = new OfflineAudioContext(2, 48000 * exportDur, 48000)
        const arrayBuf = await webmBlob.arrayBuffer()
        const decoded = await audioCtx.decodeAudioData(arrayBuf)
        finalBlob = encodeWav(decoded)
        ext = 'wav'
      } else {
        finalBlob = webmBlob
        ext = 'webm'
      }

      const url = URL.createObjectURL(finalBlob)
      const a = document.createElement('a')
      a.href = url
      a.download = `analogbrain-${Date.now()}.${ext}`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }, [exporting, exportDur, exportFmt])

  // Knobs → real Web Audio nodes (no code injection)
  useEffect(() => { serviceRef.current?.setLPF(lpf) }, [lpf])
  useEffect(() => { serviceRef.current?.setHPF(hpf) }, [hpf])
  useEffect(() => { serviceRef.current?.setDelay(delay) }, [delay])
  useEffect(() => { serviceRef.current?.setReverb(reverb) }, [reverb])

  const sendMessage = useCallback(async (text: string, retryCount = 0) => {
    if (!text.trim() || streaming) return
    if (!getApiKey()) { setShowApiKey(true); return }

    const userMsg: Message = { id: ++msgIdRef.current, role: 'user', text: text.trim() }
    if (retryCount === 0) {
      setMessages(prev => [...prev, userMsg])
      chatHistoryRef.current.push({ role: 'user', parts: [{ text: text.trim() }] })
    }

    setInput('')
    setStreaming(true)
    setThinking(true)

    const aiId = ++msgIdRef.current
    setMessages(prev => [...prev, { id: aiId, role: 'model', text: '' }])

    let fullText = ''
    try {
      const localNames = serviceRef.current?.getLocalSampleNames() ?? []
      const ctx = buildContextSnippet({
        bpm, layers: tweakLayers.map(l => ({ name: l.name, gain: l.gain })),
        volume, lpf, hpf, delay, reverb,
        activeTextures: [],
      })
      for await (const chunk of streamChat(chatHistoryRef.current, undefined, localNames, ctx)) {
        setThinking(false)
        fullText += chunk
        const liveCode = extractStrudelCode(fullText)
        if (liveCode) setEditCode(liveCode)
        const chatText = stripCodeBlocks(fullText)
        setMessages(prev => prev.map(m => m.id === aiId ? { ...m, text: chatText } : m))
      }
      chatHistoryRef.current.push({ role: 'model', parts: [{ text: fullText }] })
      setMessages(prev => prev.map(m => m.id === aiId ? { ...m, text: stripCodeBlocks(fullText) } : m))

      const code = extractStrudelCode(fullText)
      if (code) {
        setEditCode(code)
        setMutedLayers({})
        setExpandedLayer(null)
        try {
          await evaluateCode(code)
        } catch (err: any) {
          if (retryCount < MAX_RETRIES) {
            const errorMsg = `Error evaluating code: ${err?.message || err}. Please fix it.`
            chatHistoryRef.current.push({ role: 'user', parts: [{ text: errorMsg }] })
            setStreaming(false)
            await sendMessage(errorMsg, retryCount + 1)
            return
          }
        }
      }
    } catch (err: any) {
      setMessages(prev => prev.map(m => m.id === aiId ? { ...m, text: `Error: ${err?.message || err}` } : m))
    } finally {
      setStreaming(false)
      setThinking(false)
    }
  }, [streaming, evaluateCode])

  const handlePlay = useCallback(async () => {

    if (strudelState.playing) serviceRef.current?.stop()
    else if (editCode) await evaluateCode(editCode)
  }, [strudelState.playing, editCode, evaluateCode])

  const handleEvalCode = useCallback(async () => {

    if (editCode.trim()) await evaluateCode(editCode)
  }, [editCode, evaluateCode])

  const clearChat = useCallback(() => {
    setMessages([]); chatHistoryRef.current = []; setEditCode('')
    setMutedLayers({}); setExpandedLayer(null); setTweakLayers([])
    saveJson('messages', []); saveJson('chatHistory', [])
    localStorage.removeItem(LS_PREFIX + 'code')
  }, [])

  const handleChatKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input) }
  }, [input, sendMessage])

  const saveApiKeyHandler = useCallback(() => {
    setApiKey(apiKey)
    setShowApiKey(false)
  }, [apiKey])

  // ── Scope canvas ──
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !power) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const draw = () => {
      animRef.current = requestAnimationFrame(draw)
      const w = canvas.width, h = canvas.height
      ctx.fillStyle = SCREEN_BG
      ctx.fillRect(0, 0, w, h)

      const analyser = serviceRef.current?.getAnalyser()
      if (!analyser || !strudelState.playing) {
        ctx.strokeStyle = PHOSPHOR_DIM
        ctx.lineWidth = 1.5
        ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke()
        return
      }

      const bufLen = analyser.frequencyBinCount
      const data = new Uint8Array(bufLen)
      analyser.getByteTimeDomainData(data)

      ctx.strokeStyle = PHOSPHOR
      ctx.lineWidth = 2
      ctx.shadowColor = PHOSPHOR
      ctx.shadowBlur = 8
      ctx.beginPath()
      for (let i = 0; i < bufLen; i++) {
        const x = (i / bufLen) * w, y = (data[i] / 255) * h
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      }
      ctx.stroke()
      ctx.shadowBlur = 0
    }
    draw()
    return () => cancelAnimationFrame(animRef.current)
  }, [power, strudelState.playing])

  // ── Shared Rnd props ──
  const rndProps = {
    default: { x: geo.x, y: geo.y, width: geo.w || 760, height: 'auto' as unknown as number },
    minWidth: 620,
    maxWidth: 1100,
    enableResizing: { right: true, left: true },
    bounds: undefined as undefined,
    dragHandleClassName: 'abrain-drag',
    className: `panel-drag${isDragging(PANEL_ID) ? ' dragging' : ''}`,
    scale,
    onDragStart: () => bringToFront(PANEL_ID),
    onDragStop: (_e: any, d: any) => { saveGeo(PANEL_ID, { x: d.x, y: d.y }); endDrag(PANEL_ID) },
    onResizeStop: (_e: any, _d: any, ref: any, _delta: any, pos: any) => saveGeo(PANEL_ID, { w: ref.offsetWidth, x: pos.x, y: pos.y }),
    style: { zIndex: zOf(PANEL_ID, 15) },
  }

  if (!power) {
    return (
      <Rnd {...rndProps}>
        <div style={{ borderRadius: 'var(--radius-panel)', background: 'var(--bg-chassis)', boxShadow: 'var(--shadow-chassis)', padding: '14px 18px 18px', display: 'flex', flexDirection: 'column' as const, gap: 12, minHeight: 120 }}>
          <PanelHeader title="// Analog Brain" onClose={onClose} className="abrain-drag">
            <button onClick={() => setPower(true)} style={powerBtnStyle(false)} onMouseDown={e => e.stopPropagation()}>PWR</button>
          </PanelHeader>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '30px 0', color: '#333' }}>
            <span style={{ fontFamily: 'monospace', fontSize: 14, letterSpacing: '0.3em' }}>[ STANDBY ]</span>
          </div>
        </div>
      </Rnd>
    )
  }

  return (
    <CaptureIdContext.Provider value={PANEL_ID}>
      <Rnd {...rndProps}>
        <div
          onKeyDown={e => e.stopPropagation()}
          onKeyUp={e => e.stopPropagation()}
          style={{
            borderRadius: 'var(--radius-panel)',
            background: 'var(--bg-chassis)',
            boxShadow: 'var(--shadow-chassis)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >

          {/* ── Header ── */}
          <PanelHeader title="// Analog Brain mk.II" onClose={onClose} className="abrain-drag">
            <div onMouseDown={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={retroLedStyle(strudelState.playing, '#33ff66', '#1a3320')} title={strudelState.playing ? 'Playing' : 'Stopped'} />
              <div style={retroLedStyle(thinking, AMBER, '#332800')} title={thinking ? 'AI thinking...' : 'Idle'} />
              <div style={retroLedStyle(!!strudelState.error, '#ff4444', '#331111')} title={strudelState.error || 'No errors'} />
              <button onClick={clearChat} style={powerBtnStyle(false)} title="Clear chat & code">CLR</button>
              <button onClick={() => setPower(false)} style={powerBtnStyle(true)}>PWR</button>
            </div>
          </PanelHeader>

          {/* ── Main Content: Code + Scope | Chat ── */}
          <div style={{ display: 'flex', minHeight: 340 }}>

            {/* ── Left: Code Display + Scope ── */}
            <div style={{
              flex: '1 1 55%', display: 'flex', flexDirection: 'column',
              borderRight: '1px solid rgba(255,255,255,0.04)', minWidth: 0,
            }}>
              {/* Code editor */}
              <div style={{
                flex: 1, overflow: 'hidden', padding: 0,
                background: CODE_BG, position: 'relative', minHeight: 200,
                fontFamily: '"Fira Code", "JetBrains Mono", "Cascadia Code", monospace',
                fontSize: 13, lineHeight: 1.7, color: PHOSPHOR,
              }}>
                <div style={scanlineOverlayStyle} />
                <textarea
                  value={editCode}
                  onChange={e => setEditCode(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleEvalCode() }
                  }}
                  onWheel={e => e.stopPropagation()}
                  spellCheck={false}
                  placeholder={'// Strudel code here — Ctrl+Enter to run\n// Ask the brain to generate a pattern →'}
                  style={{
                    width: '100%', height: '100%', resize: 'none',
                    background: 'transparent', border: 'none', outline: 'none',
                    color: PHOSPHOR, fontFamily: 'inherit', fontSize: 'inherit',
                    lineHeight: 'inherit', padding: '12px 16px', margin: 0,
                    overflow: 'auto',
                  }}
                />
              </div>

              {/* Scope */}
              <div style={{ height: 64, background: SCREEN_BG, borderTop: '1px solid rgba(255,255,255,0.04)', position: 'relative', flexShrink: 0 }}>
                <canvas ref={canvasRef} width={500} height={64} style={{ width: '100%', height: '100%', display: 'block' }} />
                <div style={scanlineOverlayStyle} />
              </div>

              {/* Transport */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px',
                background: 'rgba(0,0,0,0.3)', borderTop: '1px solid rgba(255,255,255,0.04)',
                fontFamily: 'monospace', fontSize: 11, flexShrink: 0,
              }}>
                <button onClick={handlePlay} style={transportIconBtn(strudelState.playing)} title={strudelState.playing ? 'Stop' : 'Play'}>
                  {strudelState.playing ? '■' : '▶'}
                </button>
                {editCode && (
                  <button onClick={handleEvalCode} style={transportIconBtn(false)} title="Evaluate (Ctrl+Enter)">⟳</button>
                )}
                <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.06)' }} />
                <div onMouseDown={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center' }}>
                  <BpmControl bpm={bpm} onChange={setBpm} accent={PHOSPHOR} />
                </div>
                {strudelState.error && (
                  <span
                    onClick={() => sendMessage(`Fix this error: ${strudelState.error}`)}
                    style={{
                      color: '#ff4444', fontSize: 8, padding: '2px 6px',
                      background: 'rgba(255,68,68,0.1)', borderRadius: 3,
                      cursor: 'pointer', flexShrink: 0,
                      fontFamily: 'monospace', letterSpacing: '0.05em',
                    }}
                    title={`${strudelState.error}\n\nClick to ask AI to fix`}
                  >FIX</span>
                )}
                <div onMouseDown={e => e.stopPropagation()} style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 3 }}>
                  <select value={exportDur} onChange={e => setExportDur(+e.target.value)} style={selectStyle}>
                    {[10,30,60,120,300].map(d => <option key={d} value={d}>{d < 60 ? `${d}s` : `${d/60}m`}</option>)}
                  </select>
                  <select value={exportFmt} onChange={e => setExportFmt(e.target.value as 'wav' | 'webm')} style={selectStyle}>
                    <option value="wav">WAV</option>
                    <option value="webm">WebM</option>
                  </select>
                  <button onClick={handleExport} disabled={exporting || !strudelState.playing}
                    style={{ ...transportIconBtn(exporting), color: exporting ? '#ff4444' : '#ccc', fontSize: 9 }}>
                    {exporting ? '●' : 'REC'}
                  </button>
                </div>
              </div>
            </div>

            {/* ── Right: Chat Terminal ── */}
            <div style={{ flex: '1 1 45%', display: 'flex', flexDirection: 'column', minWidth: 0, background: 'rgba(0,0,0,0.2)' }}>
              <div ref={chatScrollRef} style={{ flex: 1, overflow: 'auto', padding: '12px 14px', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6, minHeight: 200 }}>
                {messages.length === 0 && (
                  <div style={{ padding: '16px 0' }}>
                    <div style={{ color: PHOSPHOR, marginBottom: 8, fontSize: 11 }}>{'> ANALOG BRAIN mk.II ready'}</div>
                    <div style={{ color: '#556644', fontSize: 11 }}>Ask me to create music patterns.</div>
                    <div style={{ color: '#445533', fontSize: 10, marginTop: 8 }}>"dark techno beat with acid bass"</div>
                    <div style={{ color: '#445533', fontSize: 10 }}>"lo-fi hip hop rainy night"</div>
                    <div style={{ color: '#445533', fontSize: 10 }}>"ambient drone with slow pad"</div>
                    <div style={{ color: '#445533', fontSize: 10 }}>"drum & bass breakbeat"</div>
                  </div>
                )}
                {messages.map(msg => (
                  <div key={msg.id} style={{ marginBottom: 8 }}>
                    <span style={{ color: msg.role === 'user' ? AMBER : PHOSPHOR, fontWeight: 700 }}>
                      {msg.role === 'user' ? '> ' : '< '}
                    </span>
                    <span style={{ color: msg.role === 'user' ? '#ccc' : '#8fa87a', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {formatMessageText(msg.text)}
                    </span>
                  </div>
                ))}
                {thinking && (
                  <div style={{ color: AMBER, animation: 'pulse 1.5s infinite' }}>{'< '}thinking...</div>
                )}
              </div>

              {/* Input */}
              <div style={{ display: 'flex', gap: 6, padding: '8px 10px', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                <textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleChatKeyDown}

                  placeholder="aphex twin, ambient, trap, zimmer, silent hill..."
                  rows={2}
                  style={{
                    flex: 1, resize: 'none', background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.06)', borderRadius: 'var(--radius-sm)',
                    padding: '6px 10px', color: '#ccc', fontFamily: 'monospace', fontSize: 12, outline: 'none',
                  }}
                />
                <button
                  onClick={() => sendMessage(input)}
                  disabled={streaming || !input.trim()}
                  style={{
                    padding: '6px 14px',
                    background: streaming ? 'rgba(255,255,255,0.05)' : PHOSPHOR_DIM,
                    border: 'none', borderRadius: 'var(--radius-sm)', color: '#000',
                    fontFamily: 'monospace', fontWeight: 900, fontSize: 11,
                    cursor: streaming ? 'wait' : 'pointer',
                    letterSpacing: '0.1em', textTransform: 'uppercase',
                    opacity: (!input.trim() || streaming) ? 0.4 : 1,
                  }}
                >
                  {streaming ? '...' : 'SEND'}
                </button>
              </div>
            </div>
          </div>

          {/* ── Layer Mixer (2-col grid + detail strip) ── */}
          {tweakLayers.length > 0 && (
            <div onWheel={e => e.stopPropagation()} style={{
              borderTop: '1px solid rgba(255,255,255,0.06)',
              flexShrink: 0, background: 'rgba(0,0,0,0.12)',
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                {tweakLayers.map((layer, li) => {
                  const color = LAYER_COLORS[li % LAYER_COLORS.length]
                  const isMuted = layer.layerIndex in mutedLayers
                  const isSelected = expandedLayer === li
                  const nonGainParams = layer.params.filter(p => p.method !== 'gain')
                  return (
                    <div key={li} style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      padding: '4px 8px 4px 0',
                      borderBottom: '1px solid rgba(255,255,255,0.03)',
                      borderRight: li % 2 === 0 ? '1px solid rgba(255,255,255,0.03)' : 'none',
                      background: isSelected ? 'rgba(255,255,255,0.03)' : 'transparent',
                    }}>
                      <div
                        onClick={() => handleLayerMute(layer.layerIndex, layer.gain)}
                        title={isMuted ? 'Unmute' : 'Mute'}
                        style={{
                          width: 4, alignSelf: 'stretch', minHeight: 28,
                          borderRadius: '0 2px 2px 0', cursor: 'pointer', flexShrink: 0,
                          background: isMuted ? '#ff4444' : color,
                          opacity: isMuted ? 0.35 : 0.8,
                          transition: 'opacity 0.15s, background 0.15s',
                        }}
                      />
                      <SynthKnob
                        label="" value={isMuted ? 0 : layer.gain} min={0} max={1} size={26}
                        accent={isMuted ? '#444' : color}
                        fmt={() => ''}
                        onChange={v => handleLayerGain(layer.layerIndex, v)}
                      />
                      <div
                        onClick={() => nonGainParams.length > 0 && setExpandedLayer(isSelected ? null : li)}
                        style={{
                          flex: 1, minWidth: 0, cursor: nonGainParams.length > 0 ? 'pointer' : 'default',
                          display: 'flex', alignItems: 'baseline', gap: 4,
                        }}
                      >
                        <span style={{
                          fontSize: 9, fontFamily: 'monospace', fontWeight: 700,
                          color: isMuted ? '#555' : color,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          textDecoration: isMuted ? 'line-through' : 'none',
                        }}>{layer.name}</span>
                        <span style={{
                          fontSize: 8, fontFamily: 'monospace',
                          color: isMuted ? '#333' : '#555',
                        }}>{isMuted ? '0' : Math.round(layer.gain * 100)}</span>
                      </div>
                      {nonGainParams.length > 0 && (
                        <span
                          onClick={() => setExpandedLayer(isSelected ? null : li)}
                          style={{ fontSize: 8, color: isSelected ? '#888' : '#444', flexShrink: 0, cursor: 'pointer' }}
                        >{nonGainParams.length}</span>
                      )}
                      <span
                        onClick={(e) => { e.stopPropagation(); handleRemoveLayer(layer.layerIndex) }}
                        title={`Remove ${layer.name}`}
                        style={{
                          fontSize: 10, fontWeight: 900, color: '#555', flexShrink: 0,
                          cursor: 'pointer', lineHeight: 1, padding: '2px 3px',
                          borderRadius: 3, transition: 'color 0.15s, background 0.15s',
                        }}
                        onMouseEnter={e => { (e.target as HTMLElement).style.color = '#ff4444'; (e.target as HTMLElement).style.background = 'rgba(255,68,68,0.1)' }}
                        onMouseLeave={e => { (e.target as HTMLElement).style.color = '#555'; (e.target as HTMLElement).style.background = 'transparent' }}
                      >×</span>
                    </div>
                  )
                })}
              </div>
              {/* ── Detail strip (fixed below grid) ── */}
              {expandedLayer != null && (() => {
                const layer = tweakLayers[expandedLayer]
                if (!layer) return null
                const color = LAYER_COLORS[expandedLayer % LAYER_COLORS.length]
                const params = layer.params.filter(p => p.method !== 'gain')
                if (!params.length) return null
                return (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 3,
                    padding: '4px 10px 6px',
                    borderTop: `1px solid ${color}22`,
                    background: 'rgba(0,0,0,0.1)',
                  }}>
                    <span style={{
                      fontSize: 8, fontFamily: 'monospace', fontWeight: 700,
                      color, flexShrink: 0, letterSpacing: '0.05em',
                    }}>{layer.name}</span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, flex: 1 }}>
                      {params.map(p => (
                        <SynthKnob key={`${p.method}-${p.index}`}
                          label={p.method.toUpperCase()} value={p.value}
                          min={p.min} max={p.max} size={34} log={p.log}
                          accent={color}
                          fmt={v => p.log && v >= 1000 ? `${(v/1000).toFixed(1)}k` : v >= 100 ? `${Math.round(v)}` : parseFloat(v.toFixed(2)).toString()}
                          onChange={v => handleTweak(p, v)} />
                      ))}
                    </div>
                  </div>
                )
              })()}
            </div>
          )}

          {/* ── Mutations + Scenes ── */}
          <div style={{
            borderTop: '1px solid rgba(255,255,255,0.06)',
            flexShrink: 0, background: 'rgba(0,0,0,0.06)',
            padding: '5px 10px',
            display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'center',
          }}>
            {MUTATIONS.map(mut => (
              <button key={mut.id} onClick={() => applyMutation(mut.id)}
                disabled={!editCode.trim()}
                title={`Apply "${mut.label}" transform`}
                style={{
                  padding: '2px 6px', border: 'none', borderRadius: 10,
                  background: 'rgba(255,170,34,0.06)',
                  color: editCode.trim() ? AMBER : '#333',
                  fontSize: 8, fontFamily: 'monospace', fontWeight: 700,
                  cursor: editCode.trim() ? 'pointer' : 'default',
                  transition: 'all 0.15s',
                }}>
                {mut.label}
              </button>
            ))}
            <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.08)', margin: '0 2px' }} />
            <button onClick={saveScene} disabled={!editCode.trim()}
              title="Save current state as scene"
              style={{
                padding: '2px 6px', border: 'none', borderRadius: 10,
                background: 'rgba(68,187,255,0.08)', color: editCode.trim() ? '#44bbff' : '#333',
                fontSize: 8, fontFamily: 'monospace', fontWeight: 700, cursor: editCode.trim() ? 'pointer' : 'default',
              }}>
              + scene
            </button>
            {scenes.map((sc, i) => (
              <button key={i}
                onClick={() => loadScene(i)}
                onContextMenu={e => {
                  e.preventDefault()
                  if (crossfadeA == null) setCrossfadeA(i)
                  else if (crossfadeB == null && i !== crossfadeA) setCrossfadeB(i)
                  else { setCrossfadeA(i); setCrossfadeB(null) }
                }}
                title={`Click: load · Right-click: ${crossfadeA == null ? 'set as A' : crossfadeB == null ? 'set as B' : 'set as A'} for crossfade · Long-press: delete`}
                style={{
                  padding: '2px 6px', border: 'none', borderRadius: 10,
                  background: i === crossfadeA ? 'rgba(255,170,34,0.2)' : i === crossfadeB ? 'rgba(51,255,102,0.2)' : 'rgba(68,187,255,0.1)',
                  color: i === crossfadeA ? AMBER : i === crossfadeB ? PHOSPHOR : '#44bbff',
                  fontSize: 8, fontFamily: 'monospace', fontWeight: 600, cursor: 'pointer',
                  outline: (i === crossfadeA || i === crossfadeB) ? `1px solid ${i === crossfadeA ? AMBER : PHOSPHOR}44` : 'none',
                }}>
                {i === crossfadeA ? 'A ' : i === crossfadeB ? 'B ' : ''}{sc.name}
              </button>
            ))}
            {crossfadeA != null && crossfadeB != null && (
              <>
                <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.08)', margin: '0 2px' }} />
                <span style={{ fontSize: 7, color: AMBER, fontFamily: 'monospace', fontWeight: 700 }}>A</span>
                <input type="range" min={0} max={1} step={0.01} defaultValue={0}
                  onMouseDown={e => e.stopPropagation()}
                  onChange={e => handleCrossfade(Number(e.target.value))}
                  style={{ width: 60, accentColor: PHOSPHOR, cursor: 'pointer' }}
                  title="Crossfade A ↔ B" />
                <span style={{ fontSize: 7, color: PHOSPHOR, fontFamily: 'monospace', fontWeight: 700 }}>B</span>
                <button onClick={() => { setCrossfadeA(null); setCrossfadeB(null) }}
                  style={{ padding: '1px 4px', border: 'none', borderRadius: 3, background: 'rgba(255,68,68,0.1)', color: '#ff4444', fontSize: 7, fontFamily: 'monospace', cursor: 'pointer' }}>×</button>
              </>
            )}
            <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.08)', margin: '0 2px' }} />
            <button onClick={() => setShowXY(v => !v)}
              title="XY Pad — control two params with one touch"
              style={{
                padding: '2px 6px', border: 'none', borderRadius: 10,
                background: showXY ? 'rgba(51,255,102,0.12)' : 'rgba(255,255,255,0.04)',
                color: showXY ? PHOSPHOR : '#444',
                fontSize: 8, fontFamily: 'monospace', fontWeight: 700, cursor: 'pointer',
              }}>XY</button>
          </div>

          {/* ── Bottom: Master FX ── */}
          <div style={{
            borderTop: '1px solid rgba(255,255,255,0.06)',
            flexShrink: 0, background: 'rgba(0,0,0,0.08)',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 8, padding: '8px 16px 4px',
            }}>
              {showXY && (
                <div onMouseDown={e => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  <XYPad onMove={handleXYMove} size={76} />
                  <div style={{ display: 'flex', gap: 2 }}>
                    {XY_PRESETS.map((p, i) => (
                      <button key={i} onClick={() => setXyPreset(i)}
                        style={{
                          padding: '1px 4px', border: 'none', borderRadius: 3,
                          background: i === xyPreset ? 'rgba(51,255,102,0.15)' : 'transparent',
                          color: i === xyPreset ? PHOSPHOR : '#444',
                          fontSize: 7, fontFamily: 'monospace', fontWeight: 700, cursor: 'pointer',
                        }}>{p.label}</button>
                    ))}
                  </div>
                </div>
              )}
              <SynthKnob label="VOL" value={volume} min={0} max={1} size={44}
                accent={PHOSPHOR} fmt={v => `${Math.round(v * 100)}%`}
                onChange={v => { setVolume(v); serviceRef.current?.setVolume(v) }} />
              <SynthKnob label="LPF" value={lpf} min={100} max={20000} size={44} log
                accent="#44aaff" fmt={v => v >= 10000 ? `${(v / 1000).toFixed(0)}k` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`}
                onChange={setLpf} />
              <SynthKnob label="HPF" value={hpf} min={20} max={5000} size={44} log
                accent="#ff8844" fmt={v => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`}
                onChange={setHpf} />
              <SynthKnob label="DLY" value={delay} min={0} max={0.9} size={44}
                accent="#aa88ff" fmt={v => `${Math.round(v * 100)}%`}
                onChange={setDelay} />
              <SynthKnob label="RVB" value={reverb} min={0} max={1} size={44}
                accent="#88ffcc" fmt={v => `${Math.round(v * 100)}%`}
                onChange={setReverb} />
            </div>

            {/* ── Settings row ── */}
            <div onMouseDown={e => e.stopPropagation()} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 8, padding: '2px 16px 8px',
            }}>
              <button onClick={() => setShowSettings(p => !p)}
                style={{ ...tinyBtn, color: showSettings ? AMBER : '#555' }}
                title="AI settings">
                ⚙ {model.replace('gemini-', '').replace('-preview', '')}
              </button>
              <div style={{
                fontSize: 8, fontFamily: 'monospace', color: '#444',
                letterSpacing: '0.15em', textTransform: 'uppercase',
              }}>master fx</div>
              <button
                onClick={() => setShowApiKey(!showApiKey)}
                style={{
                  ...tinyBtn,
                  color: getApiKey() ? PHOSPHOR_DIM : '#ff4444',
                  borderColor: getApiKey() ? 'rgba(26,153,64,0.2)' : 'rgba(255,68,68,0.2)',
                }}>
                {hasEnvKey() ? '● ENV' : getApiKey() ? '● KEY' : '○ SET KEY'}
              </button>
            </div>

            {/* ── Collapsible settings ── */}
            {showSettings && (
              <div style={{
                padding: '6px 16px 10px', borderTop: '1px solid rgba(255,255,255,0.04)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#555' }}>MODEL</span>
                  <select value={model}
                    onChange={e => { setModelLocal(e.target.value as GeminiModel); setModel(e.target.value as GeminiModel) }}
                    style={selectStyle}>
                    <option value="gemini-2.5-flash">2.5 Flash</option>
                    <option value="gemini-3.5-flash">3.5 Flash</option>
                    <option value="gemini-3.1-pro-preview">3.1 Pro</option>
                  </select>
                </div>
                <div style={{ fontSize: 8, fontFamily: 'monospace', color: '#444' }}>
                  styles: {getAvailableStyles().join(' · ')}
                </div>
              </div>
            )}
          </div>

          {/* ── API Key Modal ── */}
          {showApiKey && (
            <div style={{
              position: 'absolute', bottom: 70, left: '50%', transform: 'translateX(-50%)',
              background: 'var(--bg-popup)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 'var(--radius-sm)',
              padding: 16, width: 320, zIndex: 10,
              boxShadow: '0 12px 40px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.07)',
            }}>
              <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-40)', marginBottom: 8 }}>
                Gemini API Key (BYOK)
              </div>
              <input
                type="password"
                value={apiKey}
                onChange={e => setApiKeyLocal(e.target.value)}
                placeholder="AIza..."
                style={{
                  width: '100%', background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.08)', borderRadius: 3,
                  padding: '6px 10px', color: '#ccc', fontFamily: 'monospace', fontSize: 12,
                  outline: 'none', marginBottom: 8, boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => setShowApiKey(false)} style={modalBtn('rgba(255,255,255,0.1)')}>Cancel</button>
                <button onClick={saveApiKeyHandler} style={modalBtn(PHOSPHOR_DIM)}>Save</button>
              </div>
              <div style={{ fontSize: 9, color: 'var(--text-30)', marginTop: 8, fontFamily: 'monospace' }}>
                Get your key at ai.google.dev/aistudio
              </div>
            </div>
          )}
        </div>
      </Rnd>
    </CaptureIdContext.Provider>
  )
}

function stripCodeBlocks(text: string): string {
  let result = text.replace(/```[\s\S]*?```/g, '')
  result = result.replace(/```[\s\S]*$/g, '')
  return result.trim()
}

function formatMessageText(text: string): string {
  return stripCodeBlocks(text)
}

function powerBtnStyle(isOn: boolean): React.CSSProperties {
  return {
    padding: '2px 8px', borderRadius: 2, border: 'none', cursor: 'pointer',
    fontFamily: 'monospace', fontSize: 9, fontWeight: 900, letterSpacing: '0.15em',
    background: isOn ? 'rgba(26,153,64,0.15)' : 'rgba(255,255,255,0.05)',
    color: isOn ? PHOSPHOR_DIM : '#555',
  }
}

function transportIconBtn(active: boolean): React.CSSProperties {
  return {
    width: 26, height: 22, borderRadius: 3, border: 'none',
    background: active ? 'rgba(26,153,64,0.15)' : 'rgba(255,255,255,0.05)',
    color: active ? PHOSPHOR : '#666',
    fontFamily: 'monospace', fontSize: 12, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  }
}

const tinyBtn: React.CSSProperties = {
  padding: '2px 8px', borderRadius: 3, cursor: 'pointer',
  border: '1px solid rgba(255,255,255,0.06)', background: 'transparent',
  fontFamily: 'monospace', fontSize: 9, letterSpacing: '0.05em',
}

const selectStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)', color: '#888',
  border: '1px solid rgba(255,255,255,0.08)', borderRadius: 3,
  padding: '1px 4px', fontSize: 9, fontFamily: 'monospace',
}

function modalBtn(bg: string): React.CSSProperties {
  return {
    padding: '4px 14px', borderRadius: 3, border: 'none',
    background: bg, color: '#ccc', fontFamily: 'monospace',
    fontSize: 11, fontWeight: 700, cursor: 'pointer',
  }
}

const scanlineOverlayStyle: React.CSSProperties = {
  position: 'absolute', inset: 0, pointerEvents: 'none',
  background: scanlinesBg, zIndex: 2,
}
