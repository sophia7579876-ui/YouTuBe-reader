import { performance } from 'node:perf_hooks'
import type { ProviderState, RequestLog } from '@atlas/shared'

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
export const iso = () => new Date().toISOString()

export class UpstreamError extends Error {
  constructor(message: string, readonly http: number | null = null,
    readonly kind: 'unavailable' | 'blocked' | 'unsupported' = 'unavailable') { super(message) }
}

export function safeBase(value: string) {
  const url = new URL(value)
  const localhost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((!localhost && url.protocol !== 'https:') || !['https:', 'http:'].includes(url.protocol)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Provider URL must be an HTTPS origin or local HTTP origin')
  }
  return url.origin
}

class Lane {
  private end: Promise<unknown> = Promise.resolve()
  private last = Number.NEGATIVE_INFINITY
  private pending = 0
  private previousGap = 0
  run<T>(gap: number, work: () => Promise<T>): Promise<T> {
    if (this.pending >= 48) throw new UpstreamError('上游请求队列已满')
    this.pending++
    const next = this.end.then(async () => {
      await sleep(Math.max(0, this.last + Math.max(gap, this.previousGap) - performance.now()))
      try { return await work() } finally { this.last = performance.now(); this.previousGap = gap; this.pending-- }
    })
    this.end = next.catch(() => undefined)
    return next
  }
}

type Counters = { requests: number; successes: number; failures: number; cacheHits: number; cacheMisses: number;
  coalesced: number; fallbacks: number }
export class Telemetry {
  readonly counters: Counters = { requests: 0, successes: 0, failures: 0, cacheHits: 0, cacheMisses: 0, coalesced: 0, fallbacks: 0 }
  readonly states = new Map<string, ProviderState>()
  readonly events: RequestLog[] = []
  private readonly times: number[] = []
  constructor(private readonly log: (entry: RequestLog) => void = () => {}) {}
  register(id: string, base: string) {
    this.states.set(id, { id, base, state: 'untested', checkedAt: null, cooldownUntil: null,
      lastError: null, successes: 0, failures: 0 })
  }
  record(entry: RequestLog, cooldown: number | null) {
    this.events.push(entry)
    if (this.events.length > 500) this.events.shift()
    this.times.push(entry.elapsedMs)
    if (this.times.length > 500) this.times.shift()
    this.counters.requests++
    const state = this.states.get(entry.source)
    const ok = entry.status === 'VERIFIED'
    this.counters[ok ? 'successes' : 'failures']++
    if (state) {
      state[ok ? 'successes' : 'failures']++
      state.checkedAt = entry.collectedAt
      state.lastError = ok ? state.lastError : entry.error
      state.cooldownUntil = cooldown ? new Date(cooldown).toISOString() : null
      state.state = cooldown ? 'cooldown' : ok ? 'available' : 'error'
    }
    if (!ok) this.log(entry)
  }
  snapshot() {
    const sorted = this.times.toSorted((a, b) => a - b)
    const percentile = (p: number) => sorted.length ? sorted[Math.ceil(sorted.length * p) - 1] : null
    const providers = [...this.states.values()].map(state => ({
      ...state, state: state.cooldownUntil && Date.parse(state.cooldownUntil) <= Date.now() ? 'error' as const : state.state,
    }))
    return { ...this.counters, providers, recent: this.events.slice(-120).reverse(),
      p50Ms: percentile(.5), p95Ms: percentile(.95) }
  }
}

function retryUntil(value: string | null, fallbackMs: number) {
  if (!value) return Date.now() + fallbackMs
  const duration = /^\d+$/.test(value) ? Date.now() + Number(value) * 1000 : Date.parse(value)
  return Number.isFinite(duration) && duration > Date.now() ? duration : Date.now() + fallbackMs
}

async function readBounded(response: Response, maxBytes: number) {
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel()
    throw new UpstreamError('响应体超过安全上限')
  }
  const reader = response.body?.getReader()
  if (!reader) return Buffer.alloc(0)
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const {done, value} = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) { await reader.cancel(); throw new UpstreamError('响应体超过安全上限') }
      chunks.push(value)
    }
    return Buffer.concat(chunks, size)
  } finally {
    reader.releaseLock()
  }
}

export class Transport {
  private readonly lanes = new Map<string, Lane>()
  private readonly cool = new Map<string, number>()
  constructor(readonly telemetry: Telemetry, private readonly gapMs = 2000, private readonly timeoutMs = 12_000) {}
  async get<T>(source: string, operation: string, url: URL, mode: 'json' | 'text' | 'image',
    validate: (value: unknown) => T): Promise<T> {
    const origin = url.origin
    if (!this.lanes.has(origin)) this.lanes.set(origin, new Lane())
    return this.lanes.get(origin)!.run(mode === 'image' ? 700 : this.gapMs, async () => {
      const paused = this.cool.get(origin) ?? 0
      if (paused > Date.now()) throw new UpstreamError('Provider 正在冷却，请稍后重试', null, 'blocked')
      for (let attempt = 0; ; attempt++) {
        const started = performance.now()
        let http: number | null = null
        let cooldown: number | null = null
        try {
          const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(this.timeoutMs),
            headers: { 'User-Agent': 'Video Atlas POC/1.0', Accept: mode === 'json' ? 'application/json' : '*/*' } })
          http = response.status
          if (mode === 'image' && [301, 302, 307, 308].includes(http)) {
            const location = response.headers.get('location')
            await response.body?.cancel()
            return validate({ location })
          }
          if (!response.ok) {
            const blocked = [401, 403, 429].includes(http)
            const after = response.headers.get('retry-after')
            if (blocked || after) {
              cooldown = retryUntil(after, http === 429 || !blocked ? 60_000 : 15 * 60_000)
              this.cool.set(origin, cooldown)
            }
            await response.body?.cancel()
            throw new UpstreamError('HTTP ' + http, http, blocked || after ? 'blocked' : 'unavailable')
          }
          const mime = response.headers.get('content-type') ?? ''
          if (mode === 'image' && !/^image\/(jpeg|webp|png)(;|$)/i.test(mime)) {
            await response.body?.cancel()
            throw new UpstreamError('上游未返回可用缩略图', http)
          }
          const bytes = await readBounded(response, mode === 'image' ? 1_000_000 : 5_000_000)
          const value = validate(mode === 'image' ? {bytes, mime} : mode === 'text' ? bytes.toString('utf8') : JSON.parse(bytes.toString('utf8')))
          if (mode !== 'image') this.telemetry.record({source, operation, collectedAt: iso(), status: 'VERIFIED', http,
            elapsedMs: Math.round(performance.now() - started), error: null}, null)
          return value
        } catch (cause) {
          const detail = cause instanceof Error ? cause.name : 'unknown'
          const nested = cause instanceof Error && cause.cause instanceof Error ? cause.cause.message : ''
          const refusedTunnel = /(?:proxy|tunnel).{0,90}(401|403|429)|(?:401|403|429).{0,90}(proxy|tunnel)/i.test(nested)
          if (refusedTunnel) {
            cooldown = Date.now() + 15 * 60_000
            this.cool.set(origin, cooldown)
          }
          const error = cause instanceof UpstreamError ? cause : refusedTunnel
            ? new UpstreamError('出站代理拒绝连接', null, 'blocked') : new UpstreamError(
            detail === 'TimeoutError' ? '上游请求超时' : detail === 'SyntaxError' ? '上游 JSON 格式无效' :
              cause instanceof TypeError ? '上游网络连接失败' : '上游响应处理失败', http)
          if (mode !== 'image') this.telemetry.record({source, operation, collectedAt: iso(),
            status: error.kind === 'blocked' ? 'BLOCKED' : 'FAILED', http, error: error.message,
            elapsedMs: Math.round(performance.now() - started)}, cooldown)
          const retry = error.kind !== 'blocked' && (http === null || http >= 500)
          if (attempt >= 1 || !retry || mode === 'image') throw error
          await sleep(this.gapMs + 400 * 2 ** attempt)
        }
      }
    })
  }
}
