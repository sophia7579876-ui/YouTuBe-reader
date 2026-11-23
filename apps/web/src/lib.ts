import { useEffect, useState } from 'react'
import type { Video } from '@atlas/shared'

const numberFormat = new Intl.NumberFormat('zh-CN', {maximumFractionDigits: 1})
export const number = (value: number | null) => value === null ? '—' : numberFormat.format(value)
export const percent = (value: number | null, precision = 2) => value === null ? '—' : new Intl.NumberFormat('zh-CN', {style:'percent', maximumFractionDigits: precision}).format(value)
export const date = (value: string | null) => value ? new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC',
}).format(new Date(value)).replaceAll('/', '-') : '—'
export const dateTime = (value: string | null) => value ? new Intl.DateTimeFormat('zh-CN', {
  year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit',
}).format(new Date(value)) : '—'
export function duration(seconds: number | null) {
  if (seconds === null) return '—'
  const parts = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, Math.floor(seconds) % 60]
  return (parts[0] ? parts : parts.slice(1)).map((x, i) => i ? String(x).padStart(2, '0') : String(x)).join(':')
}
export const stamp = (ms: number) => {
  const seconds = Math.floor(ms / 1000)
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(x => String(x).padStart(2, '0')).join(':') + '.' + String(Math.floor(ms % 1000)).padStart(3, '0')
}
export const sourceLabel = (id: string) => ({invidious:'Invidious', piped:'Piped'}[id] ?? id)
export const detailLink = (v: Video) => '#/video/' + v.id + '?source=' + encodeURIComponent(v.source)

export async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api' + path, {signal})
  const json = await response.json().catch(() => null)
  if (!response.ok) {
    const reasons = Array.isArray(json?.reasons) ? json.reasons.filter(Boolean) : []
    throw new Error([json?.message ?? '请求失败（HTTP ' + response.status + '）', ...reasons].join(' '))
  }
  return json as T
}

export function useResource<T>(url: string | null, version = 0) {
  const [result, setResult] = useState<{url: string; version: number; data?: T; error?: string}>()
  useEffect(() => {
    if (!url) return
    const abort = new AbortController()
    request<T>(url, abort.signal).then(data => {
      if (!abort.signal.aborted) setResult({url, version, data})
    }).catch(error => {
      if (!abort.signal.aborted) setResult({url, version, error: error.message})
    })
    return () => abort.abort()
  }, [url, version])
  const same = url === result?.url && version === result?.version
  return {data:same ? result?.data : undefined, error:same ? result?.error : undefined, loading: !!url && !same}
}
