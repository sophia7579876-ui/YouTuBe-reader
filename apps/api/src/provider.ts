import { createHash } from 'node:crypto'
import type { Comment, CommentOrder, Cue, Observation, Track, Video, VideoKind } from '@atlas/shared'
import { parseCaptions, plain } from './captions.ts'
import { iso, safeBase, Transport, UpstreamError } from './transport.ts'

export const VIDEO_ID = /^[\w-]{11}$/
export const DEFAULT_INVIDIOUS = 'https://yt.chocolatemoo53.com'
export const DEFAULT_PIPED = 'https://api.piped.private.coffee'
export const DEFAULT_PIPED_MEDIA = 'https://proxy.piped.private.coffee'
type Obj = Record<string, unknown>

type SearchCursor = string | number
export interface TrackRef extends Track { endpoint: string }
export interface ProviderDetail { video: Video; tracks: TrackRef[] }
export interface ProviderComments {
  rows: Comment[]
  next: string | null
  total: number | null
  disabled: boolean | null
  scopes: Record<string, string>
  observation: Observation
}
export interface Provider {
  id: string
  base: string
  classifiesSearch: boolean
  orders: readonly CommentOrder[]
  search(query: string, kind: VideoKind, cursor?: SearchCursor): Promise<{rows: Video[]; next: SearchCursor | null}>
  detail(id: string): Promise<ProviderDetail>
  comments(id: string, order: CommentOrder, token?: string, parent?: string): Promise<ProviderComments>
  transcript(track: TrackRef): Promise<Cue[]>
}

function object(value: unknown): Obj {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new UpstreamError('上游响应结构无效')
  const row = value as Obj
  if (row.error || (row.message && row.exception)) throw new UpstreamError('上游报告数据提取失败')
  return row
}
const rows = (value: unknown) => Array.isArray(value) ? value as Obj[] : []
const str = (value: unknown) => typeof value === 'string' && value.trim() && value !== 'null' ? value : null
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
const bool = (value: unknown) => typeof value === 'boolean' ? value : null
const channelId = (value: unknown) => str(value)?.match(/(?:^|\/channel\/)(UC[\w-]{22})(?:$|[/?#])/u)?.[1] ?? null
function date(value: unknown, scale: number) {
  const t = typeof value === 'number' && value > 0 ? value * scale : typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(t) && t <= 8.64e15 && t > 0 ? new Date(t).toISOString() : null
}
function pipedId(path: unknown) {
  try {
    const url = new URL(str(path) ?? '', 'https://www.youtube.com')
    return url.pathname.startsWith('/shorts/') ? url.pathname.split('/')[2] : url.searchParams.get('v') ?? ''
  } catch { return '' }
}
function makeTrackId(source: string, lang: string | null, label: string, index: number) {
  return source + '-' + createHash('sha256').update(JSON.stringify([lang, label, index])).digest('hex').slice(0, 20)
}
function withMetrics(values: Omit<Video, 'metricSources'>, observation: Observation): Video {
  const metricSources: Video['metricSources'] = {}
  for (const key of ['views', 'likes', 'comments'] as const) if (values[key] !== null) metricSources[key] = observation
  return {...values, metricSources}
}

abstract class HttpProvider {
  readonly base: string
  constructor(readonly id: string, base: string, protected readonly transport: Transport,
    protected readonly mediaOrigins: readonly string[] = []) {
    this.base = safeBase(base)
    transport.telemetry.register(id, this.base)
  }
  protected remote<T>(operation: string, path: string, args: Record<string, string | number>,
    validate: (data: unknown, obs: Observation) => T) {
    const url = new URL(path, this.base)
    for (const [key, value] of Object.entries(args)) url.searchParams.set(key, String(value))
    return this.transport.get(this.id, operation, url, 'json', data => validate(data, {source: this.id, collectedAt: iso()}))
  }
  async transcript(track: TrackRef) {
    const url = new URL(track.endpoint, this.base)
    if (url.username || url.password || ![this.base, ...this.mediaOrigins].includes(url.origin) ||
      !/^\/(api\/v1\/captions\/[\w-]{11}|api\/timedtext|api\/v1\/captions)\/?$/.test(url.pathname)) {
      throw new UpstreamError('字幕地址不在允许范围内')
    }
    return this.transport.get(this.id, 'transcript', url, 'text', data => {
      const cues = parseCaptions(String(data))
      if (!cues.length) throw new UpstreamError('字幕轨道没有可解析的带时间戳文本')
      return cues.sort((a, b) => a.startMs - b.startMs)
    })
  }
}

export class Invidious extends HttpProvider implements Provider {
  readonly classifiesSearch = false
  readonly orders = ['top', 'new'] as const
  constructor(base: string, transport: Transport) { super('invidious', base, transport) }
  private video(row: Obj, id: string, obs: Observation, detail = false): Video {
    const publishedAt = date(row.published, 1000)
    return withMetrics({...obs, id, url: 'https://www.youtube.com/watch?v=' + id,
      thumbnail: '/api/thumbnail/' + id, title: str(row.title)!,
      channel: { id: channelId(row.authorUrl) ?? channelId(row.authorId), name: str(row.author) },
      publishedAt, publishedPrecision: !publishedAt ? null : detail ? 'date' : 'estimated',
      durationSeconds: count(row.lengthSeconds),
      kind: [row.isShort, row.isShorts].some(x => x === true) || ['shorts', 'shortVideo'].includes(String(row.type)) ? 'short' :
        [row.isShort, row.isShorts].some(x => x === false) ? 'video' : 'unknown',
      views: count(row.viewCount), likes: count(row.likeCount), comments: count(row.commentCount)}, obs)
  }
  search(query: string, kind: VideoKind, cursor?: SearchCursor) {
    const page = Number(cursor ?? 1)
    return this.remote('search', '/api/v1/search', {q: query, type: kind === 'all' ? 'video' : 'all', page}, (value, obs) => {
      if (!Array.isArray(value)) throw new UpstreamError('搜索响应缺少数组')
      const found = rows(value).flatMap(row => {
        const id = str(row?.videoId)
        return id && VIDEO_ID.test(id) && str(row.title) ? [this.video(row, id, obs)] : []
      })
      return {rows: found, next: value.length ? page + 1 : null}
    })
  }
  detail(id: string) {
    return this.remote('detail', '/api/v1/videos/' + id, {}, (value, obs) => {
      const row = object(value)
      if (row.videoId !== id || !str(row.title)) throw new UpstreamError('详情缺少对应视频')
      const tracks = rows(row.captions).flatMap((t, index) => {
        const endpoint = str(t.url)
        if (!endpoint) return []
        const language = str(t.language_code), label = str(t.label) ?? language ?? '未标记语言'
        return [{...obs, endpoint, language, label, id: makeTrackId(this.id, language, label, index),
          automatic: /auto.generated/i.test(label) ? true : null}]
      })
      return {video: this.video(row, id, obs, true), tracks}
    })
  }
  comments(id: string, order: CommentOrder, token?: string, parent?: string) {
    const args: Record<string, string> = {sort_by: order}
    if (token) args.continuation = token
    return this.remote(parent ? 'replies' : token ? 'comments_page' : 'comments_' + order, '/api/v1/comments/' + id, args, (value, obs) => {
      const row = object(value)
      if (!Array.isArray(row.comments)) throw new UpstreamError('评论响应缺少数组')
      const scopes: Record<string, string> = Object.create(null)
      const result = rows(row.comments).flatMap(item => {
        const commentId = str(item.commentId), text = str(item.content)
        if (!commentId || !text) return []
        const reply = item.replies && typeof item.replies === 'object' ? item.replies as Obj : {}
        const cursor = str(reply.continuation)
        if (cursor) scopes[commentId] = cursor
        return [{...obs, id: commentId, videoId: id, parentId: parent ?? null,
          author: str(item.author), text, likes: count(item.likeCount),
          publishedAt: date(item.published, 1000), publishedLabel: str(item.publishedText),
          replyCount: count(reply.replyCount), repliesCursor: null}]
      })
      return {rows: result, next: str(row.continuation), total: count(row.commentCount),
        disabled: bool(row.disabled), scopes, observation: obs}
    })
  }
}

export class Piped extends HttpProvider implements Provider {
  readonly classifiesSearch = true
  readonly orders = ['top'] as const
  constructor(base: string, transport: Transport, mediaBase: string) { super('piped', base, transport, [safeBase(mediaBase)]) }
  private video(row: Obj, id: string, obs: Observation, detail = false): Video {
    const actualDate = date(row.uploadDate, 1)
    const publishedAt = actualDate ?? date(row.uploaded, 1)
    return withMetrics({...obs, id, url: 'https://www.youtube.com/watch?v=' + id,
      thumbnail: '/api/thumbnail/' + id, title: str(row.title)!,
      channel: {id: channelId(row.uploaderUrl), name: str(detail ? row.uploader : row.uploaderName)},
      publishedAt, publishedPrecision: !publishedAt ? null : actualDate ? 'timestamp' : 'estimated',
      durationSeconds: count(row.duration), kind: row.isShort === true ? 'short' : row.isShort === false ? 'video' : 'unknown',
      views: count(row.views), likes: count(row.likes), comments: count(row.commentCount)}, obs)
  }
  search(query: string, kind: VideoKind, cursor?: SearchCursor) {
    const args: Record<string, string> = {q: query, filter: kind === 'short' ? 'all' : 'videos'}
    if (cursor) args.nextpage = String(cursor)
    return this.remote('search', cursor ? '/nextpage/search' : '/search', args, (value, obs) => {
      const row = object(value)
      if (!Array.isArray(row.items)) throw new UpstreamError('搜索响应缺少 items')
      const found = rows(row.items).flatMap(item => {
        const id = pipedId(item?.url)
        return item.type === 'stream' && VIDEO_ID.test(id) && str(item.title) ? [this.video(item, id, obs)] : []
      })
      return {rows: found, next: str(row.nextpage)}
    })
  }
  detail(id: string) {
    return this.remote('detail', '/streams/' + id, {}, (value, obs) => {
      const row = object(value)
      if (!str(row.title)) throw new UpstreamError('详情缺少对应视频')
      const tracks = rows(row.subtitles).flatMap((t, index) => {
        const endpoint = str(t.url)
        if (!endpoint) return []
        const language = str(t.code), label = str(t.name) ?? language ?? '未标记语言'
        return [{...obs, endpoint, language, label, id: makeTrackId(this.id, language, label, index),
          automatic: bool(t.autoGenerated)}]
      })
      return {video: this.video(row, id, obs, true), tracks}
    })
  }
  comments(id: string, order: CommentOrder, token?: string, parent?: string) {
    if (order === 'new') throw new UpstreamError('Piped 未提供最新排序', null, 'unsupported')
    return this.remote(parent ? 'replies' : token ? 'comments_page' : 'comments_top',
      (token ? '/nextpage/comments/' : '/comments/') + id, token ? {nextpage: token} : {}, (value, obs) => {
      const row = object(value)
      if (!Array.isArray(row.comments)) throw new UpstreamError('评论响应缺少数组')
      const scopes: Record<string, string> = Object.create(null)
      const result = rows(row.comments).flatMap(item => {
        const commentId = str(item.commentId), raw = str(item.commentText)
        const text = raw ? plain(raw) : ''
        if (!commentId || !text) return []
        const cursor = str(item.repliesPage)
        if (cursor) scopes[commentId] = cursor
        return [{...obs, id: commentId, videoId: id, parentId: parent ?? null,
          author: str(item.author), text, likes: count(item.likeCount), publishedAt: null,
          publishedLabel: str(item.commentedTime), replyCount: count(item.replyCount), repliesCursor: null}]
      })
      return {rows: result, next: str(row.nextpage), total: count(row.commentCount),
        disabled: bool(row.disabled), scopes, observation: obs}
    })
  }
}
