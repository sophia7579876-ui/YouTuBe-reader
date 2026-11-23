import { useDeferredValue, useMemo, useState } from 'react'
import { ArrowLeft, ArrowUpRight, ChevronDown, Clipboard, Download, LoaderCircle, MessageCircle, Search, ThumbsUp } from 'lucide-react'
import type { Comment, CommentOrder, CommentPage, Detail, Envelope, Track, Transcript } from '@atlas/shared'
import { date, dateTime, duration, number, request, stamp, useResource } from './lib.ts'
import { saveFile } from './export.ts'
import { CacheTime, Empty, ErrorBox, Loading, Source, Thumbnail } from './ui.tsx'

export function DetailPage({id, preferred}: {id: string; preferred?: string}) {
  const [tab, setTab] = useState<'comments'|'transcripts'>('comments')
  const [version, retry] = useState(0)
  const base = '/videos/' + id
  const query = preferred ? '?source=' + encodeURIComponent(preferred) : ''
  const detail = useResource<Envelope<Detail>>(base + query, version)
  const {video, tracks} = detail.data?.data ?? {}
  const commentFeed = useCommentFeed(base, preferred, tab === 'comments')
  return <>
    <a className="back-link" href="#/search"><ArrowLeft size={17}/>返回搜索结果</a>
    {detail.loading && <Loading>正在读取视频信息…</Loading>}
    {detail.error && <ErrorBox message={detail.error} retry={() => retry(v => v + 1)}/>}
    {video && <section className="panel detail-summary">
      <div className="video-banner">
        <Thumbnail video={video} large/>
        <div>
          <h1>{video.title}</h1>
          <div className="meta-items"><span>{video.channel.name ?? '频道未知'}</span><span>{date(video.publishedAt)}</span><Source id={video.source}/></div>
          <div className="meta-items"><CacheTime response={detail.data!}/>
            <a href={video.url} target="_blank" rel="noopener noreferrer">YouTube 原链接 <ArrowUpRight size={14}/></a>
          </div>
        </div>
      </div>
      <div className="metrics-strip">
        <Stat name="播放量" value={number(video.views)}/><Stat name="点赞" value={number(video.likes)}/>
        <Stat name="评论" value={number(commentFeed.total ?? video.comments)}/>
        <Stat name="时长" value={duration(video.durationSeconds)}/>
      </div>
    </section>}
    <section className="panel detail-data">
      <div className="tabs" aria-label="视频数据">
        <button className={tab === 'comments' ? 'selected' : ''} aria-pressed={tab === 'comments'} onClick={() => setTab('comments')}>
          评论 {commentFeed.total !== null && <span>({number(commentFeed.total)})</span>}
        </button>
        <button className={tab === 'transcripts' ? 'selected' : ''} aria-pressed={tab === 'transcripts'} onClick={() => {commentFeed.preserve(); setTab('transcripts')}}>
          字幕 {tracks && <span>({tracks.length})</span>}
        </button>
      </div>
      {tab === 'comments' ? <Comments base={base} feed={commentFeed}/>
        : <Transcripts key={id + (detail.data?.fetchedAt ?? '')} base={base} tracks={tracks}
          loading={detail.loading} error={detail.error} id={id}/>}
    </section>
  </>
}

function Stat({name,value}: {name: string; value: string}) {
  return <div className="stat"><span>{name}</span><strong>{value}</strong></div>
}

type Sequence = { rows: Comment[]; cursor: string | null }
function appendUnique(rows: Comment[], extra: Comment[]) {
  const unique = new Map(rows.map(row => [row.id, row]))
  for (const row of extra) if (!unique.has(row.id)) unique.set(row.id, row)
  return [...unique.values()]
}
function useCommentFeed(base: string, preferred: string | undefined, enabled: boolean) {
  const [order, setOrder] = useState<CommentOrder>('top')
  const [version, setVersion] = useState(0)
  const args = new URLSearchParams({order})
  if (preferred) args.set('source', preferred)
  const url = base + '/comments?' + args
  // Keep the first page loaded while the sidebar lives, so switching tabs preserves state and count.
  const response = useResource<Envelope<CommentPage>>(enabled ? url : null, version)
  const [last, setLast] = useState<Envelope<CommentPage>>()
  const [pages, setPages] = useState<{url: string; version: number; firstAt: string} & Sequence>()
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState('')
  const front = response.data ?? (!enabled ? last : undefined)
  const same = !!front && pages?.firstAt === front.fetchedAt && pages?.url === url && pages?.version === version
  const items = same ? pages!.rows : front?.data.comments ?? []
  const cursor = same ? pages!.cursor : front?.data.nextCursor ?? null

  function changeSort(value: CommentOrder) {
    setOrder(value)
    setPages(undefined)
    setMoreError('')
    setLast(undefined)
  }
  async function more() {
    if (!front || !cursor || loadingMore) return
    setLoadingMore(true)
    setMoreError('')
    try {
      const {data} = await request<Envelope<CommentPage>>(url + '&cursor=' + cursor)
      setPages({url, version, firstAt: front.fetchedAt, rows: appendUnique(items, data.comments),
        cursor:data.nextCursor === cursor ? null : data.nextCursor})
    } catch (error) { setMoreError((error as Error).message) }
    finally { setLoadingMore(false) }
  }
  function preserve() { if (response.data) setLast(response.data) }
  return {front, items, cursor, loadingMore, moreError, error:response.error, loading:response.loading,
    order, total:front?.data.total ?? null, changeSort, more, preserve, retry:() => setVersion(v => v + 1)}
}
type Feed = ReturnType<typeof useCommentFeed>

function Comments({base, feed}: {base: string; feed: Feed}) {
  const [query, setQuery] = useState('')
  const deferred = useDeferredValue(query.trim().toLocaleLowerCase())
  const visible = useMemo(() => {
    const matching = deferred ? feed.items.filter(c => (c.text + ' ' + (c.author ?? '')).toLocaleLowerCase().includes(deferred)) : feed.items
    if (feed.order !== 'new') return matching
    const time = (c: Comment) => c.publishedAt ? Date.parse(c.publishedAt) : Number.NEGATIVE_INFINITY
    return matching.toSorted((a,b) => time(b) - time(a))
  }, [deferred, feed.items, feed.order])
  const supported = feed.front?.data.supportedOrders ?? ['top','new']
  return <>
    <div className="detail-toolbar">
      <label className="inline-select">评论排序<select aria-label="评论排序" value={feed.order} disabled={feed.loadingMore} onChange={e => feed.changeSort(e.target.value as CommentOrder)}>
        <option value="top">热门／默认</option><option value="new" disabled={!supported.includes('new')}>最新</option>
      </select></label>
      <label className="input-icon comment-search"><Search size={17}/><input placeholder="搜索已加载评论" aria-label="搜索已加载评论"
        value={query} onChange={e => setQuery(e.target.value)}/></label>
    </div>
    {feed.loading && <Loading>正在获取真实评论…</Loading>}
    {feed.error && <ErrorBox message={feed.error} retry={feed.retry}/>}
    {feed.front && <>
      <div className="comment-meta meta-items">
        <Source id={feed.front.data.source}/><CacheTime response={feed.front}/>
        <span>已加载 {feed.items.length} 条{deferred && ' · 匹配 ' + visible.length + ' 条'}</span>
        {feed.order === 'new' && <span>按已加载评论的可用时间排序</span>}
      </div>
      {!visible.length && <Empty title={feed.front.data.disabled ? '此视频已关闭评论' : deferred ? '已加载评论中没有匹配内容' : '上游没有返回可读评论'}>
        {deferred && feed.cursor ? '可以加载下一页后继续筛选。' : undefined}
      </Empty>}
      <ol className="comment-list" aria-label="评论列表">
        {visible.map(comment => <CommentItem key={feed.order + comment.id} comment={comment} base={base} order={feed.order}/>)}
      </ol>
      {feed.moreError && <ErrorBox message={feed.moreError} retry={() => void feed.more()}/>}
      {feed.cursor && <div className="more"><button className="button secondary" disabled={feed.loadingMore} onClick={() => void feed.more()}>
        {feed.loadingMore ? <LoaderCircle className="spin" size={16}/> : <ChevronDown size={16}/>}加载更多评论
      </button></div>}
    </>}
  </>
}

function CommentItem({comment, base, order}: {comment: Comment; base: string; order: CommentOrder}) {
  const [state, setState] = useState<Sequence>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const cursor = state ? state.cursor : comment.repliesCursor
  async function more() {
    if (!cursor || loading) return
    setLoading(true)
    setError('')
    try {
      const {data} = await request<Envelope<CommentPage>>(base + '/comments?' + new URLSearchParams({order,cursor}))
      setState({rows:appendUnique(state?.rows ?? [], data.comments), cursor:data.nextCursor === cursor ? null : data.nextCursor})
    } catch (cause) {setError((cause as Error).message)}
    finally {setLoading(false)}
  }
  return <li className="comment-row">
    <div className="avatar" aria-hidden="true">{Array.from(comment.author?.replace(/^@/, '') || '?')[0]?.toUpperCase()}</div>
    <div className="comment-content">
      <div className="comment-byline"><strong>{comment.author ?? '作者未知'}</strong>
        <span title={comment.publishedAt ? '上游时间值 · ' + dateTime(comment.publishedAt) + (comment.publishedLabel ? ' · ' + comment.publishedLabel : '') : undefined}>
          {comment.publishedAt ? date(comment.publishedAt) : (comment.publishedLabel ?? '时间未知')}
        </span></div>
      <p>{comment.text}</p>
      <div className="comment-actions">
        <span><ThumbsUp size={14}/>{number(comment.likes)}</span>
        {cursor && <button className="quick-link" disabled={loading} onClick={() => void more()}><MessageCircle size={14}/>
          {loading ? '正在加载' : state ? '更多回复' : '查看回复' + (comment.replyCount === null ? '' : ' (' + comment.replyCount + ')')}
        </button>}
        {!cursor && !state && comment.replyCount !== null && comment.replyCount > 0 && <span>回复 {comment.replyCount}</span>}
      </div>
      {error && <ErrorBox message={error} retry={() => void more()}/>}
      {state && <ol className="comment-list replies" aria-label="评论回复">
        {state.rows.map(row => <CommentItem key={row.id} comment={row} base={base} order={order}/>)}
      </ol>}
    </div>
  </li>
}

function Transcripts({base, id, tracks, loading, error}: {base: string; id: string; tracks?: Track[]; loading: boolean; error?: string}) {
  const [selected, setSelected] = useState('')
  const [version, retry] = useState(0)
  const [copyState, setCopyState] = useState('')
  const track = tracks?.find(t => t.id === selected) ?? tracks?.[0]
  const result = useResource<Envelope<Transcript>>(track ? base + '/transcripts/' + track.id : null, version)
  if (loading) return <Loading>正在读取字幕目录…</Loading>
  if (error) return <ErrorBox message="视频详情请求失败，无法确认字幕目录。"/>
  if (!tracks?.length) return <Empty title="上游未提供字幕轨道">可以返回其他视频查看字幕。</Empty>
  const transcript = result.data?.data
  async function copy() {
    if (!transcript) return
    try {
      await navigator.clipboard.writeText(transcript.text)
      setCopyState('已复制')
    } catch { setCopyState('复制权限不足，可使用导出 TXT。') }
  }
  return <>
    <div className="detail-toolbar transcript-toolbar">
      <label className="inline-select">字幕语言<select aria-label="字幕语言" value={track?.id ?? ''} onChange={e => {setSelected(e.target.value); setCopyState('')}}>
        {tracks.map(t => <option key={t.id} value={t.id}>{t.label} · {t.automatic === true ? '自动' : t.automatic === false ? '非自动' : '类型未知'}</option>)}
      </select></label>
      <div className="button-group">
        <button className="button outline small" disabled={!transcript} onClick={() => void copy()}><Clipboard size={15}/>复制全文</button>
        <button className="button outline small" disabled={!transcript} onClick={() => {
          if (!transcript) return
          saveFile(transcript.cues.map(c => '[' + stamp(c.startMs) + '] ' + c.text).join('\n') + '\n', id + '-' +
            (transcript.track.language ?? 'caption').replace(/[^\w-]/g, '_') + '.txt', 'text/plain;charset=utf-8')
        }}><Download size={15}/>导出 TXT</button>
      </div>
    </div>
    {result.loading && <Loading>正在提取带时间戳的字幕…</Loading>}
    {result.error && <ErrorBox message={result.error} retry={() => retry(v => v + 1)}/>}
    {transcript && <>
      <div className="comment-meta meta-items"><Source id={transcript.source}/><CacheTime response={result.data!}/>
        <span>{number(transcript.cues.length)} 段{track?.source !== transcript.source && ' · 字幕内容来自备用源'}</span>
        {copyState && <span role="status">{copyState}</span>}
      </div>
      <ol className="transcript-list" aria-label="转录文本">
        {transcript.cues.map((cue, index) => <li key={index}><time>{stamp(cue.startMs)}</time><span>{cue.text}</span></li>)}
      </ol>
      <details className="full-transcript"><summary>完整字幕文本</summary><pre>{transcript.text}</pre></details>
    </>}
  </>
}
