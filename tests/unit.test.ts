import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import test from 'node:test'
import type { AddressInfo } from 'node:net'
import type { CommentPage, Envelope, SearchResult, SourceStatus, Video } from '@atlas/shared'
import { analyzeVideos, sortVideos, videoMetrics } from '@atlas/shared/analysis'
import { parseCaptions } from '../apps/api/src/captions.ts'
import { createApp } from '../apps/api/src/app.ts'
import { exportCsv } from '../apps/web/src/export.ts'

const now = Date.parse('2026-11-23T12:00:00Z')
const video: Video = {
  id:'mGnWFfMBvm0', title:'test', url:'https://www.youtube.com/watch?v=mGnWFfMBvm0',
  thumbnail:'/api/thumbnail/mGnWFfMBvm0', channel:{id:null,name:null}, source:'test', collectedAt:new Date(now).toISOString(),
  publishedAt:'2026-11-21T12:00:00.000Z', publishedPrecision:'timestamp', durationSeconds:121, kind:'unknown',
  views:100, likes:null, comments:3, metricSources:{},
}

test('null and zero remain distinct in sorting, distribution and ratios', () => {
  const recent = {...video, id:'UUg5oij7ptw', publishedAt:'2026-11-23T10:00:00.000Z', views:0, comments:0}
  const unknown = {...video, id:'7XzjQa8z0uc', views:null, comments:null}
  assert.deepEqual(sortVideos([unknown, video, recent], 'views', false).map(v => v.id), [recent.id, video.id, unknown.id])
  assert.deepEqual(sortVideos([unknown, recent, video], 'comments').map(v => v.id), [video.id, recent.id, unknown.id])
  assert.deepEqual(sortVideos([video, {...recent, likes:0}, {...unknown, likes:8}], 'likes').map(v => v.id), [unknown.id, recent.id, video.id])
  assert.deepEqual(videoMetrics(video, now), {age:2,recent:false,velocity:50,engagement:.03})
  assert.deepEqual(videoMetrics(recent, now), {age:2/24,recent:true,velocity:null,engagement:null})
  const snapshot = analyzeVideos([unknown, video, recent], now)
  assert.equal(snapshot.median, 50)
  assert.equal(snapshot.comments.at(-1)?.value, 1)
  assert.equal(snapshot.recent[0].video.id, recent.id)
  assert.deepEqual(snapshot.mostEngaged.map(x => x.video.id), [video.id])
})

test('VTT and TTML decode timestamped text, including multilingual cues', () => {
  const vtt = 'WEBVTT\r\n\r\n00:01.500 --> 00:03.120 align:start\r\n<v Test>你好 &amp; <00:02.000>world</v>'
  assert.deepEqual(parseCaptions(vtt), [{startMs:1500,endMs:3120,text:'你好 & world'}])
  const ttml = '<?xml version="1.0"?><tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="1.25s" dur="950ms"><span>字幕</span><br/>second</p></div></body></tt>'
  assert.deepEqual(parseCaptions(ttml), [{startMs:1250,endMs:2200,text:'字幕\nsecond'}])
  assert.deepEqual(parseCaptions('<!DOCTYPE tt SYSTEM "https://example.test/x"><tt/>'), [])
  assert.deepEqual(parseCaptions('<html>Forbidden</html>'), [])
})

test('CSV retains provenance, null cells and shields formula-style text', () => {
  const exported = exportCsv([{...video,title:'=HYPERLINK("example")', channel:{id:null,name:'中文, 频道'}}])
  assert(exported.includes("'=HYPERLINK"))
  assert(exported.includes('"中文, 频道"'))
  assert(exported.includes('"100",,"3"'))
  assert(exported.includes('comments_collected_at'))
})

async function endpoint(write: (url: URL) => {status?: number; headers?: Record<string,string>; body: unknown}) {
  const server = createServer((req,res) => {
    const response = write(new URL(req.url ?? '/', 'http://127.0.0.1'))
    res.writeHead(response.status ?? 200, {'Content-Type':'application/json',...response.headers}).end(JSON.stringify(response.body))
  }).listen(0, '127.0.0.1')
  await once(server,'listening')
  return {url:'http://127.0.0.1:' + (server.address() as AddressInfo).port, close:() => server.close()}
}

test('fallback honors Retry-After, then serves a cached successful search with typed nullable fields', async t => {
  let primaryCalls = 0, backupCalls = 0
  const primary = await endpoint(() => { primaryCalls++; return {status:429, headers:{'Retry-After':'120'}, body:{error:'limited'}} })
  const backup = await endpoint(() => { backupCalls++; return {body:{items:Array.from({length:20},(_,i) => ({
    url:'/watch?v=abcdefghij' + i.toString(36), title:'Fixture '+i, type:'stream', uploaderName:'Fixture channel',
    views:i, uploaded:now, duration:60, isShort:false,
  }))}} })
  const app = createApp({db:':memory:',invidious:primary.url,piped:backup.url,gapMs:1})
  t.after(async () => { await app.close(); primary.close(); backup.close() })
  const url = '/api/search?q=test&limit=20'
  const first = await app.inject(url)
  assert.equal(first.statusCode, 200)
  const record = first.json<Envelope<SearchResult>>()
  assert.equal(record.cached, false)
  assert.deepEqual(record.data.sources, ['piped'])
  assert.equal(record.data.videos.length,20)
  assert.equal(record.data.videos[0].views,0)
  assert.equal(record.data.videos[0].likes,null)
  assert.equal(record.data.videos[0].kind,'video')
  assert.equal((await app.inject(url)).json<Envelope<SearchResult>>().cached, true)
  await app.inject('/api/search?q=second&limit=20')
  assert.equal(primaryCalls,1)
  assert.equal(backupCalls,2)
  const status = (await app.inject('/api/status')).json<SourceStatus>()
  assert.equal(status.providers[0].state,'cooldown')
  assert.equal(status.fallbacks,2)
  assert.equal(status.cacheHits,1)
})

test('comment continuation stays scoped, deduplicates rows and keeps parent identity', async t => {
  const c = (id: string) => ({commentId:id, author:'Fixture', content:'comment from a test',likeCount:0})
  const primary = await endpoint(url => {
    const token = url.searchParams.get('continuation')
    if (token === 'page2') return {body:{comments:[c('two'),c('two')]}}
    if (token === 'reply') return {body:{comments:[c('child')]}}
    return {body:{commentCount:3, continuation:'page2',comments:[{...c('one'),replies:{replyCount:1,continuation:'reply'}}]}}
  })
  const app = createApp({db:':memory:',invidious:primary.url,piped:primary.url,gapMs:1})
  t.after(async () => { await app.close(); primary.close() })
  const path = '/api/videos/' + video.id + '/comments'
  const {data: first} = (await app.inject(path)).json<Envelope<CommentPage>>()
  assert(first.nextCursor && first.nextCursor !== 'page2')
  const {data: next} = (await app.inject(path + '?cursor=' + first.nextCursor)).json<Envelope<CommentPage>>()
  assert.deepEqual(next.comments.map(x => x.id), ['two'])
  const {data: reply} = (await app.inject(path + '?cursor=' + first.comments[0].repliesCursor)).json<Envelope<CommentPage>>()
  assert.equal(reply.comments[0].parentId, 'one')
  assert.equal((await app.inject(path + '?order=new&cursor=' + first.nextCursor)).statusCode,409)
  assert.equal((await app.inject('/api/videos/7XzjQa8z0uc/comments?cursor=' + first.nextCursor)).statusCode,409)
})

test('double-provider denial fails explicitly and never returns seeded videos', async t => {
  const denied = await endpoint(() => ({status:403,body:{error:'blocked'}}))
  const app = createApp({db:':memory:',invidious:denied.url,piped:denied.url,gapMs:1})
  t.after(async () => { await app.close(); denied.close() })
  const r = await app.inject('/api/search?q=example')
  assert.equal(r.statusCode,503)
  assert.equal(r.json().error,'PROVIDER_UNAVAILABLE')
  assert.equal(r.json().data,undefined)
})
