import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import type { CommentPage, Detail, Envelope, SearchResult } from '@atlas/shared'
import { createApp } from '../apps/api/src/app.ts'

const app = createApp({db:process.env.ATLAS_FEATURE_DB ?? ':memory:'})
try {
  const call = async <T>(path: string) => {
    const response = await app.inject(path)
    assert.equal(response.statusCode,200,response.body.slice(0,200))
    return response.json<Envelope<T>>().data
  }
  const search = async (kind: string) => {
    const result = await call<SearchResult>('/api/search?' + new URLSearchParams({q:'AI Agent',limit:'20',kind}))
    return {kind, returned:result.videos.length, sources:result.sources, pages:result.pages, warnings:result.warnings,
      kinds:[...new Set(result.videos.map(v => v.kind))]}
  }
  const ordinary = await search('video')
  const shorts = await search('short')
  const noTracks = await call<Detail>('/api/videos/XIMLoLxmTDw')
  const disabled = await call<CommentPage>('/api/videos/e_04ZrNroTo/comments')
  assert(noTracks.tracks.length === 0)
  assert(disabled.disabled && disabled.comments.length === 0)
  assert(ordinary.returned && ordinary.kinds.every(kind => kind === 'video'))
  assert(shorts.kinds.every(kind => kind === 'short'))
  const data = {collectedAt:new Date().toISOString(), ordinary, shorts, noTracks:{id:noTracks.video.id,source:noTracks.source,tracks:0},
    disabled:{videoId:'e_04ZrNroTo',source:disabled.source,disabled:disabled.disabled}, status:(await app.inject('/api/status')).json()}
  await writeFile(process.env.ATLAS_FEATURE_REPORT ?? 'docs/feature-evidence.json',JSON.stringify(data,null,2) + '\n')
  console.log(JSON.stringify({ordinary, shorts, noTracks:data.noTracks, disabled:data.disabled}))
} finally { await app.close() }
