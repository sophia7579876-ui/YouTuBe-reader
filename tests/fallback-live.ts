import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { writeFile } from 'node:fs/promises'
import type { CommentPage, Detail, Envelope, SearchResult, SourceStatus, Transcript } from '@atlas/shared'
import { createApp } from '../apps/api/src/app.ts'

// Simulate only loss of access to the primary. All backup data comes from its live public API.
const unavailable = createServer((_req, res) => {
  res.writeHead(503, {'Retry-After':'120','Content-Type':'text/plain'}).end('controlled primary outage')
}).listen(0, '127.0.0.1')
await once(unavailable, 'listening')
const app = createApp({db:':memory:',invidious:'http://127.0.0.1:' + (unavailable.address() as AddressInfo).port})
try {
  const collect = async <T>(url: string) => {
    const response = await app.inject(url)
    assert.equal(response.statusCode,200,response.body.slice(0,250))
    return response.json<Envelope<T>>().data
  }
  const q = '/api/search?q=AI+Agent&limit=20'
  const data = await collect<SearchResult>(q)
  assert.deepEqual(data.sources,['piped'])
  assert.equal(data.videos.length,20)
  const second = (await app.inject(q)).json<Envelope<SearchResult>>()
  assert.equal(second.cached,true)
  const id = 'mGnWFfMBvm0'
  const base = '/api/videos/' + id
  const detail = await collect<Detail>(base)
  const first = await collect<CommentPage>(base + '/comments')
  assert(first.nextCursor)
  const next = await collect<CommentPage>(base + '/comments?cursor=' + first.nextCursor)
  assert(next.comments.length)
  const track = detail.tracks.find(t => t.language === 'en')
  assert(track)
  const transcript = await collect<Transcript>(base + '/transcripts/' + track.id)
  assert(transcript.cues.length && transcript.text)
  const status = (await app.inject('/api/status')).json<SourceStatus>()
  const output = {collectedAt:new Date().toISOString(), primary:'controlled 503 and Retry-After', search:data.videos.length,
    returnedSource:data.sources[0], cacheHit:second.cached, videoId:id, title:detail.video.title,
    views:detail.video.views, likes:detail.video.likes, comments:first.total, firstPage:first.comments.length,
    secondPage:next.comments.length, overlap:next.comments.filter(c => first.comments.some(x => x.id === c.id)).length,
    captionLanguage:transcript.track.language, cues:transcript.cues.length, status}
  await writeFile(process.env.ATLAS_FALLBACK_REPORT ?? 'docs/fallback-evidence.json',JSON.stringify(output,null,2) + '\n')
  console.log(output)
} finally {
  await app.close()
  unavailable.close()
}
