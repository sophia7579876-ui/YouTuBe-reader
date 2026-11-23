import type { Video, VideoSort } from './index.ts'

export const DAY = 86400000

export function sortVideos(videos: readonly Video[], key: VideoSort, descending = true) {
  const value = (v: Video) => key === 'publishedAt' ? (v.publishedAt ? Date.parse(v.publishedAt) : null) : v[key]
  return [...videos].sort((a, b) => {
    const left = value(a), right = value(b)
    if (left === null) return right === null ? 0 : 1
    if (right === null) return -1
    return (left - right) * (descending ? -1 : 1)
  })
}

export function videoMetrics(video: Video, asOf: number) {
  const age = video.publishedAt ? (asOf - Date.parse(video.publishedAt)) / DAY : null
  const recent = age !== null && age >= 0 && age < 1
  return {
    age,
    recent,
    velocity: age !== null && age >= 1 && video.views !== null ? video.views / age : null,
    engagement: video.comments !== null && video.views !== null && video.views > 0 ? video.comments / video.views : null,
  }
}

export function analyzeVideos(videos: readonly Video[], asOf: number) {
  const views = videos.flatMap(v => v.views === null ? [] : [v.views]).sort((a, b) => a - b)
  const mid = Math.floor(views.length / 2)
  const median = views.length ? (views.length % 2 ? views[mid] : (views[mid - 1] + views[mid]) / 2) : null
  const date = [
    { label: '< 24 小时', value: 0 }, { label: '1–7 天', value: 0 }, { label: '8–30 天', value: 0 },
    { label: '31–90 天', value: 0 }, { label: '> 90 天', value: 0 }, { label: '未知', value: 0 },
  ]
  const comments = [
    { label: '0', value: 0 }, { label: '1–9', value: 0 }, { label: '10–99', value: 0 },
    { label: '100–999', value: 0 }, { label: '1,000+', value: 0 }, { label: '未知', value: 0 },
  ]
  const ranked = videos.map(video => ({ video, ...videoMetrics(video, asOf) }))
  for (const {video, age} of ranked) {
    date[age === null || !Number.isFinite(age) || age < 0 ? 5 : age < 1 ? 0 : age <= 7 ? 1 : age <= 30 ? 2 : age <= 90 ? 3 : 4].value++
    const count = video.comments
    comments[count === null ? 5 : count === 0 ? 0 : count < 10 ? 1 : count < 100 ? 2 : count < 1000 ? 3 : 4].value++
  }
  return {
    total: videos.length, knownViews: views.length, median,
    average: views.length ? views.reduce((a, b) => a + b, 0) / views.length : null,
    max: views.at(-1) ?? null, date, comments,
    recent: ranked.filter(row => row.recent),
    mostViewed: sortVideos(videos.filter(v => v.views !== null), 'views').slice(0, 20),
    mostEngaged: ranked.filter(row => row.engagement !== null)
      .sort((a, b) => b.engagement! - a.engagement! || (b.video.comments ?? 0) - (a.video.comments ?? 0)).slice(0, 20),
  }
}
