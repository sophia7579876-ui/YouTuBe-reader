import { useEffect, useMemo, useRef, useState } from 'react'
import type { Envelope, SearchOptions, SearchResult, Video, VideoSort, VideoStats } from '@atlas/shared'
import { DAY, sortVideos } from '@atlas/shared/analysis'
import { request } from './lib.ts'

export function useSearch() {
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState<SearchOptions['limit']>(20)
  const [kind, setKind] = useState<SearchOptions['kind']>('all')
  const [age, setAge] = useState(0)
  const [minimum, setMinimum] = useState(0)
  const [order, setOrder] = useState<{key: VideoSort; descending: boolean}>({key:'views', descending:true})
  const [response, setResponse] = useState<Envelope<SearchResult>>()
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const [stats, setStats] = useState<Record<string, VideoStats>>({})
  const [progress, setProgress] = useState<{done: number; total: number; missing: number}>()
  const searchRequest = useRef<AbortController | null>(null)
  const statsRequest = useRef<AbortController | null>(null)
  const dateRef = response ? Date.parse(response.fetchedAt) : 0
  const videos = useMemo(() => {
    const enriched = (response?.data.videos ?? []).map(v => {
      const fact = stats[v.id]
      return fact ? {...v, likes: fact.likes ?? v.likes, comments: fact.comments ?? v.comments,
        metricSources: {...v.metricSources, ...Object.fromEntries(Object.entries(fact.metricSources).filter(([key]) => key !== 'views'))}} : v
    })
    return sortVideos(enriched.filter(v => (!minimum || (v.views !== null && v.views >= minimum))
      && (!age || (v.publishedAt !== null && Date.parse(v.publishedAt) >= dateRef - age * DAY
        && Date.parse(v.publishedAt) <= dateRef))), order.key, order.descending)
  }, [response, stats, minimum, age, dateRef, order])
  useEffect(() => () => { searchRequest.current?.abort(); statsRequest.current?.abort() }, [])

  async function search(value = query) {
    const q = value.trim()
    if (!q) return
    setQuery(q)
    setSearching(true)
    setError('')
    setResponse(undefined)
    setStats({})
    setProgress(undefined)
    searchRequest.current?.abort()
    statsRequest.current?.abort()
    const controller = new AbortController()
    searchRequest.current = controller
    try {
      const result = await request<Envelope<SearchResult>>('/search?' + new URLSearchParams({q, limit:String(limit), kind}), controller.signal)
      if (!controller.signal.aborted) {
        setResponse(result)
        const first = sortVideos(result.data.videos, order.key, order.descending)
          .filter(v => (v.likes === null || v.comments === null) && (!minimum || (v.views ?? -1) >= minimum)
            && (!age || (v.publishedAt && Date.parse(v.publishedAt) >= Date.parse(result.fetchedAt) - age * DAY)))
        void collect(first.slice(0, 3))
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError((cause as Error).message)
    } finally {
      if (!controller.signal.aborted) setSearching(false)
    }
  }

  const targets = videos.filter(v => (v.likes === null || v.comments === null) && (!stats[v.id] || stats[v.id].warnings.length))
  async function collect(targets: readonly Video[]) {
    if (!targets.length) return
    statsRequest.current?.abort()
    const controller = new AbortController()
    statsRequest.current = controller
    let missing = 0
    setProgress({done:0, total:targets.length, missing})
    for (const [i, video] of targets.entries()) {
      if (controller.signal.aborted) return
      try {
        const value = await request<Envelope<VideoStats>>('/videos/' + video.id + '/stats?source=' + encodeURIComponent(video.source), controller.signal)
        if (controller.signal.aborted) return
        if (value.data.likes === null || value.data.comments === null) missing++
        // Retry only records with incomplete fields on the next user-initiated pass.
        if (value.data.likes !== null || value.data.comments !== null) {
          setStats(previous => ({...previous, [video.id]:value.data}))
        }
      } catch {
        if (controller.signal.aborted) return
        missing++
      }
      setProgress({done:i + 1, total:targets.length, missing})
    }
  }

  return {query, setQuery, limit, setLimit, kind, setKind, age, setAge, minimum, setMinimum,
    order, setOrder, response, videos, searching, error, search, enrich: () => collect(targets), progress,
    cancelEnrich: () => {statsRequest.current?.abort(); setProgress(undefined)},
    canEnrich: targets.length > 0,
  }
}
export type SearchState = ReturnType<typeof useSearch>
