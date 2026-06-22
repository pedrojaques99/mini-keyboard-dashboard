import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'

import { Rnd } from 'react-rnd'

import { AppKnob } from './components/AppKnob'

import type { DeckPublicState } from './components/AudioMixer'

import type { SbChannel } from './lib/types'

import type { PanelDef, PanelId } from './components/CommandPalette'

import { ErrorBoundary } from './components/ErrorBoundary'

import { ShieldAlert } from './components/ShieldAlert'

/* ── Lazy-loaded panels (code-split per chunk) ─────────────────── */

const AudioMixer = React.lazy(() => import('./components/AudioMixer').then(m => ({ default: m.AudioMixer })))

const SoundboardPanel = React.lazy(() => import('./components/SoundboardPanel').then(m => ({ default: m.SoundboardPanel })))

const OBSControlPanel = React.lazy(() => import('./components/OBSControlPanel').then(m => ({ default: m.OBSControlPanel })))

const BriefingPanel = React.lazy(() => import('./components/BriefingPanel').then(m => ({ default: m.BriefingPanel })))

const YouTubeChatPanel = React.lazy(() => import('./components/YouTubeChatPanel').then(m => ({ default: m.YouTubeChatPanel })))

const TimerPanel = React.lazy(() => import('./components/TimerPanel').then(m => ({ default: m.TimerPanel })))

const DronePanel = React.lazy(() => import('./components/DronePanel').then(m => ({ default: m.DronePanel })))

const PaulstretchPanel = React.lazy(() => import('./components/PaulstretchPanel').then(m => ({ default: m.PaulstretchPanel })))

const SynthPanel = React.lazy(() => import('./components/SynthPanel').then(m => ({ default: m.SynthPanel })))

const ExporterPanel = React.lazy(() => import('./components/ExporterPanel').then(m => ({ default: m.ExporterPanel })))

const ConverterPanel = React.lazy(() => import('./components/ConverterPanel').then(m => ({ default: m.ConverterPanel })))

const YTDownloadPanel = React.lazy(() => import('./components/YTDownloadPanel').then(m => ({ default: m.YTDownloadPanel })))

const LoopLabPanel = React.lazy(() => import('./components/LoopLabPanel').then(m => ({ default: m.LoopLabPanel })))

const SessionPanel = React.lazy(() => import('./components/SessionPanel').then(m => ({ default: m.SessionPanel })))

const ConfigPanel = React.lazy(() => import('./components/ConfigPanel').then(m => ({ default: m.ConfigPanel })))

const VisualizerPanel = React.lazy(() => import('./components/VisualizerPanel').then(m => ({ default: m.VisualizerPanel })))

const RetroTVPanel = React.lazy(() => import('./components/RetroTVPanel').then(m => ({ default: m.RetroTVPanel })))

const DrumMachinePanel = React.lazy(() => import('./components/DrumMachinePanel').then(m => ({ default: m.DrumMachinePanel })))

const AudioPlayerPanel = React.lazy(() => import('./components/AudioPlayerPanel').then(m => ({ default: m.AudioPlayerPanel })))

const SynesthizerPanel = React.lazy(() => import('./components/SynesthizerPanel').then(m => ({ default: m.SynesthizerPanel })))

const AnalogBrainPanel = React.lazy(() => import('./components/AnalogBrainPanel').then(m => ({ default: m.AnalogBrainPanel })))

const CommandPalette = React.lazy(() => import('./components/CommandPalette').then(m => ({ default: m.CommandPalette })))

import { API, checkBackend, isBackendOnline, resolveUrl } from './lib/api'

import { loadGeo, saveGeo } from './lib/geo'

import { closeBtnStyle } from './lib/styles'

import { PanelHeader } from './lib/PanelHeader'

import { PanelProvider, usePanelCtx } from './lib/panel-context'

import { KeyTile } from './lib/KeyTile'

import { PresetFloating } from './components/PresetFloating'

import { applyPositions, type Preset } from './lib/presets'

import { TransformWrapper, TransformComponent, type ReactZoomPanPinchRef } from 'react-zoom-pan-pinch'

import './index.css'



const KEYS_H = [
  'key_f13','key_f14','key_f15',
  'key_f16','key_f17','key_f18',
  'key_f19','key_f20','key_f21',
  'key_f22','key_f23','key_f24',
]

// Rotated 90° CCW for vertical orientation (3cols×4rows)
const KEYS_V = [
  'key_f16','key_f20','key_f24',
  'key_f15','key_f19','key_f23',
  'key_f14','key_f18','key_f22',
  'key_f13','key_f17','key_f21',
]



function fmtTime(s: number) {

  if (!isFinite(s) || s < 0) return '0:00'

  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

}



// eslint-disable-next-line @typescript-eslint/no-unused-vars

const _ICON: Record<string, string> = {

  play_audio: 'ðŸ"ˆ',

  open_app:   '🚀',

  run_script: 'ðŸ"œ',

}



type Action = { type?: string; path?: string; args?: string; label?: string }

type Config = { buttons?: Record<string, Action> }



const IS_CLOUD = import.meta.env.VITE_DEPLOY_MODE === 'cloud'

const LOCAL_ONLY_PANELS: Set<string> = new Set(['obs', 'ytchat', 'briefing'])



export default function App() {

  return <PanelProvider><AppInner /></PanelProvider>

}



function AppInner() {

  const { scale, setScale, zOf, bringToFront, endDrag, isDragging, focusedPanel } = usePanelCtx()

  const transformRef = useRef<ReactZoomPanPinchRef>(null)
  const focusedPanelRef = useRef<string | null>(null)
  const closeFocusedRef = useRef<() => void>(() => {})

  const [isSpacePressed, setIsSpacePressed] = useState(false)
  const [isMiddleDragging, setIsMiddleDragging] = useState(false)

  const [config, setConfig] = useState<Config>({})

  const [selected, setSelected] = useState<string | null>(null)

  const [dragOver, setDragOver] = useState<string | null>(null)

  const [online, setOnline] = useState(false)

  const [showKeys, setShowKeys] = useState(() => localStorage.getItem('panel-keys') !== 'false')

  const [verticalKeys, setVerticalKeys] = useState(() => localStorage.getItem('keys-vertical') !== 'false')

  const [showMixer, setShowMixer] = useState(() => localStorage.getItem('panel-mixer') !== 'false')

  const [mixerMinimized, setMixerMinimized] = useState(() => localStorage.getItem('mixer-minimized') === 'true')

  const [showSoundboard, setShowSoundboard] = useState(() => localStorage.getItem('panel-soundboard') !== 'false')

  const [showOBS, setShowOBS] = useState(() => localStorage.getItem('panel-obs') === 'true')

  const [showBriefing, setShowBriefing] = useState(() => localStorage.getItem('panel-briefing') === 'true')

  const [showYTChat, setShowYTChat] = useState(() => localStorage.getItem('panel-ytchat') === 'true')

  const [showTimer, setShowTimer] = useState(() => localStorage.getItem('panel-timer') === 'true')

  const [showDrone, setShowDrone] = useState(() => localStorage.getItem('panel-drone') === 'true')

  const [showPaul, setShowPaul] = useState(() => localStorage.getItem('panel-paul') === 'true')

  const [synthIds, setSynthIds] = useState<string[]>(() => {

    const saved = localStorage.getItem('panel-synth-ids')

    if (saved) try { const arr = JSON.parse(saved); if (Array.isArray(arr) && arr.length) return arr } catch {}

    return localStorage.getItem('panel-synth') === 'true' ? ['synth-0'] : []

  })

  const showSynth = synthIds.length > 0

  const setShowSynth = (v: boolean | ((prev: boolean) => boolean)) => {

    setSynthIds(prev => {

      const wasOpen = prev.length > 0

      const val = typeof v === 'function' ? v(wasOpen) : v

      if (!val) return []

      // Toggle on or add another instance

      return [...prev, `synth-${Date.now()}`]

    })

  }

  const [showExporter, setShowExporter] = useState(() => localStorage.getItem('panel-exporter') === 'true')

  const [showConverter, setShowConverter] = useState(() => localStorage.getItem('panel-converter') === 'true')

  const [showYTDL, setShowYTDL] = useState(() => localStorage.getItem('panel-ytdl') === 'true')

  const [showLoopLab, setShowLoopLab] = useState(() => localStorage.getItem('panel-looplab') === 'true')

  const [drumIds, setDrumIds] = useState<string[]>(() => {

    const saved = localStorage.getItem('panel-drum-ids')

    if (saved) try { const arr = JSON.parse(saved); if (Array.isArray(arr) && arr.length) return arr } catch {}

    return localStorage.getItem('panel-drummachine') === 'true' ? ['drum-0'] : []

  })

  const showDrumMachine = drumIds.length > 0

  const setShowDrumMachine = (v: boolean | ((prev: boolean) => boolean)) => {

    setDrumIds(prev => {

      const wasOpen = prev.length > 0

      const val = typeof v === 'function' ? v(wasOpen) : v

      if (!val) return []

      return [...prev, `drum-${Date.now()}`]

    })

  }

  const [showSession, setShowSession] = useState(() => localStorage.getItem('panel-session') === 'true')

  const [showVisualizer, setShowVisualizer] = useState(() => localStorage.getItem('panel-visualizer') === 'true')

  const [showAudioPlayer, setShowAudioPlayer] = useState(() => localStorage.getItem('panel-audioplayer') === 'true')

  const [showSynesthizer, setShowSynesthizer] = useState(() => localStorage.getItem('panel-synesthizer') === 'true')

  const [showAnalogBrain, setShowAnalogBrain] = useState(() => localStorage.getItem('panel-analogbrain') === 'true')

  const [retroTVIds, setRetroTVIds] = useState<string[]>(() => {

    const saved = localStorage.getItem('panel-retrotv-ids')

    if (saved) try { const arr = JSON.parse(saved); if (Array.isArray(arr) && arr.length) return arr } catch {}

    return localStorage.getItem('panel-retrotv') === 'true' ? ['retrotv-0'] : []

  })

  const showRetroTV = retroTVIds.length > 0

  const setShowRetroTV = (v: boolean | ((prev: boolean) => boolean)) => {

    setRetroTVIds(prev => {

      const wasOpen = prev.length > 0

      const val = typeof v === 'function' ? v(wasOpen) : v

      if (!val) return []

      return [...prev, `retrotv-${Date.now()}`]

    })

  }

  const deckTogglersRef = useRef<Record<string, () => void>>({})

  const deckSyncersRef = useRef<Record<string, (forcePlaying?: boolean) => void>>({})

  const deckVolumersRef = useRef<Record<string, (v: number) => void>>({})

  const [playingKeys, setPlayingKeys] = useState<Set<string>>(new Set())

  const [deckStates, setDeckStates] = useState<Record<string, DeckPublicState>>({})



  // Coalesce updates de timeupdate em buckets de animation-frame â€"

  // mÃºltiplos decks tocando juntos = 1 setState por frame, nÃ£o N.

  const pendingDeckStates = useRef<Record<string, DeckPublicState>>({})

  const deckFlushScheduled = useRef(false)

  const handleDeckStateChange = useCallback((keyId: string, s: DeckPublicState) => {

    pendingDeckStates.current[keyId] = s

    if (deckFlushScheduled.current) return

    deckFlushScheduled.current = true

    requestAnimationFrame(() => {

      deckFlushScheduled.current = false

      const patch = pendingDeckStates.current

      pendingDeckStates.current = {}

      setDeckStates(prev => ({ ...prev, ...patch }))

    })

  }, [])

  const [sbChannels, setSbChannels] = useState<SbChannel[]>([])

  const [showPalette, setShowPalette] = useState(false)

  const [sidebarConfig, setSidebarConfig] = useState<Record<string, boolean>>(() => {

    try { return JSON.parse(localStorage.getItem('sidebar-config') || '{}') } catch { return {} }

  })

  type SidebarFolder = { id: string; name: string; panelIds: PanelId[]; collapsed: boolean; color: string }

  const FOLDER_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#ef4444', '#06b6d4']

  const [sidebarFolders, setSidebarFolders] = useState<SidebarFolder[]>(() => {

    try { return JSON.parse(localStorage.getItem('sidebar-folders') || '[]') } catch { return [] }

  })

  useEffect(() => { localStorage.setItem('sidebar-folders', JSON.stringify(sidebarFolders)) }, [sidebarFolders])

  const [ctxMenu, setCtxMenu] = useState<{ key: string; x: number; y: number } | null>(null)

  const [ctxSrc, setCtxSrc] = useState('')
  const [ctxLabel, setCtxLabel] = useState('')

  const [ctxSaving, setCtxSaving] = useState(false)

  const ctxRef = useRef<HTMLDivElement>(null)



  useEffect(() => {

    checkBackend().then(ok => {

      if (!ok) { setOnline(false); return }

      fetch(`${API}/api/config`)

        .then(r => r.json())

        .then(d => { setConfig(d); setOnline(true) })

        .catch(() => setOnline(false))

    })

  }, [])



  // Persist visibilidade â€" 1 useEffect por chave evita 11 setItem por toggle.

  useEffect(() => { localStorage.setItem('panel-keys', String(showKeys)) }, [showKeys])
  useEffect(() => { localStorage.setItem('keys-vertical', String(verticalKeys)) }, [verticalKeys])

  useEffect(() => { localStorage.setItem('panel-mixer', String(showMixer)) }, [showMixer])

  useEffect(() => { localStorage.setItem('panel-soundboard', String(showSoundboard)) }, [showSoundboard])

  useEffect(() => { localStorage.setItem('panel-obs', String(showOBS)) }, [showOBS])

  useEffect(() => { localStorage.setItem('panel-briefing', String(showBriefing)) }, [showBriefing])

  useEffect(() => { localStorage.setItem('panel-ytchat', String(showYTChat)) }, [showYTChat])

  useEffect(() => { localStorage.setItem('panel-timer', String(showTimer)) }, [showTimer])

  useEffect(() => { localStorage.setItem('panel-drone', String(showDrone)) }, [showDrone])

  useEffect(() => { localStorage.setItem('panel-paul', String(showPaul)) }, [showPaul])

  useEffect(() => { localStorage.setItem('panel-synth', String(showSynth)); localStorage.setItem('panel-synth-ids', JSON.stringify(synthIds)) }, [synthIds])

  useEffect(() => { localStorage.setItem('panel-exporter', String(showExporter)) }, [showExporter])

  useEffect(() => { localStorage.setItem('panel-converter', String(showConverter)) }, [showConverter])

  useEffect(() => { localStorage.setItem('panel-ytdl', String(showYTDL)) }, [showYTDL])

  useEffect(() => { localStorage.setItem('panel-looplab', String(showLoopLab)) }, [showLoopLab])

  useEffect(() => { localStorage.setItem('panel-drummachine', String(showDrumMachine)); localStorage.setItem('panel-drum-ids', JSON.stringify(drumIds)) }, [drumIds, showDrumMachine])

  useEffect(() => { localStorage.setItem('panel-session', String(showSession)) }, [showSession])

  useEffect(() => { localStorage.setItem('panel-visualizer', String(showVisualizer)) }, [showVisualizer])

  useEffect(() => { localStorage.setItem('panel-audioplayer', String(showAudioPlayer)) }, [showAudioPlayer])

  useEffect(() => { localStorage.setItem('panel-synesthizer', String(showSynesthizer)) }, [showSynesthizer])
  useEffect(() => { localStorage.setItem('panel-analogbrain', String(showAnalogBrain)) }, [showAnalogBrain])

  useEffect(() => { localStorage.setItem('panel-retrotv', String(showRetroTV)); localStorage.setItem('panel-retrotv-ids', JSON.stringify(retroTVIds)) }, [retroTVIds])



  /* â"€â"€ Physical keyboard bridge: long-poll Flask, pausa em background â"€â"€ */

  useEffect(() => {

    let active = true

    let wakeup: (() => void) | null = null

    function waitVisible(): Promise<void> {

      if (!document.hidden) return Promise.resolve()

      return new Promise(res => { wakeup = res })

    }

    function onVis() {

      if (!document.hidden && wakeup) { const fn = wakeup; wakeup = null; fn() }

    }

    document.addEventListener('visibilitychange', onVis)



    async function poll() {

      if (!isBackendOnline()) return

      let backoff = 500

      while (active) {

        await waitVisible()

        if (!active) break

        try {

          const r = await fetch(`${API}/api/key-event/poll?timeout=2`, { signal: AbortSignal.timeout(3500) })

          const ev = await r.json()

          backoff = 500

          if (ev.key) {

            const syncer = deckSyncersRef.current[ev.key]

            const toggler = deckTogglersRef.current[ev.key]

            ;(syncer ?? toggler)?.()

          }

        } catch {

          if (active) await new Promise(res => setTimeout(res, backoff))

          backoff = Math.min(backoff * 2, 10_000)

          continue

        }

        if (active) await new Promise(res => setTimeout(res, 50))

      }

    }

    poll()

    return () => { active = false; document.removeEventListener('visibilitychange', onVis); wakeup?.() }

  }, [])



  /* â"€â"€ Ctrl+K palette â"€â"€ */

  useEffect(() => {

    const handler = (e: KeyboardEvent) => {

      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); setShowPalette(v => !v) }

    }

    document.addEventListener('keydown', handler)

    return () => document.removeEventListener('keydown', handler)

  }, [])



  function isSidebarVisible(id: string, defaultVal: boolean) {

    return sidebarConfig[id] !== undefined ? sidebarConfig[id] : defaultVal

  }



  function handleChangeSidebar(id: PanelId, val: boolean) {

    const next = { ...sidebarConfig, [id]: val }

    setSidebarConfig(next)

    localStorage.setItem('sidebar-config', JSON.stringify(next))

  }

  function createFolder() {
    setSidebarFolders(prev => [...prev, { id: `folder-${Date.now()}`, name: 'New Folder', panelIds: [], collapsed: false, color: FOLDER_COLORS[prev.length % FOLDER_COLORS.length] }])
  }
  function deleteFolder(folderId: string) {
    setSidebarFolders(prev => prev.filter(f => f.id !== folderId))
  }
  function renameFolder(folderId: string, name: string) {
    setSidebarFolders(prev => prev.map(f => f.id === folderId ? { ...f, name } : f))
  }
  function toggleFolderCollapse(folderId: string) {
    setSidebarFolders(prev => prev.map(f => f.id === folderId ? { ...f, collapsed: !f.collapsed } : f))
  }
  function changeFolderColor(folderId: string) {
    setSidebarFolders(prev => prev.map(f => {
      if (f.id !== folderId) return f
      const idx = (FOLDER_COLORS.indexOf(f.color) + 1) % FOLDER_COLORS.length
      return { ...f, color: FOLDER_COLORS[idx] }
    }))
  }
  function addPanelToFolder(folderId: string, panelId: PanelId) {
    setSidebarFolders(prev => prev.map(f => {
      if (f.id === folderId) return { ...f, panelIds: f.panelIds.includes(panelId) ? f.panelIds : [...f.panelIds, panelId], collapsed: false }
      return { ...f, panelIds: f.panelIds.filter(p => p !== panelId) }
    }))
  }
  function removePanelFromFolder(panelId: PanelId) {
    setSidebarFolders(prev => prev.map(f => ({ ...f, panelIds: f.panelIds.filter(p => p !== panelId) })))
  }



  function getViewportCenter(): { x: number; y: number } {

    const t = transformRef.current

    if (!t) return { x: 300, y: 200 }

    const { positionX, positionY, scale: s } = t.state

    const vw = window.innerWidth - 56

    const vh = window.innerHeight

    return {

      x: (vw / 2 - positionX) / s,

      y: (vh / 2 - positionY) / s,

    }

  }

  function fitToPanels() {
    const t = transformRef.current
    if (!t) return
    const panels = document.querySelectorAll('.panel-drag')
    if (!panels.length) { t.setTransform(0, 0, 1, 300); setScale(1); return }
    const s = t.state.scale
    const px = t.state.positionX
    const py = t.state.positionY
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    panels.forEach(el => {
      const r = (el as HTMLElement).getBoundingClientRect()
      const x = (r.left - 56 - px) / s
      const y = (r.top - py) / s
      const w = r.width / s
      const h = r.height / s
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x + w > maxX) maxX = x + w
      if (y + h > maxY) maxY = y + h
    })
    const PAD = 60
    const vw = window.innerWidth - 56
    const vh = window.innerHeight
    const contentW = maxX - minX + PAD * 2
    const contentH = maxY - minY + PAD * 2
    const newScale = Math.min(2, Math.max(0.1, Math.min(vw / contentW, vh / contentH)))
    const newX = (vw - contentW * newScale) / 2 - (minX - PAD) * newScale
    const newY = (vh - contentH * newScale) / 2 - (minY - PAD) * newScale
    t.setTransform(newX, newY, newScale, 300)
    setScale(newScale)
  }



  const panelGeoKey: Record<string, string> = {

    keys: 'keyboard', mixer: 'mixer', soundboard: 'soundboard',

    obs: 'obs', briefing: 'briefing', ytchat: 'ytchat',

    timer: 'timer', drone: 'drone', paul: 'paulstretch',

    exporter: 'exporter', converter: 'converter', looplab: 'looplab', drummachine: 'drummachine',

    session: 'session', visualizer: 'visualizer', config: 'config', audioplayer: 'audioplayer',

  }



  function preSaveSpawnGeo(geoKey: string) {

    if (localStorage.getItem(`panel-geo-${geoKey}`)) return

    const center = getViewportCenter()

    saveGeo(geoKey, { x: center.x - 180, y: center.y - 150 })

  }



  const MULTI_INSTANCE_PANELS = new Set<PanelId>(['synth', 'drummachine', 'retrotv'])

  function handleTogglePanel(id: PanelId) {

    const setters: Record<PanelId, React.Dispatch<React.SetStateAction<boolean>>> = {

      keys: setShowKeys, mixer: setShowMixer, soundboard: setShowSoundboard,

      obs: setShowOBS, briefing: setShowBriefing, ytchat: setShowYTChat,

      timer: setShowTimer, drone: setShowDrone, paul: setShowPaul, synth: setShowSynth,

      exporter: setShowExporter, converter: setShowConverter, looplab: setShowLoopLab, drummachine: setShowDrumMachine, session: setShowSession, visualizer: setShowVisualizer, retrotv: setShowRetroTV, ytdl: setShowYTDL, audioplayer: setShowAudioPlayer, synesthizer: setShowSynesthizer, analogbrain: setShowAnalogBrain,

    }

    const geoKey = panelGeoKey[id]

    if (geoKey) preSaveSpawnGeo(geoKey)

    setters[id]?.(v => !v)

  }

  function handleAddInstance(id: PanelId) {

    if (id === 'synth') {

      const newId = `synth-${Date.now()}`

      const center = getViewportCenter()

      saveGeo(newId, { x: center.x - 260 + Math.random() * 40, y: center.y - 150 + Math.random() * 40 })

      setSynthIds(prev => [...prev, newId])

      setShowSynth(true)

    } else if (id === 'retrotv') {

      const newId = `retrotv-${Date.now()}`

      const center = getViewportCenter()

      saveGeo(newId, { x: center.x - 240 + Math.random() * 60, y: center.y - 150 + Math.random() * 60 })

      setRetroTVIds(prev => [...prev, newId])

      setShowRetroTV(true)

    } else if (id === 'drummachine') {

      const newId = `drum-${Date.now()}`

      const center = getViewportCenter()

      saveGeo(newId, { x: center.x - 200 + Math.random() * 40, y: center.y - 100 + Math.random() * 40 })

      setDrumIds(prev => [...prev, newId])

      setShowDrumMachine(true)

    }

  }

  focusedPanelRef.current = focusedPanel
  closeFocusedRef.current = () => {
    const fp = focusedPanel
    if (!fp) return
    const setters: Record<string, React.Dispatch<React.SetStateAction<boolean>>> = {
      keys: setShowKeys, keyboard: setShowKeys, mixer: setShowMixer, soundboard: setShowSoundboard,
      obs: setShowOBS, briefing: setShowBriefing, ytchat: setShowYTChat,
      timer: setShowTimer, drone: setShowDrone, paul: setShowPaul, paulstretch: setShowPaul,
      synth: setShowSynth, exporter: setShowExporter, converter: setShowConverter,
      looplab: setShowLoopLab, drummachine: setShowDrumMachine, session: setShowSession,
      visualizer: setShowVisualizer, retrotv: setShowRetroTV, ytdl: setShowYTDL, audioplayer: setShowAudioPlayer, synesthizer: setShowSynesthizer,
    }
    if (fp.startsWith('synth-')) { setSynthIds(prev => prev.filter(x => x !== fp)); return }
    if (fp.startsWith('retrotv-')) { setRetroTVIds(prev => prev.filter(x => x !== fp)); return }
    if (fp.startsWith('drum-')) { setDrumIds(prev => prev.filter(x => x !== fp)); return }
    setters[fp]?.(false)
  }

  /* close ctx menu on outside click */

  useEffect(() => {

    if (!ctxMenu) return

    const handler = (e: MouseEvent) => {

      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setCtxMenu(null)

    }

    document.addEventListener('mousedown', handler)

    return () => document.removeEventListener('mousedown', handler)

  }, [ctxMenu])



  async function saveCtxSrc() {

    if (!ctxMenu) return

    setCtxSaving(true)

    const key = ctxMenu.key

    const existing = config.buttons?.[key] || {}

    const next = { ...config, buttons: { ...config.buttons, [key]: { ...existing, path: ctxSrc, label: ctxLabel.trim() || ctxSrc.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || '' } } }

    try {

      await fetch(`${API}/api/config`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) })

      setConfig(next)

    } catch { /* ignore save errors */ }

    setCtxSaving(false)

    setCtxMenu(null)

  }



  async function handleDrop(key: string, file: File) {

    const fd = new FormData()

    fd.append('file', file)

    try {

      const r = await fetch(resolveUrl('/api/upload'), { method: 'POST', body: fd })

      const res = await r.json()

      if (res.status === 'success') {

        let type = 'open_app'

        if (file.name.match(/\.(mp3|wav|ogg|flac|m4a)$/i)) type = 'play_audio'

        if (file.name.endsWith('.ps1')) type = 'run_script'

        const next = {

          ...config,

          buttons: { ...config.buttons, [key]: { type, path: res.path, args: '', label: file.name } },

        }

        await fetch(`${API}/api/config`, {

          method: 'POST',

          headers: { 'Content-Type': 'application/json' },

          body: JSON.stringify(next),

        })

        setConfig(next)

      }

    } catch (e) { console.error('drop failed', e) }

  }



  function loadPreset(preset: Preset) {

    const v = preset.visibility

    setShowKeys(v.keys)

    setShowMixer(v.mixer)

    setShowSoundboard(v.soundboard)

    setShowOBS(v.obs)

    setShowBriefing(v.briefing)

    setShowYTChat(v.ytchat)

    setShowTimer(v.timer)

    setShowDrone(v.drone)

    setShowPaul(v.paul)

    setShowSynth(v.synth)

    setShowExporter(v.exporter ?? false)

    setShowConverter(v.converter ?? false)

    setShowLoopLab(v.looplab ?? false)

    setShowDrumMachine(v.drummachine ?? false)

    setShowSession(v.session ?? false)

    setShowRetroTV((v as Record<string,boolean>).retrotv ?? false)

    applyPositions(preset.positions)

    if (preset.scale && transformRef.current) {

      transformRef.current.setTransform(0, 0, preset.scale)

      setScale(preset.scale)

    }

  }



  const kbGeo  = loadGeo('keyboard',   { x: 20,  y: 20,  w: 420, h: 480 })

  const mxGeo  = loadGeo('mixer',      { x: 840, y: 20,  w: 320, h: 480 })



  const panelDefs: PanelDef[] = useMemo(() => [

    { id: 'keys',       label: 'Keyboard',       icon: '🎹', sidebar: isSidebarVisible('keys', true),        visible: showKeys },

    { id: 'mixer',      label: 'Audio Mixer',    icon: '🎚️', sidebar: isSidebarVisible('mixer', true),       visible: showMixer },

    { id: 'soundboard', label: 'Soundboard',     icon: '🎛️', sidebar: isSidebarVisible('soundboard', true),  visible: showSoundboard },

    { id: 'obs',        label: 'OBS Control',    icon: '🎬', sidebar: isSidebarVisible('obs', true),         visible: showOBS },

    { id: 'ytchat',     label: 'YouTube Chat',   icon: '💬', sidebar: isSidebarVisible('ytchat', true),      visible: showYTChat },

    { id: 'timer',      label: 'Timer',          icon: '⏰', sidebar: isSidebarVisible('timer', true),       visible: showTimer },

    { id: 'briefing',   label: 'Briefing',       icon: '📋', sidebar: isSidebarVisible('briefing', false),   visible: showBriefing },

    { id: 'session',    label: 'Session',        icon: '📼', sidebar: isSidebarVisible('session', true),     visible: showSession },

    { id: 'drone',      label: 'Drone',          icon: '🌊', sidebar: isSidebarVisible('drone', false),      visible: showDrone },

    { id: 'paul',       label: 'Paulstretch',    icon: '🔊', sidebar: isSidebarVisible('paul', false),       visible: showPaul },

    { id: 'synth',      label: 'Synth',          icon: '🎶', sidebar: isSidebarVisible('synth', true),       visible: showSynth },

    { id: 'looplab',    label: 'Loop Lab',       icon: '🔁', sidebar: isSidebarVisible('looplab', false),    visible: showLoopLab },

    { id: 'drummachine',label: 'Drum Machine',   icon: '🥁', sidebar: isSidebarVisible('drummachine', true), visible: showDrumMachine },

    { id: 'converter',  label: 'Converter',      icon: '🔄', sidebar: isSidebarVisible('converter', false),  visible: showConverter },

    { id: 'exporter',   label: 'Exporter',       icon: '💾', sidebar: isSidebarVisible('exporter', false),   visible: showExporter },

    { id: 'visualizer', label: 'Visualizer',     icon: '🌀', sidebar: isSidebarVisible('visualizer', false), visible: showVisualizer },

    { id: 'ytdl',       label: 'YT Download',    icon: '⬇️', sidebar: isSidebarVisible('ytdl', false),       visible: showYTDL },

    { id: 'retrotv',    label: 'Retro TV',       icon: '📺', sidebar: isSidebarVisible('retrotv', true),      visible: showRetroTV },

    { id: 'audioplayer',label: 'Audio Library',  icon: '📂', sidebar: isSidebarVisible('audioplayer', true),  visible: showAudioPlayer },

    { id: 'synesthizer',label: 'Synesthizer',   icon: '🎨', sidebar: isSidebarVisible('synesthizer', false), visible: showSynesthizer },
    { id: 'analogbrain',label: 'Analog Brain',  icon: '🧠', sidebar: isSidebarVisible('analogbrain', true),  visible: showAnalogBrain },

  // eslint-disable-next-line react-hooks/exhaustive-deps

  ], [showKeys, showMixer, showSoundboard, showOBS, showBriefing, showYTChat, showTimer, showDrone, showPaul, showSynth, showExporter, showConverter, showLoopLab, showDrumMachine, showSession, showVisualizer, showRetroTV, showYTDL, showAudioPlayer, showSynesthizer, showAnalogBrain, sidebarConfig]).filter(p => !IS_CLOUD || !LOCAL_ONLY_PANELS.has(p.id))



  /* â"€â"€ Figma-like cursors â"€â"€ */

  useEffect(() => {

    const down = (e: KeyboardEvent) => {

      if (e.key === 'Escape' && e.shiftKey) {
        e.preventDefault()
        fetch(`${API}/api/audio/stop-all`, { method: 'POST' })
        Object.values(deckSyncersRef.current).forEach(fn => fn(false))
      }
      if (e.key === 'Delete' && !['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName) && focusedPanelRef.current) {
        e.preventDefault()
        closeFocusedRef.current()
      }
      if (e.key === ' ' && !['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName)) {

        e.preventDefault()

        setIsSpacePressed(true)

      }

    }

    const up = (e: KeyboardEvent) => { if (e.key === ' ') setIsSpacePressed(false) }

    const onMouseDown = (e: MouseEvent) => { if (e.button === 1) setIsMiddleDragging(true) }
    const onMouseUp = (e: MouseEvent) => { if (e.button === 1) setIsMiddleDragging(false) }

    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mouseup', onMouseUp)

    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mouseup', onMouseUp)
    }

  }, [])



  /* â"€â"€ Adaptive wheel: zoom-aware speed, burst detection, gentle inertia â"€â"€ */

  const canvasRef = useRef<HTMLElement>(null)

  const velRef = useRef({ x: 0, y: 0 })

  const inertiaRef = useRef(0)

  const scrollHistRef = useRef<number[]>([])



  useEffect(() => {

    const el = canvasRef.current

    if (!el) return



    const FRICTION = 0.78

    const MIN_VEL = 0.2



    const tickInertia = () => {

      const v = velRef.current

      if (!transformRef.current) return

      const { state } = transformRef.current

      if (Math.abs(v.x) < MIN_VEL && Math.abs(v.y) < MIN_VEL) {

        v.x = 0; v.y = 0

        return

      }

      v.x *= FRICTION; v.y *= FRICTION

      transformRef.current.setTransform(

        state.positionX + v.x,

        state.positionY + v.y,

        state.scale,

        0,

      )

      inertiaRef.current = requestAnimationFrame(tickInertia)

    }



    const getScrollIntensity = () => {

      const now = performance.now()

      const hist = scrollHistRef.current

      hist.push(now)

      while (hist.length > 0 && now - hist[0] > 300) hist.shift()

      const eventsPerSec = hist.length / 0.3

      if (eventsPerSec > 25) return 1.8

      if (eventsPerSec > 12) return 1.2

      return 0.7

    }



    const handleCanvasWheel = (e: WheelEvent) => {

      if (!transformRef.current) return

      const target = e.target as HTMLElement
      const isZoom = e.ctrlKey || e.metaKey
      // Plain scroll over a panel belongs to that panel — its own scroll areas,
      // knobs, sliders and chat. But Ctrl/Cmd+scroll always zooms the canvas,
      // even over a panel, so we keep it (and preventDefault below stops the
      // browser's native page zoom).
      if (!isZoom && target.closest?.('.panel-drag')) return

      e.preventDefault()
      e.stopPropagation()

      const { state } = transformRef.current
      const { positionX, positionY, scale: currentScale } = state

      // Ctrl/Cmd+scroll = zoom toward mouse
      if (isZoom) {
        cancelAnimationFrame(inertiaRef.current)
        velRef.current = { x: 0, y: 0 }

        const wrapper = el.querySelector('.react-transform-component') as HTMLElement
        if (!wrapper) return
        const contentRect = wrapper.getBoundingClientRect()
        const mouseX = (e.clientX - contentRect.left) / currentScale
        const mouseY = (e.clientY - contentRect.top) / currentScale

        // Proportional zoom — multiply by a small factor instead of adding a fixed step
        const direction = e.deltaY > 0 ? -1 : 1
        const factor = 1 + direction * 0.06
        const newScale = Math.min(5, Math.max(0.05, currentScale * factor))
        if (newScale === currentScale) return

        const scaleDiff = newScale - currentScale
        const newX = positionX - mouseX * scaleDiff
        const newY = positionY - mouseY * scaleDiff

        transformRef.current.setTransform(newX, newY, newScale, 0)
        setScale(newScale)
        return
      }

      // Scroll without modifier = pan with inertia
      cancelAnimationFrame(inertiaRef.current)
      const intensity = getScrollIntensity()
      const zoomFactor = 1 / Math.max(0.3, currentScale)
      const speed = 0.5 * intensity * zoomFactor
      const clamp = (v: number, max: number) => Math.max(-max, Math.min(max, v))
      const maxD = 25 + intensity * 15
      const dX = clamp(e.deltaX, maxD)
      const dY = clamp(e.deltaY, maxD)
      let dx: number, dy: number
      if (e.shiftKey) {
        dx = -dY * speed; dy = 0
      } else {
        dx = -dX * speed; dy = -dY * speed
      }
      velRef.current = { x: dx * 0.4, y: dy * 0.4 }
      transformRef.current.setTransform(positionX + dx, positionY + dy, currentScale, 0)
      inertiaRef.current = requestAnimationFrame(tickInertia)

    }



    el.addEventListener('wheel', handleCanvasWheel, { passive: false })

    return () => {

      el.removeEventListener('wheel', handleCanvasWheel)

      cancelAnimationFrame(inertiaRef.current)

    }

  }, [])



  return (
    <div

      className="flex h-screen overflow-hidden font-['Outfit',sans-serif] text-[var(--text-pure)]"

      style={{ background: 'var(--bg-surface)', cursor: isMiddleDragging ? 'grabbing' : isSpacePressed ? 'grab' : 'default' }}

    >

      <ShieldAlert />

      {/* Background Glow */}

      <div

        className="fixed inset-0 pointer-events-none opacity-40"

        style={{ background: 'radial-gradient(circle at 50% -20%, rgba(60,65,80,0.15) 0%, transparent 80%)' }}

      />



      {/* Sidebar */}

      <aside

        className="w-[72px] border-r border-white/5 flex flex-col items-center gap-2 shrink-0 sticky top-0 z-20 overflow-y-auto overflow-x-hidden py-3 scrollbar-hide"

        style={{ background: 'linear-gradient(180deg,rgba(22,23,25,0.9) 0%,rgba(12,13,15,0.95) 100%)', backdropFilter: 'blur(20px)', height: '100vh' }}

      >

        {/* Ctrl+K button */}

        <button

          onClick={() => setShowPalette(v => !v)}

          title="Command Palette (Ctrl+K)"

          aria-label="Command palette"

          className={`sidebar-cmd${showPalette ? ' active' : ''}`}

        >⌘</button>



        <div className="w-8 h-px bg-white/[0.07]" />



        {/* Dynamic sidebar — folders + ungrouped panels */}

        {(() => {
          const sidebarPanels = panelDefs.filter(p => p.sidebar)
          const folderedIds = new Set(sidebarFolders.flatMap(f => f.panelIds))
          const ungrouped = sidebarPanels.filter(p => !folderedIds.has(p.id))

          return (
            <>
              {sidebarFolders.map(folder => {
                const folderPanels = folder.panelIds.map(id => sidebarPanels.find(p => p.id === id)).filter(Boolean) as PanelDef[]
                return (
                  <SidebarFolder
                    key={folder.id}
                    folder={folder}
                    panels={folderPanels}
                    onTogglePanel={handleTogglePanel}
                    onAddInstance={handleAddInstance}
                    multiInstanceIds={MULTI_INSTANCE_PANELS}
                    onToggleCollapse={() => toggleFolderCollapse(folder.id)}
                    onRename={(name) => renameFolder(folder.id, name)}
                    onDelete={() => deleteFolder(folder.id)}
                    onChangeColor={() => changeFolderColor(folder.id)}
                    onDropPanel={(panelId) => addPanelToFolder(folder.id, panelId)}
                    onRemovePanel={removePanelFromFolder}
                  />
                )
              })}

              <div
                className="flex flex-col items-center gap-2"
                onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
                onDrop={e => { e.preventDefault(); const pid = e.dataTransfer.getData('panel-id'); if (pid) removePanelFromFolder(pid as PanelId) }}
              >
                {ungrouped.map(p => (
                  <NavBtn
                    key={p.id}
                    active={p.visible}
                    onClick={() => handleTogglePanel(p.id)}
                    title={p.label}
                    canAdd={MULTI_INSTANCE_PANELS.has(p.id)}
                    onAdd={() => handleAddInstance(p.id)}
                    draggable
                    panelId={p.id}
                  >
                    {p.icon}
                  </NavBtn>
                ))}
              </div>
            </>
          )
        })()}

        {/* Create folder button */}
        <button
          onClick={createFolder}
          title="Create Folder"
          aria-label="Create folder"
          className="w-10 h-6 flex items-center justify-center cursor-pointer border border-dashed border-white/10 hover:border-white/30 transition-all rounded-lg"
          style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, gap: 2 }}
        >
          <span style={{ fontSize: 13, lineHeight: 1 }}>+</span>
          <span style={{ fontSize: 9 }}>📁</span>
        </button>

        <div className="mt-auto" />

        {/* Online status */}

        <div

          className="w-2 h-2 rounded-full shrink-0 mb-1"

          style={{

            background: online ? 'var(--status-ok)' : 'var(--status-err)',

            boxShadow: online ? '0 0 8px rgba(0,184,96,0.5)' : '0 0 8px rgba(239,68,68,0.5)',

          }}

        />

      </aside>



      {/* Free-canvas */}

      <main ref={canvasRef} className="flex-1 relative z-10 overflow-hidden" style={{ minHeight: '100vh' }} onMouseDown={e => { if (e.button === 1) e.preventDefault() }}>

        <TransformWrapper

          ref={transformRef}

          initialScale={scale}

          minScale={0.05}

          maxScale={5}

          centerOnInit={false}

          limitToBounds={false}

          disabled={showPalette}

          onTransform={(ref) => setScale(ref.state.scale)}

          doubleClick={{ disabled: true }}

          panning={{

            disabled: false,

            allowLeftClickPan: isSpacePressed,

            allowMiddleClickPan: true,

            velocityDisabled: false,

          }}

          wheel={{ disabled: true }}

          pinch={{ disabled: false }}

        >

          {({ zoomIn, zoomOut, resetTransform, state }) => (

            <>

              {/* Background instructions hint â€" fades out after 3s */}

              <div className="fixed top-20 left-1/2 -translate-x-1/2 z-0 pointer-events-none flex gap-8 text-[10px] font-black uppercase tracking-[0.3em] canvas-hint">

                <span>[Scroll] Pan</span>

                <span>[Shift+Scroll] Pan H</span>

                <span>[Ctrl+Scroll] Zoom</span>

                <span>[Middle Click] Drag</span>

                <span>[Space] Drag</span>

              </div>



              {/* Home button */}

              <a

                href="http://localhost:4000/launcher.html"

                className="fixed top-4 left-4 z-[100] w-10 h-10 flex items-center justify-center rounded-xl bg-black/60 backdrop-blur-md border border-white/10 shadow-2xl hover:bg-white/10 transition-all text-white/40 hover:text-white"

                title="Back to Launcher"

                aria-label="Back to launcher"

              >

                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>

              </a>



              {/* Mixer mini â€" fixed outside canvas */}

              {showMixer && mixerMinimized && (

                <div className="fixed bottom-6 right-6 z-[100]" style={{ width: 320 }}>

                  <AudioMixer

                    onClose={() => setShowMixer(false)}

                    config={config}

                    sbChannels={sbChannels}

                    onMinimizedChange={setMixerMinimized}

                    onRenameKey={async (keyId, label) => {

                      const next = { ...config, buttons: { ...config.buttons, [keyId]: { ...config.buttons?.[keyId], label } } }

                      await fetch(`${API}/api/config`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) })

                      setConfig(next)

                    }}

                    onRegisterToggler={(keyId, fn) => { deckTogglersRef.current[keyId] = fn }}

                    onRegisterSyncer={(keyId, fn) => { deckSyncersRef.current[keyId] = fn }}

                    onDeckStateChange={handleDeckStateChange}

                    onRegisterVolumer={(keyId, fn) => { deckVolumersRef.current[keyId] = fn }}

                    onPlayStateChange={(keyId, playing) => setPlayingKeys(prev => {

                      const next = new Set(prev)

                      if (playing) { next.add(keyId) } else { next.delete(keyId) }

                      return next

                    })}

                  />

                </div>

              )}



              {/* Floating UI controls for Zoom/Pan */}

              <div className="fixed bottom-6 left-[96px] z-[100] flex items-center gap-3 px-3 py-2 rounded-xl bg-black/60 backdrop-blur-md border border-white/10 shadow-2xl">

                <button onClick={() => zoomOut(0.15)} aria-label="Zoom out" className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition-all text-lg font-mono">&minus;</button>

                <div 

                  className="px-3 py-1 rounded-lg bg-white/5 cursor-pointer hover:bg-white/10 transition-colors flex flex-col items-center"

                  onClick={() => fitToPanels()}

                  title="Fit to panels (recenter view)"

                >

                  <span className="text-[8px] font-black tracking-[0.2em] text-white/30 uppercase mb-0.5">Canvas</span>

                  <div className="text-xs font-bold text-white/80 leading-none">{Math.round(state.scale * 100)}%</div>

                </div>

                <button onClick={() => zoomIn(0.15)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition-all text-lg font-mono">+</button>

              </div>



              <TransformComponent

                wrapperStyle={{ width: '100%', height: '100vh' }}

                contentStyle={{ width: '8000px', height: '6000px' }}

              >

                <div 

                  className="canvas-grid"

                  style={{ 

                    width: '100%', 

                    height: '100%', 

                    position: 'relative',

                  }}

                >



        {/* Keyboard panel */}

        {showKeys && (

          <Rnd

            default={{ x: kbGeo.x, y: kbGeo.y, width: 'auto', height: 'auto' }}

            enableResizing={false}

            bounds={undefined}

            dragHandleClassName="drag-handle"

            className={`panel-drag${isDragging('keyboard') ? ' dragging' : ''}`}

            scale={state.scale}

            onDragStart={() => bringToFront('keyboard')}

            onDragStop={(_e, d) => { saveGeo('keyboard', { x: d.x, y: d.y }); endDrag('keyboard') }}

            style={{ zIndex: zOf('keyboard', 10) }}

          >

            <div
              style={{
                borderRadius: 'var(--radius-panel)',
                background: 'var(--bg-chassis)',
                boxShadow: 'var(--shadow-chassis)',
                display: 'flex',
                flexDirection: 'column',
              }}
            >

              <PanelHeader title="Keyboard" onClose={() => setShowKeys(false)} className="drag-handle">
                <button
                  onMouseDown={e => e.stopPropagation()}
                  onClick={() => setVerticalKeys(v => !v)}
                  title={verticalKeys ? 'Horizontal layout' : 'Vertical layout'}
                  style={{ ...closeBtnStyle, fontSize: 11, opacity: 0.7 }}
                  aria-label="Toggle orientation"
                >{verticalKeys ? '⇔' : '⇕'}</button>
              </PanelHeader>

              <div style={{ padding: '16px 20px' }}>

              <div className="flex items-center justify-between mb-4 px-2">
                <AppKnob label="MASTER GAIN" size={96} />
                <AppKnob label="SYSTEM SCRL" size={96} />
              </div>

              {/* key grid */}

              <div className={`grid ${verticalKeys ? 'grid-cols-3' : 'grid-cols-4'}`} style={{ gap: 'var(--gap-standard)' }}>

                {(verticalKeys ? KEYS_V : KEYS_H).map(key => {

                  // eslint-disable-next-line @typescript-eslint/no-explicit-any

const action = config.buttons?.[key] || {} as any

                  const name = key.replace('key_', '').toUpperCase()

                  const isAudio = action.type === 'play_audio'

                  const isPlaying = playingKeys.has(key)

                  const emoji = action.emoji || ''

                  const displayLabel = action.label || (action.path ? action.path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') : '') || 'Vazio'

                  const showEmojiOnly = emoji && !action.label && !action.path

                  const showEmoji = !!emoji

                  const isActive = selected === key

                  const isDrag = dragOver === key



                  return (

                    <KeyTile

                      key={key}

                      selected={isActive}

                      playing={isPlaying}

                      dragging={isDrag}

                      pressDepth={6}

                      ledPosition="tr"

                      onMouseDown={e => e.stopPropagation()}

                      onClick={() => { if (isAudio) deckTogglersRef.current[key]?.(); else setSelected(key) }}

                      onContextMenu={e => {

                        e.preventDefault()

                        setCtxMenu({ key, x: e.clientX, y: e.clientY })

                        setCtxSrc(config.buttons?.[key]?.path || '')
                        setCtxLabel(config.buttons?.[key]?.label || '')

                      }}

                      className="aspect-square cursor-pointer select-none group"

                      style={{ width: 'var(--key-size)', padding: 8 }}

                      // @ts-expect-error drag handlers

                      onDragOver={(e: React.DragEvent) => { e.preventDefault(); setDragOver(key) }}

                      onDragLeave={() => setDragOver(null)}

                      onDrop={(e: React.DragEvent) => {

                        e.preventDefault()

                        setDragOver(null)

                        const f = e.dataTransfer.files[0]

                        if (f) handleDrop(key, f)

                      }}

                    >

                      {isAudio && (() => {

                        const ds = deckStates[key]

                        return (

                          <div

                            className="absolute inset-0 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity duration-150 z-10"

                            style={{ borderRadius: 'var(--radius-key)', background: 'rgba(0,0,0,0.62)', gap: 4, padding: '8px 6px' }}

                          >

                            <button

                              onClick={e => { e.stopPropagation(); deckTogglersRef.current[key]?.() }}

                              aria-label={isPlaying ? "Pause" : "Play"}

                              style={{ width: 30, height: 30, borderRadius: '50%', border: 'none', cursor: 'pointer', background: isPlaying ? 'var(--status-ok)' : 'var(--bg-btn-silver)', color: isPlaying ? '#000' : 'rgba(255,255,255,0.85)', fontSize: 'var(--fs-lg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}

                            >{isPlaying ? '⏸' : '▶'}</button>

                            {ds && ds.duration > 0 && (

                              <span style={{ fontSize: 'var(--fs-sm)', fontFamily: 'monospace', color: 'var(--text-50)', letterSpacing: '0.05em' }}>

                                {fmtTime(ds.currentTime)} / {fmtTime(ds.duration)}

                              </span>

                            )}

                            {ds && (

                              <div

                                onClick={e => e.stopPropagation()}

                                onMouseDown={e => {

                                  e.stopPropagation()

                                  const r = e.currentTarget.getBoundingClientRect()

                                  const v = Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * 100)

                                  deckVolumersRef.current[key]?.(v)

                                }}

                                onMouseMove={e => {

                                  if (e.buttons !== 1) return

                                  e.stopPropagation()

                                  const r = e.currentTarget.getBoundingClientRect()

                                  const v = Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * 100)

                                  deckVolumersRef.current[key]?.(v)

                                }}

                                style={{ width: '80%', height: 18, cursor: 'ew-resize', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}

                              >

                                <div style={{ width: '100%', height: 3, borderRadius: 2, background: 'var(--border-light)', overflow: 'hidden' }}>

                                  <div style={{ height: '100%', width: `${ds.volume}%`, background: 'var(--status-ok)', borderRadius: 2, transition: 'width 60ms' }} />

                                </div>

                                <span style={{ fontSize: 'var(--fs-sm)', fontFamily: 'monospace', color: 'rgba(255,255,255,0.4)' }}>{ds.volume}%</span>

                              </div>

                            )}

                          </div>

                        )

                      })()}

                      {showEmoji && <span style={{ fontSize: showEmojiOnly ? 28 : 18, lineHeight: 1, marginBottom: showEmojiOnly ? 0 : 2 }}>{emoji}</span>}

                      {!showEmojiOnly && <span className="text-[10px] text-[var(--text-20)] uppercase tracking-wider">{name}</span>}

                      {!showEmojiOnly && <span className="text-[12px] font-bold text-center leading-tight w-full px-1 truncate" style={{ color: isPlaying ? 'rgba(0,184,96,0.9)' : 'var(--text-70)' }}>{displayLabel}</span>}

                      {isDrag && <span className="absolute bottom-2 text-[9px] text-[var(--text-40)] font-black uppercase">RELEASE</span>}

                    </KeyTile>

                  )

                })}

              </div>

              </div>

            </div>

          </Rnd>

        )}



        {/* Config panel */}

        {selected && (

          <ConfigPanel

            key={selected}

            selected={selected}

            config={config}

            onClose={() => setSelected(null)}

            onSaved={setConfig}

          />

        )}



        {/* Mixer panel â€" full mode inside canvas */}

        {showMixer && !mixerMinimized && (

          <Rnd

            default={{ x: mxGeo.x, y: mxGeo.y, width: mxGeo.w || 340, height: 'auto' }}

            enableResizing={{ left: true, right: true }}

            minWidth={300}

            maxWidth={900}

            bounds={undefined}

            dragHandleClassName="drag-handle"

            className={`panel-drag${isDragging('mixer') ? ' dragging' : ''}`}

            scale={state.scale}

            onDragStart={() => bringToFront('mixer')}

            onDragStop={(_e, d) => { saveGeo('mixer', { x: d.x, y: d.y }); endDrag('mixer') }}

            onResizeStop={(_e, _d, ref, _delta, pos) => saveGeo('mixer', { x: pos.x, y: pos.y, w: ref.offsetWidth })}

            style={{ zIndex: zOf('mixer', 10) }}

          >

            <AudioMixer

              dragHandleClass="drag-handle"

              onClose={() => setShowMixer(false)}

              config={config}

              sbChannels={sbChannels}

              onMinimizedChange={setMixerMinimized}

              onRenameKey={async (keyId, label) => {

                const next = { ...config, buttons: { ...config.buttons, [keyId]: { ...config.buttons?.[keyId], label } } }

                await fetch(`${API}/api/config`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) })

                setConfig(next)

              }}

              onRegisterToggler={(keyId, fn) => { deckTogglersRef.current[keyId] = fn }}

              onRegisterSyncer={(keyId, fn) => { deckSyncersRef.current[keyId] = fn }}

              onDeckStateChange={handleDeckStateChange}

              onRegisterVolumer={(keyId, fn) => { deckVolumersRef.current[keyId] = fn }}

              onPlayStateChange={(keyId, playing) => setPlayingKeys(prev => {

                const next = new Set(prev)

                if (playing) { next.add(keyId) } else { next.delete(keyId) }

                return next

              })}

            />

          </Rnd>

        )}



        {/* Soundboard panel */}

        {showSoundboard && <ErrorBoundary><SoundboardPanel onClose={() => setShowSoundboard(false)} onChannelChange={setSbChannels} /></ErrorBoundary>}



        {/* Live panels */}

        {showOBS && <ErrorBoundary><OBSControlPanel onClose={() => setShowOBS(false)} /></ErrorBoundary>}

        {showBriefing && <ErrorBoundary><BriefingPanel onClose={() => setShowBriefing(false)} /></ErrorBoundary>}

        {showYTChat && <ErrorBoundary><YouTubeChatPanel onClose={() => setShowYTChat(false)} /></ErrorBoundary>}

        {showTimer && <ErrorBoundary><TimerPanel onClose={() => setShowTimer(false)} /></ErrorBoundary>}

        {showDrone && <ErrorBoundary><DronePanel onClose={() => setShowDrone(false)} /></ErrorBoundary>}

        {showPaul && <ErrorBoundary><PaulstretchPanel onClose={() => setShowPaul(false)} /></ErrorBoundary>}

        {synthIds.map(id => <ErrorBoundary key={id}><SynthPanel instanceId={id} onClose={() => setSynthIds(prev => prev.filter(x => x !== id))} /></ErrorBoundary>)}

        {showExporter && <ErrorBoundary><ExporterPanel onClose={() => setShowExporter(false)} /></ErrorBoundary>}

        {showConverter && <ErrorBoundary><ConverterPanel onClose={() => setShowConverter(false)} /></ErrorBoundary>}

        {showYTDL && <ErrorBoundary><YTDownloadPanel onClose={() => setShowYTDL(false)} /></ErrorBoundary>}

        {showLoopLab && <ErrorBoundary><LoopLabPanel onClose={() => setShowLoopLab(false)} /></ErrorBoundary>}

        {drumIds.map(id => <ErrorBoundary key={id}><DrumMachinePanel instanceId={id} onClose={() => setDrumIds(prev => prev.filter(x => x !== id))} /></ErrorBoundary>)}

        {showSession && <ErrorBoundary><SessionPanel onClose={() => setShowSession(false)} /></ErrorBoundary>}

        {showVisualizer && <ErrorBoundary><VisualizerPanel onClose={() => setShowVisualizer(false)} /></ErrorBoundary>}

        {retroTVIds.map(id => <ErrorBoundary key={id}><RetroTVPanel instanceId={id} onClose={() => setRetroTVIds(prev => prev.filter(x => x !== id))} /></ErrorBoundary>)}

        {showAudioPlayer && <ErrorBoundary><AudioPlayerPanel onClose={() => setShowAudioPlayer(false)} /></ErrorBoundary>}

        {showSynesthizer && <ErrorBoundary><SynesthizerPanel onClose={() => setShowSynesthizer(false)} /></ErrorBoundary>}

        {showAnalogBrain && <ErrorBoundary><AnalogBrainPanel onClose={() => setShowAnalogBrain(false)} /></ErrorBoundary>}

                </div>

              </TransformComponent>

            </>

          )}

        </TransformWrapper>



        {/* Floating preset button â€" fixed bottom-right, outside canvas scale */}

        <PresetFloating

          visibility={{ keys: showKeys, mixer: showMixer, soundboard: showSoundboard, obs: showOBS, briefing: showBriefing, ytchat: showYTChat, timer: showTimer, drone: showDrone, paul: showPaul, synth: showSynth, exporter: showExporter, converter: showConverter, looplab: showLoopLab, drummachine: showDrumMachine, session: showSession, visualizer: showVisualizer, retrotv: showRetroTV, ytdl: showYTDL, audioplayer: showAudioPlayer, synesthizer: showSynesthizer }}

          scale={scale}

          onLoad={loadPreset}

        />



        {showPalette && (

          <CommandPalette

            panels={panelDefs}

            onTogglePanel={handleTogglePanel}

            onChangeSidebar={handleChangeSidebar}

            onClose={() => setShowPalette(false)}

          />

        )}



        {/* Quick source edit popup (right-click on keyboard key) */}

        {ctxMenu && (

          <div

            ref={ctxRef}

            onMouseDown={e => e.stopPropagation()}

            style={{

              position: 'fixed', left: ctxMenu.x, top: ctxMenu.y, zIndex: 9999,

              borderRadius: 'var(--radius-sm)', padding: 12, width: 280,

              background: 'var(--bg-popup)',

              boxShadow: '0 12px 40px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.07)',

              display: 'flex', flexDirection: 'column', gap: 8,

            }}

          >

            <span style={{ fontSize: 'var(--fs-base)', fontWeight: 900, letterSpacing: '0.25em', textTransform: 'uppercase', color: 'var(--text-40)' }}>

              Edit // {ctxMenu.key.replace('key_', '').toUpperCase()}

            </span>

            <input
              autoFocus
              value={ctxLabel}
              onChange={e => setCtxLabel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') setCtxMenu(null) }}
              placeholder="Display name..."
              style={{
                width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)',
                border: '1px solid rgba(0,0,0,0.8)', background: 'var(--bg-input)',
                color: 'var(--text-pure)', fontSize: 'var(--fs-lg)', outline: 'none',
                boxShadow: 'var(--shadow-input)',
              }}
            />

            <input

              value={ctxSrc}

              onChange={e => setCtxSrc(e.target.value)}

              onKeyDown={e => { if (e.key === 'Enter') saveCtxSrc(); if (e.key === 'Escape') setCtxMenu(null) }}

              placeholder="Path or URL (.mp3, .wav, ...)"

              style={{

                width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)',

                border: '1px solid rgba(0,0,0,0.8)', background: 'var(--bg-input)',

                color: 'var(--text-pure)', fontSize: 'var(--fs-lg)', outline: 'none',

                boxShadow: 'var(--shadow-input)',

              }}

            />

            <div style={{ display: 'flex', gap: 6 }}>

              <button

                onClick={saveCtxSrc}

                disabled={ctxSaving}

                style={{

                  flex: 1, padding: '7px 0', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer',

                  background: 'var(--bg-btn-silver)', color: '#000',

                  fontWeight: 800, fontSize: 'var(--fs-md)', letterSpacing: '0.2em', textTransform: 'uppercase',

                  opacity: ctxSaving ? 0.5 : 1,

                }}

              >{ctxSaving ? '...' : 'Salvar'}</button>

              <button

                onClick={() => setCtxMenu(null)}

                style={{

                  padding: '7px 12px', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer',

                  background: 'var(--bg-hover)', color: 'var(--text-40)',

                  fontWeight: 700, fontSize: 'var(--fs-md)',

                }}

              >Cancelar</button>

            </div>

          </div>

        )}

      </main>

    </div>
  )

}



function NavBtn({ active, onClick, title, children, canAdd, onAdd, draggable, panelId, compact }: {
  active: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
  canAdd?: boolean
  onAdd?: () => void
  draggable?: boolean
  panelId?: string
  compact?: boolean
}) {
  const [hovered, setHovered] = React.useState(false)
  const size = compact ? 'w-10 h-10' : 'w-12 h-12'
  const iconSize = compact ? 'text-base' : 'text-lg'
  return (
    <div
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      draggable={draggable}
      onDragStart={e => { if (panelId) { e.dataTransfer.setData('panel-id', panelId); e.dataTransfer.effectAllowed = 'move' } }}
    >
      <button
        onClick={onClick}
        title={title}
        aria-label={title}
        className={`${size} flex items-center justify-center cursor-pointer border-none transition-all active:translate-y-0.5 hover:brightness-125`}
        style={{
          borderRadius: compact ? '10px' : '14px',
          background: active ? 'var(--bg-key-on)' : 'transparent',
          boxShadow: active ? 'var(--shadow-key-on)' : 'none',
          border: active ? 'none' : '1px solid rgba(255,255,255,0.05)',
        }}
      >
        <span className={iconSize} style={{ opacity: active ? 1 : 0.4, fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif' }}>{children}</span>
      </button>
      {canAdd && hovered && (
        <button
          onClick={e => { e.stopPropagation(); onAdd?.() }}
          title={`Add ${title}`}
          aria-label={`Add new ${title}`}
          className="absolute flex items-center justify-center cursor-pointer border-none transition-all hover:scale-110 active:scale-95"
          style={{ top: -4, right: -4, width: 18, height: 18, borderRadius: '50%', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', boxShadow: '0 2px 8px rgba(99,102,241,0.5)', color: '#fff', fontSize: 13, fontWeight: 700, lineHeight: 1, zIndex: 10 }}
        >+</button>
      )}
    </div>
  )
}

function SidebarFolder({ folder, panels, onTogglePanel, onAddInstance, multiInstanceIds, onToggleCollapse, onRename, onDelete, onChangeColor, onDropPanel, onRemovePanel }: {
  folder: { id: string; name: string; panelIds: string[]; collapsed: boolean; color: string }
  panels: PanelDef[]
  onTogglePanel: (id: PanelId) => void
  onAddInstance: (id: PanelId) => void
  multiInstanceIds: Set<PanelId>
  onToggleCollapse: () => void
  onRename: (name: string) => void
  onDelete: () => void
  onChangeColor: () => void
  onDropPanel: (panelId: PanelId) => void
  onRemovePanel: (panelId: PanelId) => void
}) {
  const [editing, setEditing] = React.useState(false)
  const [editName, setEditName] = React.useState(folder.name)
  const [hovered, setHovered] = React.useState(false)
  const [dragOver, setDragOver] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => { if (editing) inputRef.current?.select() }, [editing])

  const handleSubmitName = () => {
    const trimmed = editName.trim()
    if (trimmed) onRename(trimmed)
    setEditing(false)
  }

  const activeCount = panels.filter(p => p.visible).length

  return (
    <div
      className="flex flex-col items-center w-full transition-all"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => { e.preventDefault(); setDragOver(false); const pid = e.dataTransfer.getData('panel-id'); if (pid) onDropPanel(pid as PanelId) }}
    >
      {/* Folder header */}
      <div
        className="flex items-center justify-center cursor-pointer transition-all relative"
        style={{
          width: 56, minHeight: 28, borderRadius: 12, padding: '4px 0',
          background: dragOver ? `${folder.color}33` : `${folder.color}18`,
          border: dragOver ? `2px dashed ${folder.color}` : `1px solid ${folder.color}44`,
          marginBottom: folder.collapsed ? 0 : 2,
        }}
        onClick={onToggleCollapse}
        onDoubleClick={e => { e.stopPropagation(); setEditing(true); setEditName(folder.name) }}
        title={`${folder.name} (${activeCount}/${panels.length} active) — double-click to rename`}
      >
        {editing ? (
          <input
            ref={inputRef}
            value={editName}
            onChange={e => setEditName(e.target.value)}
            onBlur={handleSubmitName}
            onKeyDown={e => { if (e.key === 'Enter') handleSubmitName(); if (e.key === 'Escape') setEditing(false) }}
            onClick={e => e.stopPropagation()}
            className="border-none outline-none text-center"
            style={{ width: 48, background: 'transparent', color: folder.color, fontSize: 9, fontWeight: 700, letterSpacing: '0.05em' }}
          />
        ) : (
          <span style={{ color: folder.color, fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', maxWidth: 50, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {folder.collapsed ? `${folder.name} (${panels.length})` : folder.name}
          </span>
        )}

        {/* Hover actions */}
        {hovered && !editing && (
          <>
            <button
              onClick={e => { e.stopPropagation(); onChangeColor() }}
              title="Change color"
              className="absolute flex items-center justify-center cursor-pointer border-none transition-all hover:scale-125"
              style={{ top: -5, left: -5, width: 14, height: 14, borderRadius: '50%', background: folder.color, fontSize: 8, color: '#fff', zIndex: 10 }}
            >●</button>
            <button
              onClick={e => { e.stopPropagation(); onDelete() }}
              title="Delete folder"
              className="absolute flex items-center justify-center cursor-pointer border-none transition-all hover:scale-125"
              style={{ top: -5, right: -5, width: 14, height: 14, borderRadius: '50%', background: '#ef4444', fontSize: 9, color: '#fff', zIndex: 10, lineHeight: 1 }}
            >×</button>
          </>
        )}
      </div>

      {/* Folder contents */}
      {!folder.collapsed && panels.length > 0 && (
        <div
          className="flex flex-col items-center gap-1 pb-1 relative"
          style={{ borderLeft: `2px solid ${folder.color}33`, marginLeft: 0, paddingLeft: 0 }}
        >
          {panels.map(p => (
            <NavBtn
              key={p.id}
              active={p.visible}
              onClick={() => onTogglePanel(p.id)}
              title={`${p.label} — drag out to ungroup`}
              canAdd={multiInstanceIds.has(p.id)}
              onAdd={() => onAddInstance(p.id)}
              compact
              draggable
              panelId={p.id}
            >
              {p.icon}
            </NavBtn>
          ))}
        </div>
      )}

      {/* Empty folder drop zone */}
      {!folder.collapsed && panels.length === 0 && (
        <div
          className="flex items-center justify-center"
          style={{ width: 44, height: 32, border: '1px dashed rgba(255,255,255,0.1)', borderRadius: 8, color: 'rgba(255,255,255,0.2)', fontSize: 9 }}
        >
          drop
        </div>
      )}
    </div>
  )
}

