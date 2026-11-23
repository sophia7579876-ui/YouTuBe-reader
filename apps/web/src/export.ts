import type { Video } from '@atlas/shared'

const header = ['video_id','title','url','channel','channel_id','published_at','published_precision','duration_seconds',
  'video_kind','views','likes','comments','source','collected_at','views_source','views_collected_at','likes_source',
  'likes_collected_at','comments_source','comments_collected_at']
const cell = (value: string | number | null | undefined) => {
  if (value === null || value === undefined) return ''
  let normalized = String(value)
  if (typeof value === 'string' && (/^[\s]*[=+@-]/.test(normalized) || /^[\t\r\n]/.test(normalized))) normalized = "'" + normalized
  return '"' + normalized.replaceAll('"','""') + '"'
}
export function exportCsv(videos: readonly Video[]) {
  return '\uFEFF' + [header.join(','), ...videos.map(v =>
    [v.id,v.title,v.url,v.channel.name,v.channel.id,v.publishedAt,v.publishedPrecision,v.durationSeconds,v.kind,
      v.views,v.likes,v.comments,v.source,v.collectedAt,v.metricSources.views?.source,v.metricSources.views?.collectedAt,
      v.metricSources.likes?.source,v.metricSources.likes?.collectedAt,v.metricSources.comments?.source,v.metricSources.comments?.collectedAt]
      .map(cell).join(','))].join('\r\n') + '\r\n'
}
export function saveFile(contents: string, name: string, type: string) {
  const path = URL.createObjectURL(new Blob([contents], {type}))
  const anchor = document.createElement('a')
  anchor.download = name
  anchor.href = path
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(path), 1000)
}
