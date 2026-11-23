import { useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpRight, BarChart3, ChevronLeft, ChevronRight, Download, Search, Table2 } from 'lucide-react'
import type { Video, VideoSort } from '@atlas/shared'
import { date, dateTime, detailLink, number, sourceLabel } from './lib.ts'
import { exportCsv, saveFile } from './export.ts'
import { CacheTime, Empty, ErrorBox, Heading, Loading, Source, Thumbnail } from './ui.tsx'
import type { SearchState } from './search-state.ts'

const suggestions = ['AI Agent', 'Claude Code', 'OpenAI Codex', 'AI automation']
const sortNames: Record<VideoSort, string> = {views:'播放量', publishedAt:'发布日期', comments:'评论数', likes:'点赞数'}
const types = {all:'全部', video:'普通视频', short:'Shorts'} as const
const pageSize = 15

export function SearchPage({s}: {s: SearchState}) {
  const [page, setPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(s.videos.length / pageSize))
  const current = Math.min(page, totalPages)
  const visible = s.videos.slice((current - 1) * pageSize, current * pageSize)
  const active = s.response?.data.options
  const pending = !!s.progress && s.progress.done < s.progress.total
  function runSearch(value?: string) {
    setPage(1)
    void s.search(value)
  }
  function sortBy(key: VideoSort, toggle = false) {
    setPage(1)
    s.setOrder({key, descending: toggle && s.order.key === key ? !s.order.descending : true})
  }
  function download(format: 'json' | 'csv') {
    const filename = 'video-atlas-' + (active?.query ?? 'videos').replace(/[\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 55)
    if (format === 'csv') saveFile(exportCsv(s.videos), filename + '.csv', 'text/csv;charset=utf-8')
    else saveFile(JSON.stringify({
      query: active?.query, exportedAt: new Date().toISOString(),
      filters: {kind:active?.kind, ageDays:s.age, minimumViews:s.minimum},
      sort:s.order, videos:s.videos,
    }, null, 2), filename + '.json', 'application/json;charset=utf-8')
  }
  const columns = [
    ['publishedAt','发布日期'], ['views','播放量'], ['likes','点赞'], ['comments','评论'],
  ] as const
  return <>
    <Heading title="视频搜索">搜索、筛选并比较 YouTube 公开视频。</Heading>
    <form className="panel search-panel" onSubmit={e => { e.preventDefault(); runSearch() }}>
      <div className="search-row">
        <label className="input-icon search-input">
          <Search size={21} aria-hidden="true" />
          <input aria-label="搜索关键词" value={s.query} onChange={e => s.setQuery(e.target.value)}
            placeholder="输入关键词，例如 AI Agent" maxLength={100} required />
        </label>
        <button className="button primary search-button" type="submit" disabled={s.searching}>搜索</button>
      </div>
      <div className="filters">
        <label>结果数量<select aria-label="结果数量" value={s.limit} onChange={e => s.setLimit(Number(e.target.value) as typeof s.limit)}>
          {[20,50,100].map(n => <option key={n} value={n}>{n} 条</option>)}
        </select></label>
        <label>发布时间<select aria-label="发布时间" value={s.age} onChange={e => {s.setAge(Number(e.target.value)); setPage(1)}}>
          <option value={0}>不限时间</option>
          {[7,30,90].map(n => <option key={n} value={n}>最近 {n} 天</option>)}
        </select></label>
        <label>视频类型<select aria-label="视频类型" value={s.kind} onChange={e => s.setKind(e.target.value as typeof s.kind)}>
          {Object.entries(types).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
        </select></label>
        <label>最低播放量<input aria-label="最低播放量" type="number" min="0" step="1" placeholder="不限"
          value={s.minimum || ''} onChange={e => {s.setMinimum(Number(e.target.value) || 0); setPage(1)}} /></label>
      </div>
      <div className="search-footer">
        <div className="quick-search"><span>试试</span>{suggestions.map(q =>
          <button className="quick-link" disabled={s.searching} type="button" key={q} onClick={() => runSearch(q)}>{q}</button>
        )}</div>
        <button className="button secondary small" type="button" onClick={() => {
          s.setLimit(20); s.setKind('all'); s.setAge(0); s.setMinimum(0); setPage(1)
        }}>重置筛选</button>
      </div>
    </form>
    <section className="panel results-panel" aria-labelledby="search-results">
      <div className="results-header">
        <div>
          <h2 id="search-results">搜索结果</h2>
          {active
            ? <p><strong>{s.videos.length}</strong> / {s.response!.data.videos.length} 条 · {active.query}
              {active.kind !== 'all' && ' · ' + types[active.kind]} <span className="spacer">·</span> 仅对已获取结果排序</p>
            : <p>仅对已获取结果排序</p>}
        </div>
        <div className="button-group">
          <label className="inline-select">排序<select aria-label="排序" value={s.order.key} onChange={e => sortBy(e.target.value as VideoSort)}>
            {Object.entries(sortNames).map(([key,label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
          <button className="button outline small" disabled={!s.videos.length} onClick={() => download('json')}><Download size={15} />JSON</button>
          <button className="button outline small" disabled={!s.videos.length} onClick={() => download('csv')}><Download size={15} />CSV</button>
        </div>
      </div>
      {s.searching && <Loading>正在收集公开搜索结果，分页请求会依次发送。</Loading>}
      {s.error && <ErrorBox message={s.error} retry={() => runSearch()} />}
      {!s.searching && !s.error && !s.response && <Empty title="开始搜索">
        <Table2 size={23} /><span>输入关键词后，即可查看视频数据和来源。</span>
      </Empty>}
      {s.response && <>
        <div className="result-meta">
          <div className="meta-items">
            <CacheTime response={s.response} />
            <span title={s.response.data.pages.map(p => sourceLabel(p.source) + ' 第 ' + p.page + ' 页 ' + p.returned + ' 条').join('\n')}>
              已请求 {s.response.data.pages.length} 页 · 去重前 {number(s.response.data.rawCount)} 条
            </span>
          </div>
          <div className="button-group">
            {pending && <button className="button subtle small" type="button" onClick={s.cancelEnrich}>停止补齐</button>}
            <button className="button secondary small" disabled={!s.canEnrich || pending} onClick={() => void s.enrich()}>
              {pending ? '补齐中 ' + s.progress!.done + '/' + s.progress!.total : '补齐点赞和评论数'}
            </button>
            {!!s.videos.length && <a href="#/analysis" className="button outline small"><BarChart3 size={15} />分析</a>}
          </div>
        </div>
        {s.response.data.warnings.length > 0 && <div className="notice warning" role="status">{s.response.data.warnings.join(' ')}</div>}
        {s.progress && s.progress.done === s.progress.total && s.progress.missing > 0 && <div className="notice warning">
          有 {s.progress.missing} 条视频的统计仍缺失。
        </div>}
        {!visible.length ? <Empty title="没有匹配的视频">可以调整关键词或筛选条件。</Empty> : <>
          <div className="table-scroll">
            <table className="videos-table">
              <thead><tr><th scope="col">视频</th>{columns.map(([key,label]) => <th scope="col" key={key}
                aria-sort={s.order.key === key ? (s.order.descending ? 'descending' : 'ascending') : 'none'}>
                <button onClick={() => sortBy(key,true)}>{label}
                  {s.order.key === key && (s.order.descending ? <ArrowDown size={13}/> : <ArrowUp size={13}/>)}
                </button></th>)}<th scope="col">来源</th></tr></thead>
              <tbody>{visible.map(v => <VideoRow key={v.id} video={v} />)}</tbody>
            </table>
          </div>
          <div className="pagination">
            <span>{(current - 1) * pageSize + 1}–{Math.min(current * pageSize, s.videos.length)} / {s.videos.length} 条</span>
            <div className="button-group">
              <button aria-label="上一页" className="button secondary small icon" onClick={() => setPage(current - 1)} disabled={current <= 1}><ChevronLeft size={16}/></button>
              <span>{current} / {totalPages}</span>
              <button aria-label="下一页" className="button secondary small icon" onClick={() => setPage(current + 1)} disabled={current >= totalPages}><ChevronRight size={16}/></button>
            </div>
          </div>
        </>}
      </>}
    </section>
  </>
}

function VideoRow({video: v}: {video: Video}) {
  return <tr>
    <td><div className="video-cell"><a href={detailLink(v)} tabIndex={-1} aria-hidden="true"><Thumbnail video={v}/></a>
      <div className="video-title"><a href={detailLink(v)}>{v.title}</a>
        <div className="video-channel">
          <span>{v.channel.name ?? '频道未知'}</span>
          {v.kind === 'short' && <span className="video-kind">Shorts</span>}
          <a href={v.url} target="_blank" rel="noopener noreferrer" aria-label={'打开 YouTube 视频原页：' + v.title}><ArrowUpRight size={14}/></a>
        </div>
      </div></div></td>
    <td className="nowrap" title={v.publishedPrecision === 'estimated' ? '按上游时间推算' : undefined}>{date(v.publishedAt)}</td>
    {(['views','likes','comments'] as const).map(key => <td key={key} className="metric"
      title={v.metricSources[key] ? sourceLabel(v.metricSources[key]!.source) + ' · ' + dateTime(v.metricSources[key]!.collectedAt) : '上游未提供'}>
      {number(v[key])}</td>)}
    <td><Source id={v.source}/></td>
  </tr>
}
