import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { CommentOrder, Envelope } from '@atlas/shared'
import type { Telemetry } from './transport.ts'

export interface Cursor {
  source: string
  videoId: string
  order: CommentOrder
  parent?: string
  upstream: string
}
const keyOf = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

export class Cache {
  private readonly db: DatabaseSync
  private readonly pending = new Map<string, Promise<Envelope<unknown>>>()
  private writes = 0
  constructor(path: string, private readonly telemetry: Telemetry) {
    if (path !== ':memory:') mkdirSync(dirname(path), {recursive: true})
    this.db = new DatabaseSync(path)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 3000;
      CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, fetched INTEGER NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS cursors (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER NOT NULL);
    `)
  }
  close() { this.db.close() }
  async get<T>(identity: unknown, ttl: number | ((data: T) => number), load: () => Promise<T>): Promise<Envelope<T>> {
    const key = keyOf(['atlas-v1', identity])
    const hit = this.db.prepare('SELECT value, fetched, expires FROM cache WHERE key = ? AND expires > ?').get(key, Date.now())
    if (hit) {
      this.telemetry.counters.cacheHits++
      return {data: JSON.parse(String(hit.value)), cached: true,
        fetchedAt: new Date(Number(hit.fetched)).toISOString(), expiresAt: new Date(Number(hit.expires)).toISOString()}
    }
    const waiting = this.pending.get(key)
    if (waiting) {
      this.telemetry.counters.coalesced++
      return waiting as Promise<Envelope<T>>
    }
    this.telemetry.counters.cacheMisses++
    const work = (async () => {
      const data = await load()
      const fetched = Date.now()
      const expires = fetched + (typeof ttl === 'function' ? ttl(data) : ttl)
      this.db.prepare('INSERT OR REPLACE INTO cache VALUES (?, ?, ?, ?)').run(key, JSON.stringify(data), fetched, expires)
      if (++this.writes % 100 === 0) {
        this.db.prepare('DELETE FROM cache WHERE expires <= ?').run(fetched)
        this.db.prepare('DELETE FROM cursors WHERE expires <= ?').run(fetched)
      }
      return {data, cached: false, fetchedAt: new Date(fetched).toISOString(), expiresAt: new Date(expires).toISOString()}
    })()
    this.pending.set(key, work)
    try { return await work } finally { this.pending.delete(key) }
  }
  issue(cursor: Cursor) {
    // A stable opaque key crosses the browser boundary; upstream continuations stay in SQLite.
    const key = keyOf(cursor)
    this.db.prepare('INSERT OR REPLACE INTO cursors VALUES (?, ?, ?)').run(key, JSON.stringify(cursor), Date.now() + 2 * 3600_000)
    return key
  }
  cursor(token: string) {
    const row = this.db.prepare('SELECT value FROM cursors WHERE key = ? AND expires > ?').get(token, Date.now())
    return row ? JSON.parse(String(row.value)) as Cursor : null
  }
}
