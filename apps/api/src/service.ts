import type { CommentOrder, CommentPage, Detail, Envelope, SearchOptions, SearchResult, Transcript, Video, VideoStats } from '@atlas/shared'
import { Cache } from './cache.ts'
import type { Provider, ProviderComments, ProviderDetail, TrackRef } from './provider.ts'
import { iso, Telemetry, UpstreamError } from './transport.ts'

const MINUTE = 60_000
const CACHE = { search: 20 * MINUTE, detail: 30 * MINUTE, comments: 10 * MINUTE, transcript: 12 * 60 * MINUTE }
const publicTrack = ({endpoint: _endpoint, ...track}: TrackRef) => track
const errorText = (error: unknown) => error instanceof UpstreamError ? error.message : '上游处理失败'

export class ApiError extends Error {
  constructor(readonly code: string, message: string, readonly http = 503, readonly reasons: string[] = []) { super(message) }
}

export class VideoService {
  constructor(readonly providers: readonly Provider[], readonly cache: Cache, readonly telemetry: Telemetry) {}
  private order(prefer?: string) {
    return prefer ? [...this.providers.filter(p => p.id === prefer), ...this.providers.filter(p => p.id !== prefer)] : this.providers
  }
  private async fallback<T>(providers: readonly Provider[], tryOne: (p: Provider) => Promise<T>): Promise<T> {
    const causes: string[] = []
    for (const [index, provider] of providers.entries()) {
      if (index) this.telemetry.counters.fallbacks++
      try { return await tryOne(provider) } catch (error) {
        if (!(error instanceof UpstreamError)) throw error
        causes.push(provider.id + ' · ' + errorText(error))
      }
    }
    throw new ApiError('PROVIDER_UNAVAILABLE', '数据源暂时不可用，请稍后重试。', 503, causes)
  }

  search(options: SearchOptions) {
    return this.cache.get<SearchResult>(['search', this.providers.map(p => p.base), options],
      data => data.partial ? 2 * MINUTE : CACHE.search, async () => {
        const {query, limit, kind} = options
        const providers = kind === 'all' ? this.providers :
          this.providers.toSorted((a, b) => Number(b.classifiesSearch) - Number(a.classifiesSearch))
        const videos = new Map<string, Video>()
        const observedIds = new Set<string>()
        const pages: SearchResult['pages'] = []
        const warnings: string[] = []
        const sources = new Set<string>()
        let unknown = 0, rawCount = 0
        for (const [index, provider] of providers.entries()) {
          if (index) this.telemetry.counters.fallbacks++
          let cursor: string | number | undefined
          const seen = new Set<string | number>()
          // Five full pages normally give 100 results. The cap leaves room for overlapping IDs.
          const pageCap = Math.min(9, Math.ceil(limit / 20) + (kind === 'all' ? 2 : 1))
          for (let page = 1; page <= pageCap && videos.size < limit; page++) {
            try {
              const response = await provider.search(query, kind, cursor)
              rawCount += response.rows.length
              sources.add(provider.id)
              let newIds = 0
              for (const row of response.rows) {
                if (!observedIds.has(row.id)) { newIds++; observedIds.add(row.id) }
                if (row.kind === 'unknown') unknown++
                if (kind !== 'all' && row.kind !== kind) continue
                if (!videos.has(row.id)) videos.set(row.id, row)
              }
              pages.push({source: provider.id, page, returned: response.rows.length, newIds})
              if (!response.next || seen.has(response.next) || (page > 1 && !newIds)) break
              seen.add(response.next)
              cursor = response.next
              if (kind !== 'all' && page >= 2 && !videos.size) break
            } catch (error) {
              if (!(error instanceof UpstreamError)) throw error
              warnings.push(provider.id + ' · ' + errorText(error))
              break
            }
          }
          if (videos.size >= limit || (kind === 'all' && !warnings.length && sources.size && !videos.size)) break
        }
        if (!sources.size) throw new ApiError('PROVIDER_UNAVAILABLE', '数据源暂时不可用，请稍后重试。', 503, warnings)
        if (kind !== 'all' && unknown) warnings.push('上游未明确标记类型的结果已排除。')
        if (kind === 'short' && !videos.size) warnings.push('上游关键词接口未返回已明确标记的 Shorts。')
        const partial = videos.size < limit || warnings.length > 0
        if (videos.size > 0 && videos.size < limit) warnings.push('上游分页或过滤后未达到请求数量。')
        return {options, videos: [...videos.values()].slice(0, limit), pages, rawCount,
          uniqueCount: observedIds.size, sources: [...sources], partial, warnings}
      })
  }

  private providerDetail(provider: Provider, id: string) {
    return this.cache.get(['detail', provider.id, provider.base, id], CACHE.detail, () => provider.detail(id))
  }
  private detailRecord(id: string, prefer?: string) {
    return this.fallback(this.order(prefer), p => this.providerDetail(p, id))
  }
  async detail(id: string, prefer?: string): Promise<Envelope<Detail>> {
    const envelope = await this.detailRecord(id, prefer)
    return {...envelope, data: {video: envelope.data.video, source: envelope.data.video.source,
      collectedAt: envelope.data.video.collectedAt, tracks: envelope.data.tracks.map(publicTrack)}}
  }

  private providerComments(p: Provider, id: string, order: CommentOrder, token?: string, parent?: string) {
    return this.cache.get(['comments', p.id, p.base, id, order, token ?? null, parent ?? null], CACHE.comments,
      () => p.comments(id, order, token, parent))
  }

  async comments(id: string, order: CommentOrder, prefer?: string, cursor?: string): Promise<Envelope<CommentPage>> {
    let provider: Provider | undefined
    let value: Envelope<ProviderComments>
    let parent: string | undefined
    if (cursor) {
      const state = this.cache.cursor(cursor)
      if (!state || state.videoId !== id || state.order !== order) throw new ApiError('INVALID_CURSOR', '分页已失效，请从首屏重新加载。', 409)
      provider = this.providers.find(p => p.id === state.source)
      if (!provider) throw new ApiError('INVALID_CURSOR', '分页来源已更改，请从首屏重新加载。', 409)
      parent = state.parent
      try { value = await this.providerComments(provider, id, order, state.upstream, parent) }
      catch (error) {
        if (!(error instanceof UpstreamError)) throw error
        throw new ApiError('CURSOR_PROVIDER_UNAVAILABLE', '当前分页来源暂时不可用。请重试，或重新打开首屏。', 503, [error.message])
      }
    } else {
      const available = this.order(prefer).filter(p => p.orders.includes(order))
      if (!available.length) throw new ApiError('ORDER_UNSUPPORTED', '当前数据源不支持最新排序。', 422)
      const result = await this.fallback(available, async p => ({provider: p, value: await this.providerComments(p, id, order)}))
      provider = result.provider
      value = result.value
    }
    const raw = value.data
    const source = provider.id
    const comments = [...new Map(raw.rows.map(row => [row.id, row])).values()].map(row => ({
      ...row, repliesCursor: raw.scopes[row.id] ? this.cache.issue({
        source, videoId: id, order, parent: row.id, upstream: raw.scopes[row.id],
      }) : null,
    }))
    const nextCursor = raw.next ? this.cache.issue({source, videoId: id, order, parent, upstream: raw.next}) : null
    return {...value, data: {...raw.observation, comments, nextCursor, total: raw.total,
      disabled: raw.disabled, order, supportedOrders: [...new Set(this.providers.flatMap(p => p.orders))]}}
  }

  async stats(id: string, prefer?: string): Promise<Envelope<VideoStats>> {
    const base = ['stats', this.providers.map(p => p.base), id, prefer ?? null]
    return this.cache.get(base, (data: VideoStats) => data.warnings.length ? 2 * MINUTE : CACHE.comments, async () => {
      const [detail, page] = await Promise.allSettled([this.detailRecord(id, prefer), this.comments(id, 'top', prefer)])
      if (detail.status === 'rejected' && page.status === 'rejected') {
        throw new ApiError('PROVIDER_UNAVAILABLE', '视频统计暂时无法读取。', 503,
          [detail.reason?.message ?? '', page.reason?.message ?? ''])
      }
      const video = detail.status === 'fulfilled' ? detail.value.data.video : null
      const comments = page.status === 'fulfilled' ? page.value.data : null
      return {id, likes: video?.likes ?? null, comments: comments?.total ?? video?.comments ?? null,
        metricSources: {...video?.metricSources, ...(comments && comments.total !== null
          ? {comments: {source: comments.source, collectedAt: comments.collectedAt}} : {})},
        warnings: [detail.status === 'rejected' ? '点赞数获取失败' : '',
          page.status === 'rejected' ? '评论数获取失败' : ''].filter(Boolean)}
    })
  }

  async transcript(id: string, trackId: string): Promise<Envelope<Transcript>> {
    const primary = this.providers.find(p => trackId.startsWith(p.id + '-'))
    if (!primary) throw new ApiError('TRACK_NOT_FOUND', '该字幕轨道不可用。', 404)
    return this.cache.get(['transcript-v2', this.providers.map(p => p.base), id, trackId], CACHE.transcript, async () => {
      let detail: Envelope<ProviderDetail>
      try { detail = await this.providerDetail(primary, id) }
      catch (error) {
        if (!(error instanceof UpstreamError)) throw error
        throw new ApiError('TRANSCRIPT_UNAVAILABLE', '原字幕目录暂时无法读取，请重新打开视频详情。', 503,
          [primary.id + ' · ' + error.message])
      }
      const requested = detail.data.tracks.find(t => t.id === trackId)
      if (!requested) throw new ApiError('TRACK_NOT_FOUND', '字幕轨道已变更或不存在，请刷新字幕目录。', 404)
      return this.fallback(this.order(primary.id), async provider => {
        const track = provider === primary ? requested :
          (await this.providerDetail(provider, id)).data.tracks.find(t => t.language !== null
            && t.language === requested.language && (requested.automatic === true || t.automatic === true
              ? t.automatic === requested.automatic : true))
        if (!track) throw new UpstreamError('其他来源没有同语言、同自动生成类型的字幕', null, 'unsupported')
        const cues = await provider.transcript(track)
        return {track: publicTrack(track), source: provider.id, collectedAt: iso(), cues,
          text: cues.map(cue => cue.text).join('\n')}
      })
    })
  }
}
