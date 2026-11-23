import { useState, type ReactNode } from 'react'
import { AlertTriangle, ImageOff, LoaderCircle } from 'lucide-react'
import type { Envelope, Video } from '@atlas/shared'
import { dateTime, duration, sourceLabel } from './lib.ts'

export function Source({id}: {id: string}) {
  return <span className={'source-tag ' + (id === 'piped' ? 'source-piped' : '')}><i />{sourceLabel(id)}</span>
}
export function Thumbnail({video, large = false}: {video: Video; large?: boolean}) {
  const [image, setImage] = useState<'pending' | 'ready' | 'failed'>('pending')
  return <div className={'thumb ' + (large ? 'thumb-large' : '')} aria-hidden="true">
    <ImageOff size={19} />
    {image !== 'failed' && <img src={video.thumbnail} alt="" loading={large ? 'eager' : 'lazy'}
      data-ready={image === 'ready' ? 'true' : undefined} onLoad={() => setImage('ready')} onError={() => setImage('failed')} />}
    {video.durationSeconds !== null && <span>{duration(video.durationSeconds)}</span>}
  </div>
}
export function CacheTime({response}: {response: Envelope<unknown>}) {
  return <span className="cache-time" title={'缓存有效至 ' + dateTime(response.expiresAt)}>
    {response.cached ? '缓存' : '已采集'} · {dateTime(response.fetchedAt)}
  </span>
}
export function Loading({children}: {children: ReactNode}) {
  return <div className="notice loading" role="status"><LoaderCircle size={17} className="spin" /><span>{children}</span></div>
}
export function ErrorBox({message, retry}: {message: string; retry?: () => void}) {
  return <div className="notice error" role="alert"><AlertTriangle size={17} /><span>{message}</span>
    {retry && <button className="button secondary small" onClick={retry}>重试</button>}</div>
}
export function Empty({title, children}: {title: string; children?: ReactNode}) {
  return <div className="empty"><strong>{title}</strong>{children && <div>{children}</div>}</div>
}
export function Heading({title, children}: {title: string; children?: ReactNode}) {
  return <header className="page-heading"><h1>{title}</h1>{children && <p>{children}</p>}</header>
}
