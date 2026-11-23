export type ProviderId = string
export type CommentOrder = 'top' | 'new'
export type VideoKind = 'all' | 'video' | 'short'
export type VideoSort = 'views' | 'publishedAt' | 'comments' | 'likes'
export type CountKey = 'views' | 'likes' | 'comments'

export interface Observation {
  source: ProviderId
  collectedAt: string
}
export interface Channel {
  id: string | null
  name: string | null
}
export interface Video extends Observation {
  id: string
  url: string
  thumbnail: string
  title: string
  channel: Channel
  publishedAt: string | null
  publishedPrecision: 'timestamp' | 'date' | 'estimated' | null
  durationSeconds: number | null
  kind: Exclude<VideoKind, 'all'> | 'unknown'
  views: number | null
  likes: number | null
  comments: number | null
  metricSources: Partial<Record<CountKey, Observation>>
}
export interface Comment extends Observation {
  id: string
  videoId: string
  parentId: string | null
  author: string | null
  text: string
  publishedAt: string | null
  publishedLabel: string | null
  likes: number | null
  replyCount: number | null
  repliesCursor: string | null
}
export interface Track extends Observation {
  id: string
  language: string | null
  label: string
  automatic: boolean | null
}
export interface Cue { startMs: number; endMs: number | null; text: string }
export interface Transcript extends Observation {
  track: Track
  cues: Cue[]
  text: string
}
export interface SearchOptions {
  query: string
  limit: 20 | 50 | 100
  kind: VideoKind
}
export interface SearchPageSample {
  source: ProviderId
  page: number
  returned: number
  newIds: number
}
export interface SearchResult {
  options: SearchOptions
  videos: Video[]
  pages: SearchPageSample[]
  rawCount: number
  uniqueCount: number
  sources: ProviderId[]
  partial: boolean
  warnings: string[]
}
export interface CommentPage extends Observation {
  comments: Comment[]
  nextCursor: string | null
  total: number | null
  disabled: boolean | null
  order: CommentOrder
  supportedOrders: CommentOrder[]
}
export interface Detail extends Observation {
  video: Video
  tracks: Track[]
}
export interface VideoStats {
  id: string
  likes: number | null
  comments: number | null
  metricSources: Partial<Record<CountKey, Observation>>
  warnings: string[]
}
export interface Envelope<T> {
  data: T
  cached: boolean
  fetchedAt: string
  expiresAt: string
}
export interface ProviderState {
  id: ProviderId
  base: string
  state: 'untested' | 'available' | 'error' | 'cooldown'
  checkedAt: string | null
  cooldownUntil: string | null
  lastError: string | null
  successes: number
  failures: number
}
export interface RequestLog {
  source: ProviderId
  operation: string
  collectedAt: string
  status: 'VERIFIED' | 'FAILED' | 'BLOCKED'
  http: number | null
  elapsedMs: number
  error: string | null
}
export interface SourceStatus {
  providers: ProviderState[]
  recent: RequestLog[]
  requests: number
  successes: number
  failures: number
  p50Ms: number | null
  p95Ms: number | null
  cacheHits: number
  cacheMisses: number
  coalesced: number
  fallbacks: number
}
export interface AnalysisContext {
  query: string
  videos: readonly Video[]
  collectedAt: string
}
export interface AnalysisProvider<T> {
  analyze(context: AnalysisContext, signal?: AbortSignal): Promise<T>
}
