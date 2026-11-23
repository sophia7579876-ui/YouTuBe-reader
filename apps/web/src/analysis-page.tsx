import { useMemo } from 'react'
import { ArrowUpRight, BarChart3, Eye, Hash, TrendingUp } from 'lucide-react'
import { analyzeVideos, videoMetrics } from '@atlas/shared/analysis'
import type { Video } from '@atlas/shared'
import { detailLink, number, percent } from './lib.ts'
import { CacheTime, Empty, Heading } from './ui.tsx'
import type { SearchState } from './search-state.ts'

export function AnalysisPage({s}: {s: SearchState}) {
  const now = s.response ? Date.parse(s.response.fetchedAt) : 0
  const result = useMemo(() => analyzeVideos(s.videos, now), [s.videos, now])
  return <>
    <Heading title="数据分析">按当前筛选后的样本查看分布、播放速度和评论互动。</Heading>
    {!s.response ? <section className="panel results-panel"><Empty title="先获取搜索结果">
      <a href="#/search" className="button primary small">前往视频搜索</a>
    </Empty></section> : <>
      <div className="analysis-context meta-items"><strong>{s.response.data.options.query}</strong><CacheTime response={s.response}/>
        <span>{result.knownViews} / {result.total} 条有播放量</span>
        <a href="#/search">返回筛选 <ArrowUpRight size={15}/></a>
      </div>
      <div className="panel analysis-stats">
        <Metric label="样本视频" value={number(result.total)} icon={<Hash size={17}/>}/>
        <Metric label="播放量中位数" value={number(result.median)} icon={<BarChart3 size={17}/>}/>
        <Metric label="平均播放量" value={number(result.average)} icon={<Eye size={17}/>}/>
        <Metric label="最高播放量" value={number(result.max)} icon={<TrendingUp size={17}/>}/>
      </div>
      <div className="analysis-grid">
        <Chart title="发布时间分布" rows={result.date}/>
        <Chart title="评论数分布" rows={result.comments}/>
      </div>
      <div className="analysis-grid rankings">
        <Rank title="播放量 Top 20" rows={result.mostViewed} asOf={now} keyType="views"/>
        <Rank title="评论互动率 Top 20" rows={result.mostEngaged.map(row => row.video)} asOf={now} keyType="engagement"/>
      </div>
      <section className="panel recent">
        <h2>发布不足 24 小时 <span>{result.recent.length} 条</span></h2>
        {result.recent.length ? <ul>{result.recent.map(({video}) =>
          <li key={video.id}><a href={detailLink(video)}>{video.title}</a><span>{number(video.views)} 次播放</span></li>)}</ul>
          : <p>当前样本没有可识别的 24 小时内视频。</p>}
      </section>
      <p className="analysis-note">播放速度按采集时已发布的天数计算，发布不足 24 小时的视频单独列出。评论互动率为评论数 ÷ 播放量。两项均为筛选指标，无法衡量真实参与率或视频质量。上游日期可能经过推算。</p>
    </>}
  </>
}

function Metric({label, value, icon}: {label: string; value: string; icon: React.ReactNode}) {
  return <div className="analysis-metric"><span>{icon}{label}</span><strong>{value}</strong></div>
}
function Chart({title, rows}: {title: string; rows: {label: string; value: number}[]}) {
  const bound = Math.max(1, ...rows.map(r => r.value))
  return <section className="panel chart" aria-label={title}>
    <h2>{title}</h2>
    <div className="chart-rows">{rows.map(r => <div className="chart-row" key={r.label}>
      <span>{r.label}</span><div className="bar-track"><div className={r.label === '未知' ? 'unknown-bar' : ''} style={{width: 100 * r.value / bound + '%'}}/></div>
      <strong>{r.value}</strong>
    </div>)}</div>
  </section>
}
function Rank({title, rows, keyType, asOf}: {title: string; rows: Video[]; keyType: 'views'|'engagement'; asOf: number}) {
  return <section className="panel rank">
    <h2>{title}</h2>
    {rows.length ? <ol>{rows.map(v => {
      const metrics = videoMetrics(v, asOf)
      return <li key={v.id}><a href={detailLink(v)}>{v.title}<small>{v.channel.name ?? '频道未知'}</small></a>
        <span><strong>{keyType === 'views' ? number(v.views) : percent(metrics.engagement, 4)}</strong>
          <small>{keyType === 'views' ? metrics.recent ? '<24h' : number(metrics.velocity) + ' / 天' : number(v.comments) + ' 条评论'}</small></span>
      </li>
    })}</ol> : <Empty title="当前样本缺少可排行的数据">补齐视频统计后可更新此榜单。</Empty>}
  </section>
}
