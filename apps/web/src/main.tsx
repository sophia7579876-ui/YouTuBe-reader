import { lazy, Suspense, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BarChart3, ListFilter, Search, Server } from 'lucide-react'
import { SearchPage } from './search-page.tsx'
import { useSearch } from './search-state.ts'
import { Loading } from './ui.tsx'
import { sourceLabel } from './lib.ts'
import './styles.css'

const AnalysisPage = lazy(() => import('./analysis-page.tsx').then(m => ({default:m.AnalysisPage})))
const DetailPage = lazy(() => import('./detail-page.tsx').then(m => ({default:m.DetailPage})))
const StatusPage = lazy(() => import('./status-page.tsx').then(m => ({default:m.StatusPage})))
const nav = [
  { href:'/search', title:'视频搜索', icon:Search },
  { href:'/analysis', title:'数据分析', icon:BarChart3 },
  { href:'/status', title:'数据源状态', icon:Server },
] as const

function App() {
  const [hash, setHash] = useState(window.location.hash || '#/search')
  const s = useSearch()
  useEffect(() => {
    const change = () => { setHash(window.location.hash || '#/search'); window.scrollTo(0,0) }
    window.addEventListener('hashchange', change)
    return () => window.removeEventListener('hashchange', change)
  }, [])
  const [path,args] = hash.slice(1).split('?')
  const videoId = /^\/video\/([\w-]{11})$/.exec(path)?.[1]
  const section = path === '/analysis' ? '数据分析' : path === '/status' ? '数据源状态' : videoId ? '视频详情' : '视频搜索'
  const sources = s.response?.data.sources ?? []
  return <div className="app-shell">
    <a href="#workspace" className="skip-link" onClick={e => {e.preventDefault(); document.getElementById('workspace')?.focus()}}>跳到内容</a>
    <aside className="sidebar">
      <a className="brand" href="#/search">
        <div className="brand-icon"><ListFilter size={26} strokeWidth={2.7}/></div>
        <div><strong>Video Atlas</strong><span>视频图谱</span></div>
      </a>
      <nav aria-label="工作台">{nav.map(({href,title,icon:Icon}) => {
        const active = title === section || title === '视频搜索' && !!videoId
        return <a key={href} href={'#' + href} aria-current={active ? 'page' : undefined}>
          <Icon size={20} strokeWidth={1.9}/><span>{title}</span>
        </a>
      })}</nav>
      <a className="sidebar-status" href="#/status">
        <span><i className={sources.length ? 'dot live' : 'dot'}/>YouTube 数据访问</span>
        <small>{sources.length ? sources.map(sourceLabel).join(' / ') : 'Invidious 主用 · Piped 备用'}</small>
      </a>
    </aside>
    <main id="workspace" tabIndex={-1} className="workspace">
      <div className="breadcrumb"><span>研究工作台</span><span>/</span><strong>{section}</strong></div>
      <Suspense fallback={<Loading>正在打开 {section}…</Loading>}>
        {videoId ? <DetailPage key={videoId + (args ?? '')} id={videoId} preferred={new URLSearchParams(args).get('source') ?? undefined}/>
          : path === '/analysis' ? <AnalysisPage s={s}/>
          : path === '/status' ? <StatusPage/>
          : <SearchPage s={s}/>}
      </Suspense>
    </main>
  </div>
}
createRoot(document.getElementById('root')!).render(<App/>)
