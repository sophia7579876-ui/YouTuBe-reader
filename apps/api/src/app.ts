import Fastify, {LogController, type FastifyReply} from 'fastify'
import staticFiles from '@fastify/static'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { CommentOrder, VideoKind } from '@atlas/shared'
import { Cache } from './cache.ts'
import { DEFAULT_INVIDIOUS, DEFAULT_PIPED, DEFAULT_PIPED_MEDIA, Invidious, Piped, VIDEO_ID } from './provider.ts'
import { ApiError, VideoService } from './service.ts'
import { safeBase, Telemetry, Transport, UpstreamError } from './transport.ts'

export interface AppOptions {
  db?: string
  invidious?: string
  piped?: string
  media?: string
  webRoot?: string
  logger?: boolean
  gapMs?: number
  timeoutMs?: number
}
type VideoParams = {id: string}
type Image = {bytes: Buffer; mime: string} | {location: string | null}
const kindOptions = ['all', 'video', 'short'] as const
export const trackPattern = /^[\w-]{2,80}$/

function validId(value: string) {
  if (!VIDEO_ID.test(value)) throw new ApiError('INVALID_VIDEO', '视频 ID 格式无效。', 400)
  return value
}
function sendImage(reply: FastifyReply, image: {bytes: Buffer; mime: string}) {
  return reply.type(image.mime).header('Cache-Control', 'public, max-age=43200').send(image.bytes)
}

export function createApp(options: AppOptions = {}) {
  const app = Fastify({logger: options.logger ?? false, requestTimeout: 120_000, bodyLimit: 16_000,
    logController: new LogController({disableRequestLogging: true}),
  })
  const telemetry = new Telemetry(entry => app.log.warn(entry, 'Upstream request'))
  const cache = new Cache(options.db ?? process.env.ATLAS_DB ?? resolve('.data/atlas.sqlite'), telemetry)
  const transport = new Transport(telemetry, options.gapMs, options.timeoutMs)
  const media = safeBase(options.media ?? process.env.PIPED_MEDIA_URL ?? DEFAULT_PIPED_MEDIA)
  const providers = [
    new Invidious(options.invidious ?? process.env.INVIDIOUS_URL ?? DEFAULT_INVIDIOUS, transport),
    new Piped(options.piped ?? process.env.PIPED_URL ?? DEFAULT_PIPED, transport, media),
  ]
  const service = new VideoService(providers, cache, telemetry)
  const images = new Map<string, {bytes: Buffer; mime: string; expires: number}>()
  const imagePending = new Map<string, Promise<Image>>()
  const imageMisses = new Map<string, number>()
  app.addHook('onClose', () => cache.close())
  app.addHook('onSend', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('Referrer-Policy', 'no-referrer')
    if (!req.url.startsWith('/api/thumbnail/') && req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store')
  })
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ApiError) return reply.code(error.http).send({error: error.code, message: error.message, reasons: error.reasons})
    app.log.error(error)
    return reply.code(500).send({error: 'INTERNAL_ERROR', message: '服务发生错误，请稍后重试。'})
  })
  app.get('/api/health', async () => ({ok: true}))
  app.get('/api/status', async () => telemetry.snapshot())
  app.get<{Querystring: {q?: string; limit?: string; kind?: string}}>('/api/search', async req => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
    const count = Number(req.query.limit ?? 20)
    const kind = (req.query.kind ?? 'all') as VideoKind
    if (!q || q.length > 100 || ![20, 50, 100].includes(count) || !kindOptions.includes(kind)) {
      throw new ApiError('INVALID_SEARCH', '请输入 1–100 字关键词，并选择有效的搜索条件。', 400)
    }
    return service.search({query: q, limit: count as 20 | 50 | 100, kind})
  })
  app.get<{Params: VideoParams; Querystring: {source?: string}}>('/api/videos/:id', async req =>
    service.detail(validId(req.params.id), req.query.source))
  app.get<{Params: VideoParams; Querystring: {source?: string}}>('/api/videos/:id/stats', async req =>
    service.stats(validId(req.params.id), req.query.source))
  app.get<{Params: VideoParams; Querystring: {order?: CommentOrder; source?: string; cursor?: string}}>('/api/videos/:id/comments', async req => {
    const order = req.query.order ?? 'top'
    const cursor = req.query.cursor
    if (!['top', 'new'].includes(order) || (cursor !== undefined && !/^[a-f\d]{64}$/.test(cursor))) {
      throw new ApiError('INVALID_COMMENT_QUERY', '评论排序或分页参数无效。', 400)
    }
    return service.comments(validId(req.params.id), order, req.query.source, cursor)
  })
  app.get<{Params: VideoParams & {track: string}}>('/api/videos/:id/transcripts/:track', async req => {
    if (!trackPattern.test(req.params.track)) throw new ApiError('INVALID_TRACK', '字幕轨道参数无效。', 400)
    return service.transcript(validId(req.params.id), req.params.track)
  })
  app.get<{Params: VideoParams}>('/api/thumbnail/:id', async (req, reply) => {
    const id = validId(req.params.id)
    const cached = images.get(id)
    if (cached && cached.expires > Date.now()) return sendImage(reply, cached)
    if ((imageMisses.get(id) ?? 0) > Date.now()) return reply.code(204).send()
    let pending = imagePending.get(id)
    if (!pending) {
      const target = new URL('/vi/' + id + '/mqdefault.jpg?host=i.ytimg.com', media)
      pending = transport.get<Image>('thumbnail', 'image', target, 'image', value => value as Image)
      imagePending.set(id, pending)
    }
    try {
      const result = await pending
      if ('location' in result) throw new UpstreamError('缩略图代理重定向')
      if (images.size >= 160) images.delete(images.keys().next().value!)
      images.set(id, {...result, expires: Date.now() + 12 * 3600_000})
      return sendImage(reply, result)
    } catch {
      if (imageMisses.size >= 160) imageMisses.delete(imageMisses.keys().next().value!)
      imageMisses.set(id, Date.now() + 5 * 60_000)
      return reply.code(204).send()
    } finally { imagePending.delete(id) }
  })

  const webRoot = options.webRoot ?? resolve('apps/web/dist')
  if (existsSync(resolve(webRoot, 'index.html'))) app.register(staticFiles, {root: webRoot})
  return app
}
