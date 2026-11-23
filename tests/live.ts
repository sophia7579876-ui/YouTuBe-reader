import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { CommentPage, Detail, Envelope, SearchResult, SourceStatus, Transcript, VideoStats } from '@atlas/shared'
import { createApp } from '../apps/api/src/app.ts'

const temp = await mkdtemp(join(tmpdir(), 'atlas-live-'))
const db = process.env.ATLAS_LIVE_DB ?? ':memory:'
const output = process.env.ATLAS_LIVE_REPORT ?? 'docs/live-evidence.json'
const app = createApp({db, logger: true, webRoot: temp})
const startedAt = new Date().toISOString()
const queries = ['AI Agent', 'Claude Code', 'OpenAI Codex', 'AI automation']
const searches: unknown[] = [], comments: unknown[] = [], captions: unknown[] = [], stats: unknown[] = []
const searchIds = new Set<string>()
const errors: {route: string; status: number; message: string}[] = []

async function call<T>(path: string) {
  const response = await app.inject({method: 'GET', url: path})
  if (response.statusCode === 200) return response.json() as T
  let message = ''
  try { message = response.json().message } catch { message = response.body.slice(0, 140) }
  errors.push({route: path.split('?')[0], status: response.statusCode, message})
  return null
}
const get = async <T>(path: string) => (await call<Envelope<T>>(path))?.data ?? null
const source = (path: string, id: string, args: Record<string, string> = {}) =>
  '/api/videos/' + id + path + (Object.keys(args).length ? '?' + new URLSearchParams(args) : '')
const hash = (input: string) => createHash('sha256').update(input).digest('hex')
const identifiers = (p: CommentPage | null) => new Set(p?.comments.map(c => c.id) ?? [])

async function save() {
  const status = await call<SourceStatus>('/api/status')
  await mkdir(dirname(output), {recursive: true})
  await writeFile(output, JSON.stringify({startedAt, updatedAt: new Date().toISOString(), searches,
    uniqueAcrossSearches: searchIds.size, comments, captions, stats, status, errors}, null, 2) + '\n')
}

try {
  for (const q of queries) {
    const path = '/api/search?' + new URLSearchParams({q, limit: '100', kind: 'all'})
    const result = await get<SearchResult>(path)
    if (!result) { searches.push({query: q, status: 'BLOCKED'}); await save(); continue }
    const {videos, pages, rawCount, uniqueCount, sources, warnings} = result
    const cacheHit = (await call<Envelope<SearchResult>>(path))?.cached ?? false
    videos.forEach(v => searchIds.add(v.id))
    const fields = {
      title: videos.filter(v => v.title).length, id: videos.length, channel: videos.filter(v => v.channel.name).length,
      publishedAt: videos.filter(v => v.publishedAt).length, duration: videos.filter(v => v.durationSeconds !== null).length,
      views: videos.filter(v => v.views !== null).length, likes: videos.filter(v => v.likes !== null).length,
      comments: videos.filter(v => v.comments !== null).length, classified: videos.filter(v => v.kind !== 'unknown').length,
    }
    searches.push({query: q, status: videos.length ? 'VERIFIED' : 'FAILED', requested: 100, returned: videos.length,
      rawCount, uniqueCount, pages, sources, warnings, fields, cacheHit, sampleIds: videos.slice(0, 3).map(v => v.id)})
    console.log(q, videos.length, rawCount, pages.length)
    await save()
  }
  const known = ['ntDIxaeo3Wg', 'mGnWFfMBvm0', '7XzjQa8z0uc', 'EsTrWCV0Ph4', 'X4FVEEegCbk',
    'SJywU4UQryQ', 'fl1DSmwQKKY', 'WdZjoMi6W7Y', 'UUg5oij7ptw', '8KkKuTCFvzI']
  const preferred = [...known.filter(id => searchIds.has(id)), ...known.filter(id => !searchIds.has(id))]
  for (const id of preferred) {
    const first = await get<CommentPage>(source('/comments', id))
    const next = first?.nextCursor ? await get<CommentPage>(source('/comments', id, {cursor: first.nextCursor})) : null
    const latest = await get<CommentPage>(source('/comments', id, {order: 'new'}))
    const parent = [...(first?.comments ?? []), ...(next?.comments ?? [])].find(c => c.repliesCursor)
    const replies = parent?.repliesCursor ? await get<CommentPage>(source('/comments', id, {cursor: parent.repliesCursor})) : null
    const ids = identifiers(first)
    const nextIds = identifiers(next)
    const latestTimes = latest?.comments.flatMap(c => c.publishedAt ? [Date.parse(c.publishedAt)] : []) ?? []
    comments.push({id, searchHit: searchIds.has(id), source: first?.source, first: first?.comments.length ?? null,
      next: next?.comments.length ?? null, hasNext: !!first?.nextCursor, latest: latest?.comments.length ?? null,
      changedOrder: !!first && !!latest && first.comments[0]?.id !== latest.comments[0]?.id,
      newestMonotonic: latestTimes.length > 1 ? latestTimes.every((t, i) => !i || t <= latestTimes[i - 1]) : null,
      firstUnique: ids.size, nextUnique: nextIds.size, overlap: [...nextIds].filter(id => ids.has(id)).length,
      replyParent: parent?.id ?? null, replies: replies?.comments.length ?? null,
      replyParentVerified: !!parent && !!replies?.comments.length && replies.comments.every(c => c.parentId === parent.id),
      total: first?.total ?? null, example: first?.comments[0] ? { id: first.comments[0].id,
        author: first.comments[0].author, text: first.comments[0].text.slice(0, 180) } : null})
    const detail = await get<Detail>(source('', id))
    const enriched = await get<VideoStats>(source('/stats', id))
    stats.push({id, source: detail?.source ?? null, publishedAt: detail?.video.publishedAt ?? null,
      views: detail?.video.views ?? null, likes: enriched?.likes ?? null, comments: enriched?.comments ?? null})
    if (detail?.tracks.length && captions.filter(r => (r as {status?: string}).status === 'VERIFIED').length < 5) {
      const track = detail.tracks.find(t => t.language === 'en') ?? detail.tracks[0]
      const transcript = await get<Transcript>(source('/transcripts/' + track.id, id))
      if (transcript?.text && transcript.cues.length) {
        const filename = join(temp, id + '.txt')
        await writeFile(filename, transcript.text)
        const exported = await readFile(filename, 'utf8')
        captions.push({id, source: transcript.source, label: transcript.track.label, language: transcript.track.language,
          tracks: detail.tracks.length, automatic: transcript.track.automatic, cues: transcript.cues.length,
          timestamps: transcript.cues.every((c, i, cues) => Number.isFinite(c.startMs) && c.startMs >= 0 &&
            (!i || c.startMs >= cues[i - 1].startMs) && (c.endMs === null || c.endMs >= c.startMs)),
          textRoundtrip: exported === transcript.text, bytes: Buffer.byteLength(exported),
          sha256: hash(exported), example: transcript.cues[0], status: 'VERIFIED'})
      } else captions.push({id, status: 'BLOCKED'})
    }
    console.log('video', id, first?.comments.length, next?.comments.length, latest?.comments.length, replies?.comments.length)
    await save()
  }
  const chinese = await get<SearchResult>('/api/search?' + new URLSearchParams({q:'AI 自動化 教學',limit:'20'}))
  searches.push({query: 'AI 自動化 教學', status: chinese?.videos.length ? 'VERIFIED' : 'BLOCKED',
    requested: 20, returned: chinese?.videos.length ?? 0, sampleTitle: chinese?.videos[0]?.title ?? null})
} finally {
  await save()
  await app.close()
  await rm(temp, {recursive: true, force: true})
}
