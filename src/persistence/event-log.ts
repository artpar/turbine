import Database from 'better-sqlite3'
import { Event, State } from '../core/types.js'
import { EventStoreAdapter } from '../shell/interpreter.js'

// ═══════════════════════════════════════════════════════════════════════════
// SQLITE EVENT STORE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Append-only event store using SQLite.
 *
 * Events are immutable - we only INSERT, never UPDATE or DELETE.
 * State is derived by replaying events: State = events.reduce(evolve, initialState)
 */
export class SQLiteEventStore implements EventStoreAdapter {
  private db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.initSchema()
  }

  private initSchema(): void {
    this.db.exec(`
      -- Events table: append-only log
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );

      -- Index for fast sequential reads
      CREATE INDEX IF NOT EXISTS idx_events_id ON events(id);

      -- Snapshots table: periodic state snapshots for fast replay
      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at_event_index INTEGER NOT NULL,
        state TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );

      -- Index for finding latest snapshot
      CREATE INDEX IF NOT EXISTS idx_snapshots_event ON snapshots(at_event_index DESC);

      -- Metadata table
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Event Operations
  // ─────────────────────────────────────────────────────────────────────────

  async appendEvent(event: Event): Promise<number> {
    const stmt = this.db.prepare(`
      INSERT INTO events (kind, payload, timestamp)
      VALUES (?, ?, ?)
    `)

    const timestamp = 'timestamp' in event ? (event.timestamp as Date).toISOString() : new Date().toISOString()
    const payload = JSON.stringify(event)

    const result = stmt.run(event.kind, payload, timestamp)

    return result.lastInsertRowid as number
  }

  async getEvents(from?: number, to?: number): Promise<Event[]> {
    let query = 'SELECT id, payload FROM events'
    const params: number[] = []

    if (from !== undefined && to !== undefined) {
      query += ' WHERE id >= ? AND id <= ?'
      params.push(from, to)
    } else if (from !== undefined) {
      query += ' WHERE id >= ?'
      params.push(from)
    } else if (to !== undefined) {
      query += ' WHERE id <= ?'
      params.push(to)
    }

    query += ' ORDER BY id ASC'

    const stmt = this.db.prepare(query)
    const rows = stmt.all(...params) as Array<{ id: number; payload: string }>

    return rows.map((row) => {
      const event = JSON.parse(row.payload) as Event

      // Restore Date objects
      if ('timestamp' in event && typeof event.timestamp === 'string') {
        (event as any).timestamp = new Date(event.timestamp)
      }

      return event
    })
  }

  async getEventCount(): Promise<number> {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM events')
    const result = stmt.get() as { count: number }
    return result.count
  }

  async getLatestEventIndex(): Promise<number> {
    const stmt = this.db.prepare('SELECT MAX(id) as max_id FROM events')
    const result = stmt.get() as { max_id: number | null }
    return result.max_id ?? 0
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Snapshot Operations
  // ─────────────────────────────────────────────────────────────────────────

  async createSnapshot(state: State, atEventIndex: number): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO snapshots (at_event_index, state)
      VALUES (?, ?)
    `)

    // Serialize state with date handling
    const stateJson = JSON.stringify(state, (key, value) => {
      if (value instanceof Date) {
        return { __type: 'Date', value: value.toISOString() }
      }
      return value
    })

    stmt.run(atEventIndex, stateJson)
  }

  async getLatestSnapshot(): Promise<{ state: State; atEventIndex: number } | null> {
    const stmt = this.db.prepare(`
      SELECT at_event_index, state
      FROM snapshots
      ORDER BY at_event_index DESC
      LIMIT 1
    `)

    const row = stmt.get() as { at_event_index: number; state: string } | undefined

    if (!row) {
      return null
    }

    // Deserialize state with date handling
    const state = JSON.parse(row.state, (key, value) => {
      if (value && typeof value === 'object' && value.__type === 'Date') {
        return new Date(value.value)
      }
      return value
    }) as State

    return {
      state,
      atEventIndex: row.at_event_index,
    }
  }

  async getSnapshotBefore(eventIndex: number): Promise<{ state: State; atEventIndex: number } | null> {
    const stmt = this.db.prepare(`
      SELECT at_event_index, state
      FROM snapshots
      WHERE at_event_index <= ?
      ORDER BY at_event_index DESC
      LIMIT 1
    `)

    const row = stmt.get(eventIndex) as { at_event_index: number; state: string } | undefined

    if (!row) {
      return null
    }

    const state = JSON.parse(row.state, (key, value) => {
      if (value && typeof value === 'object' && value.__type === 'Date') {
        return new Date(value.value)
      }
      return value
    }) as State

    return {
      state,
      atEventIndex: row.at_event_index,
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Metadata Operations
  // ─────────────────────────────────────────────────────────────────────────

  async setMetadata(key: string, value: string): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO metadata (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
    `)
    stmt.run(key, value)
  }

  async getMetadata(key: string): Promise<string | null> {
    const stmt = this.db.prepare('SELECT value FROM metadata WHERE key = ?')
    const row = stmt.get(key) as { value: string } | undefined
    return row?.value ?? null
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  close(): void {
    this.db.close()
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SNAPSHOT POLICY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Determines when to create snapshots for performance.
 * Default: Every 100 events or when entering a new phase.
 */
export interface SnapshotPolicy {
  shouldSnapshot(eventCount: number, event: Event): boolean
}

export class DefaultSnapshotPolicy implements SnapshotPolicy {
  constructor(private interval: number = 100) {}

  shouldSnapshot(eventCount: number, event: Event): boolean {
    // Snapshot every N events
    if (eventCount % this.interval === 0) {
      return true
    }

    // Snapshot on phase transitions
    if (event.kind === 'PhaseStarted' || event.kind === 'PhaseCompleted') {
      return true
    }

    // Snapshot on convergence
    if (event.kind === 'ConvergenceReached') {
      return true
    }

    return false
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EVENT LOG READER (for debugging/replay)
// ═══════════════════════════════════════════════════════════════════════════

export class EventLogReader {
  constructor(private eventStore: SQLiteEventStore) {}

  /**
   * Stream events one at a time for memory efficiency
   */
  async *streamEvents(from?: number): AsyncGenerator<{ index: number; event: Event }> {
    const events = await this.eventStore.getEvents(from)
    let index = from ?? 1

    for (const event of events) {
      yield { index, event }
      index++
    }
  }

  /**
   * Get events by kind
   */
  async getEventsByKind(kind: Event['kind']): Promise<Event[]> {
    const all = await this.eventStore.getEvents()
    return all.filter((e) => e.kind === kind)
  }

  /**
   * Get events in time range
   */
  async getEventsInRange(from: Date, to: Date): Promise<Event[]> {
    const all = await this.eventStore.getEvents()
    return all.filter((e) => {
      if (!('timestamp' in e)) return false
      const ts = e.timestamp as Date
      return ts >= from && ts <= to
    })
  }
}
