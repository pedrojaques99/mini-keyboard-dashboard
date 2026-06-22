import { repl as createRepl, evalScope } from '@strudel/core'
import { captureRegistry } from './capture-bus'

export type StrudelState = {
  playing: boolean
  code: string
  error: string | null
  bpm: number
}

type Listener = (s: StrudelState) => void

let instance: StrudelService | null = null

let audioInitStarted = false

function bootAudio() {
  if (audioInitStarted) return
  audioInitStarted = true
  import('@strudel/webaudio').then(({ initAudioOnFirstClick }) => {
    initAudioOnFirstClick()
  })
}

export class StrudelService {
  private state: StrudelState = { playing: false, code: '', error: null, bpm: 120 }
  private listeners = new Set<Listener>()
  private replInstance: any = null
  private captureDest: MediaStreamAudioDestinationNode | null = null
  private gainNode: GainNode | null = null
  private lpfNode: BiquadFilterNode | null = null
  private hpfNode: BiquadFilterNode | null = null
  private delayNode: DelayNode | null = null
  private delayGain: GainNode | null = null
  private dryGain: GainNode | null = null
  private analyser: AnalyserNode | null = null
  private initialized = false
  private initPromise: Promise<void> | null = null
  private readyCallbacks: Array<() => void> = []

  static get(): StrudelService {
    if (!instance) {
      instance = new StrudelService()
      bootAudio()
    }
    return instance
  }

  async init() {
    if (this.initialized) return
    if (this.initPromise) return this.initPromise
    this.initPromise = this._init()
    return this.initPromise
  }

  private async _init() {
    const { webaudioOutput, registerSynthSounds } = await import('@strudel/webaudio')
    const { miniAllStrings } = await import('@strudel/mini')
    const { initAudio, getAudioContext, samples, registerZZFXSounds, getSuperdoughAudioController } = await import('superdough')

    registerSynthSounds()
    registerZZFXSounds()
    miniAllStrings()

    const cdn = 'https://strudel.b-cdn.net'
    samples(`${cdn}/EmuSP12.json`)
    samples(`${cdn}/piano.json`)
    samples(`${cdn}/vcsl.json`)
    samples(`${cdn}/tidal-drum-machines.json`)

    this.loadLocalSamples(samples)

    await evalScope(
      import('@strudel/core'),
      import('@strudel/mini'),
      import('@strudel/webaudio'),
      import('@strudel/tonal'),
    )

    this.replInstance = createRepl({
      defaultOutput: webaudioOutput,
      getTime: () => getAudioContext().currentTime,
      afterEval: () => {
        this.update({ playing: true, error: null })
      },
      onEvalError: (err: any) => {
        this.update({ error: err?.message || String(err) })
      },
    })

    this.initialized = true

    await initAudio()
    const ctx = getAudioContext()
    if (ctx.state === 'suspended') await ctx.resume()
    this.buildAudioNodes(ctx, getSuperdoughAudioController)
    this.readyCallbacks.forEach(cb => cb())
    this.readyCallbacks = []
  }

  private buildAudioNodes(
    ctx: AudioContext,
    getController: () => { output: { destinationGain: GainNode } },
  ) {
    if (this.gainNode) return

    this.lpfNode = ctx.createBiquadFilter()
    this.lpfNode.type = 'lowpass'
    this.lpfNode.frequency.value = 20000

    this.hpfNode = ctx.createBiquadFilter()
    this.hpfNode.type = 'highpass'
    this.hpfNode.frequency.value = 20

    this.dryGain = ctx.createGain()
    this.dryGain.gain.value = 1

    this.delayNode = ctx.createDelay(1.0)
    this.delayNode.delayTime.value = 0.3
    this.delayGain = ctx.createGain()
    this.delayGain.gain.value = 0

    this.gainNode = ctx.createGain()
    this.gainNode.gain.value = 0.8

    this.analyser = ctx.createAnalyser()
    this.analyser.fftSize = 2048

    this.captureDest = ctx.createMediaStreamDestination()

    // Intercept superdough output: destinationGain → our chain → speakers
    const controller = getController()
    const sdGain = controller.output.destinationGain
    if (sdGain) {
      try { sdGain.disconnect(ctx.destination) } catch {}
      sdGain.connect(this.lpfNode)
    }

    this.lpfNode.connect(this.hpfNode)
    this.hpfNode.connect(this.dryGain)
    this.hpfNode.connect(this.delayNode)
    this.delayNode.connect(this.delayGain)
    this.delayGain.connect(this.delayNode)
    this.dryGain.connect(this.gainNode)
    this.delayGain.connect(this.gainNode)
    this.gainNode.connect(ctx.destination)
    this.gainNode.connect(this.captureDest)
    this.gainNode.connect(this.analyser)

    captureRegistry.register({
      id: 'analogbrain',
      label: 'Analog Brain',
      getStream: () => this.captureDest?.stream ?? null,
      setMonitor: (enabled: boolean) => {
        if (this.gainNode) {
          if (enabled) {
            try { this.gainNode.connect(ctx.destination) } catch {}
          } else {
            try { this.gainNode.disconnect(ctx.destination) } catch {}
          }
        }
      },
    })
  }

  private localSampleNames: string[] = []

  private async loadLocalSamples(samplesFn: (map: Record<string, string[]>) => void) {
    try {
      const API = (await import('./api')).API
      const resp = await fetch(`${API}/api/samples/strudel-map`)
      if (!resp.ok) return
      const map: Record<string, string[]> = await resp.json()
      const converted: Record<string, string[]> = {}
      for (const [name, paths] of Object.entries(map)) {
        converted[name] = paths.map(p => `${API}/api/samples/file?path=${encodeURIComponent(p)}`)
      }
      if (Object.keys(converted).length > 0) {
        samplesFn(converted)
        this.localSampleNames = Object.keys(converted)
      }
    } catch {}
  }

  getLocalSampleNames(): string[] {
    return this.localSampleNames
  }

  async evaluate(code: string) {
    await this.init()
    const clean = code.trim()
    if (!clean) return

    const { getAudioContext } = await import('superdough')
    const ctx = getAudioContext()
    if (ctx.state === 'suspended') await ctx.resume()

    try {
      this.update({ code, error: null })
      await this.replInstance?.evaluate(clean)
      this.update({ playing: true })
    } catch (err: any) {
      const msg = err?.message || String(err)
      this.update({ error: msg, playing: false })
      throw err
    }
  }

  stop() {
    try { this.replInstance?.stop() } catch {}
    this.update({ playing: false })
  }

  async play() {
    if (!this.state.code) return
    await this.evaluate(this.state.code)
  }

  setBPM(bpm: number) {
    const clamped = Math.max(30, Math.min(300, bpm))
    this.update({ bpm: clamped })
    if (this.replInstance) {
      this.replInstance.setCps(clamped / 60 / 4)
    }
  }

  onReady(cb: () => void) {
    if (this.gainNode) cb()
    else this.readyCallbacks.push(cb)
  }

  setVolume(v: number) {
    if (this.gainNode) this.gainNode.gain.value = Math.max(0, Math.min(1, v))
  }

  setLPF(freq: number) {
    if (this.lpfNode) this.lpfNode.frequency.value = freq
  }

  setHPF(freq: number) {
    if (this.hpfNode) this.hpfNode.frequency.value = freq
  }

  setDelay(amount: number) {
    if (this.delayGain) this.delayGain.gain.value = Math.min(0.8, amount)
  }

  setReverb(_amount: number) {
    if (this.delayNode && this.delayGain) {
      this.delayNode.delayTime.value = 0.15 + _amount * 0.35
      this.delayGain.gain.value = Math.max(this.delayGain.gain.value, _amount * 0.6)
    }
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyser
  }

  getCaptureStream(): MediaStream | null {
    return this.captureDest?.stream ?? null
  }

  getState(): StrudelState {
    return { ...this.state }
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  destroy() {
    this.stop()
    captureRegistry.unregister('analogbrain')
    try { this.gainNode?.disconnect() } catch {}
    instance = null
  }

  private update(patch: Partial<StrudelState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach(fn => fn(this.state))
  }
}
