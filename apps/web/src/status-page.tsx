import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { SourceStatus } from '@atlas/shared'
import { dateTime, number, percent, sourceLabel, useResource } from './lib.ts'
import { Empty, ErrorBox, Heading, Loading, Source } from './ui.tsx'

const labels = {available:'最近请求成功', cooldown:'冷却中', error:'最近请求失败', untested:'尚未请求'}
export function StatusPage() {
  const [version, refresh] = useState(0)
  const result = useResource<SourceStatus>('/status', version)
  const data = result.data
  return <>
    <div className="split-heading">
      <Heading title="数据源状态">查看工作台当前进程的公开 API 调用与缓存记录。</Heading>
      <button className="button secondary" onClick={() => refresh(v => v + 1)} disabled={result.loading}><RefreshCw size={16}/>刷新</button>
    </div>
    {result.loading && <Loading>正在读取状态…</Loading>}
    {result.error && <ErrorBox message={result.error} retry={() => refresh(v => v + 1)}/>}
    {data && <>
      <section className="panel providers">
        <h2>已配置来源</h2>
        {data.providers.map((p, i) => <div className="provider-row" key={p.id}>
          <div><Source id={p.id}/> <span className="muted">{i ? '备用' : '主用'}</span>
            <p>{new URL(p.base).host}</p></div>
          <div><strong className={'provider-state ' + p.state}>{labels[p.state]}</strong><p>最近更新 {dateTime(p.checkedAt)}</p></div>
          <div><span>{p.successes} 成功 · {p.failures} 失败</span>
            <p>{p.cooldownUntil && p.state === 'cooldown' ? '冷却至 ' + dateTime(p.cooldownUntil) : p.lastError ?? '无已记录错误'}</p></div>
        </div>)}
      </section>
      <div className="panel analysis-stats source-stats">
        <div className="analysis-metric"><span>请求成功率</span><strong>{percent(data.requests ? data.successes / data.requests : null)}</strong></div>
        <div className="analysis-metric"><span>P50 / P95 延迟</span><strong>{number(data.p50Ms)} / {number(data.p95Ms)} <small>ms</small></strong></div>
        <div className="analysis-metric"><span>缓存命中率</span><strong>{percent(data.cacheHits + data.cacheMisses ? data.cacheHits / (data.cacheHits + data.cacheMisses) : null)}</strong></div>
        <div className="analysis-metric"><span>回退尝试</span><strong>{number(data.fallbacks)}</strong></div>
      </div>
      <section className="panel request-log">
        <h2>最近请求</h2>
        {!data.recent.length ? <Empty title="尚无请求记录">运行一次搜索后可查看上游响应。</Empty> :
          <div className="table-scroll"><table className="status-table">
            <thead><tr><th>来源</th><th>操作</th><th>时间</th><th>状态</th><th>延迟</th><th>错误</th></tr></thead>
            <tbody>{data.recent.map((log,i) => <tr key={i}><td>{sourceLabel(log.source)}</td>
              <td>{log.operation}</td><td>{dateTime(log.collectedAt)}</td><td>{log.http ?? '—'} · {log.status}</td>
              <td>{number(log.elapsedMs)} ms</td><td>{log.error ?? '—'}</td></tr>)}</tbody>
          </table></div>}
      </section>
    </>}
  </>
}
