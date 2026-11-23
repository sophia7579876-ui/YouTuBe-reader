import { Parser } from 'htmlparser2'
import { SaxesParser } from 'saxes'
import type { Cue } from '@atlas/shared'

export function plain(input: string) {
  let result = ''
  const parser = new Parser({
    ontext(text) { result += text },
    onopentag(name) { if (name === 'br') result += '\n' },
  }, { decodeEntities: true })
  parser.end(input)
  return result.trim()
}

export function timestamp(value: string, rate = 30): number | null {
  const clock = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d+)|:(\d+))?$/.exec(value)
  if (clock) {
    const fractional = clock[4] ? Number('0.' + clock[4]) : clock[5] ? Number(clock[5]) / rate : 0
    return Math.round((Number(clock[1] ?? 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3]) + fractional) * 1000)
  }
  const offset = /^(\d+(?:\.\d+)?)(ms|h|m|s|f)$/.exec(value)
  if (!offset) return null
  return Math.round(Number(offset[1]) * ({ms: 1, h: 3_600_000, m: 60_000, s: 1000, f: 1000 / rate}[offset[2]]!))
}

export function parseCaptions(content: string): Cue[] {
  const body = content.replace(/^\uFEFF/, '').trim()
  if (!body) return []
  if (body.startsWith('WEBVTT')) {
    return body.split(/\r?\n\s*\r?\n/).flatMap(block => {
      if (/^(NOTE|STYLE|REGION)(\s|$)/.test(block)) return []
      const lines = block.split(/\r?\n/)
      const i = lines.findIndex(line => /^\S+\s+-->\s+\S+/.test(line))
      if (i < 0) return []
      const [start, , end] = lines[i].trim().split(/\s+/)
      const startMs = timestamp(start), endMs = timestamp(end)
      // Inline WebVTT karaoke timestamps are timing markup, separate from cue text.
      const text = plain(lines.slice(i + 1).join('\n').replace(/<(?:\d{2,}:)?\d{2}:\d{2}\.\d{3}>/g, ''))
      return startMs === null || !text ? [] : [{startMs, endMs, text}]
    })
  }
  if (!/^<\?xml|^<(\w+:)?tt(?:\s|>)/.test(body) || /<!DOCTYPE/i.test(body)) return []
  const cues: Cue[] = []
  let cue: Cue | null = null
  let rate = 30
  const xml = new SaxesParser()
  xml.on('opentag', tag => {
    const name = tag.name.split(':').at(-1)
    if (name === 'tt') {
      const fps = Number(tag.attributes['ttp:frameRate'] ?? 30)
      if (fps > 0) rate = fps
    }
    if (name === 'p') {
      const startMs = timestamp(tag.attributes.begin ?? '', rate)
      const duration = timestamp(tag.attributes.dur ?? '', rate)
      const end = timestamp(tag.attributes.end ?? '', rate)
      cue = startMs === null ? null : {startMs, endMs: end ?? (duration === null ? null : startMs + duration), text: ''}
    }
    if (name === 'br' && cue) cue.text += '\n'
  })
  xml.on('text', text => { if (cue) cue.text += text })
  xml.on('cdata', text => { if (cue) cue.text += text })
  xml.on('closetag', tag => {
    if (tag.name.split(':').at(-1) !== 'p' || !cue) return
    cue.text = cue.text.trim()
    if (cue.text) cues.push(cue)
    cue = null
  })
  try { xml.write(body).close() } catch { return [] }
  return cues
}
