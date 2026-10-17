import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { analyzeQuality } from '../quality';
import type { CaptureMetadata, Observation, ReviewEntry, Session, SessionSummary } from '../types';
import { ApiError, validateId, validateVideo } from './validation';

type Row = { id: string; payload: string; file_key: string; payload_hash: string };
type StoreOptions = { beforeInsert?: () => void };
export interface QueueStats { total: number; pendingReview: number; withFlags: number }

/** Private local storage. Generated file keys are never derived from user paths. */
export class SessionStore {
  private db: DatabaseSync;
  private videoDir: string;
  constructor(readonly dataDir: string, private options: StoreOptions = {}) {
    this.videoDir = path.join(/* turbopackIgnore: true */ dataDir, 'videos');
    mkdirSync(this.videoDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, 'motiontrial.sqlite'));
    try {
      this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, payload TEXT NOT NULL, file_key TEXT NOT NULL UNIQUE, payload_hash TEXT NOT NULL)');
      // A crash after staging a deletion but before the DB delete committed must
      // not hide a still-saved recording on the next local application start.
      const rows = this.db.prepare('SELECT file_key FROM sessions').all() as Pick<Row, 'file_key'>[];
      for (const row of rows) {
        const original = this.filePath(row);
        const tombstone = `${original}.deleting`;
        if (!existsSync(original) && existsSync(tombstone)) renameSync(tombstone, original);
      }
    } catch (error) { this.db.close(); throw error; }
  }
  close() { this.db.close(); }
  private row(id: string): Row | undefined { return this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Row | undefined; }
  private filePath(row: Pick<Row, 'file_key'>): string { return path.join(/* turbopackIgnore: true */ this.videoDir, row.file_key); }
  private decode(row: Row): Session {
    const session = JSON.parse(row.payload) as Session;
    const file = this.filePath(row);
    if (!existsSync(file) || statSync(file).size !== session.videoSize) throw new ApiError(500, 'The saved video is unavailable. Check the local data directory; the session cannot be reported as saved.');
    return session;
  }
  list(): SessionSummary[] {
    const rows = this.db.prepare('SELECT * FROM sessions ORDER BY rowid DESC LIMIT 200').all() as Row[];
    return rows.map(row => { const { observations: _observations, ...summary } = this.decode(row); return summary; });
  }
  stats(): QueueStats {
    const row = this.db.prepare(`SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN json_array_length(payload, '$.reviews') = 0 THEN 1 ELSE 0 END), 0) AS pendingReview,
      COALESCE(SUM(CASE WHEN json_array_length(payload, '$.analysis.events') > 0 THEN 1 ELSE 0 END), 0) AS withFlags
      FROM sessions`).get() as { total: number; pendingReview: number; withFlags: number };
    return { total: Number(row.total), pendingReview: Number(row.pendingReview), withFlags: Number(row.withFlags) };
  }
  get(id: string): Session {
    validateId(id);
    const row = this.row(id);
    if (!row) throw new ApiError(404, 'Session not found.');
    return this.decode(row);
  }
  save(metadata: CaptureMetadata, observations: Observation[], bytes: Buffer, providedMime: string): { session: Session; duplicate: boolean } {
    const mimeType = validateVideo(bytes, providedMime);
    const payloadHash = createHash('sha256').update(JSON.stringify({ metadata, observations, mimeType })).update(bytes).digest('hex');
    const existing = this.row(metadata.id);
    if (existing) {
      if (existing.payload_hash !== payloadHash) throw new ApiError(409, 'This session ID already belongs to a different upload. Retry the original recording or begin a new assessment.');
      return { session: this.decode(existing), duplicate: true };
    }
    if (metadata.parentSessionId && !this.row(metadata.parentSessionId)) throw new ApiError(400, 'The original recapture session does not exist.');
    const session: Session = {
      ...metadata, mimeType, videoSize: bytes.length, createdAt: new Date().toISOString(), observations,
      analysis: analyzeQuality(observations, metadata.durationMs, metadata.interrupted), reviews: [],
    };
    const fileKey = `${randomUUID()}.${mimeType === 'video/webm' ? 'webm' : 'mp4'}`;
    const finalPath = path.join(/* turbopackIgnore: true */ this.videoDir, fileKey);
    const stagePath = `${finalPath}.pending`;
    let fd: number | undefined;
    try {
      fd = openSync(stagePath, 'wx', 0o600);
      writeFileSync(fd, bytes); fsyncSync(fd); closeSync(fd); fd = undefined;
      renameSync(stagePath, finalPath);
      this.options.beforeInsert?.();
      this.db.prepare('INSERT INTO sessions (id, payload, file_key, payload_hash) VALUES (?, ?, ?, ?)').run(metadata.id, JSON.stringify(session), fileKey, payloadHash);
    } catch (error) {
      if (fd !== undefined) closeSync(fd);
      for (const filename of [stagePath, finalPath]) if (existsSync(/* turbopackIgnore: true */ filename)) unlinkSync(filename);
      throw error;
    }
    return { session, duplicate: false };
  }
  review(id: string, value: { disposition: ReviewEntry['disposition']; note: string; reviewer?: string }): Session {
    const session = this.get(id);
    const entry: ReviewEntry = { disposition: value.disposition, note: value.note, reviewer: value.reviewer ?? 'Demo researcher', createdAt: new Date().toISOString() };
    session.reviews.push(entry);
    this.db.prepare('UPDATE sessions SET payload = ? WHERE id = ?').run(JSON.stringify(session), id);
    return session;
  }
  video(id: string): { path: string; size: number; mimeType: string; etag: string } {
    const session = this.get(id);
    const row = this.row(id)!;
    return { path: this.filePath(row), size: session.videoSize, mimeType: session.mimeType, etag: `"${row.file_key}-${session.videoSize}"` };
  }
  delete(id: string): void {
    this.get(id);
    const row = this.row(id)!;
    const original = this.filePath(row);
    const tombstone = `${original}.deleting`;
    // Keep a recoverable file until the database delete has committed.
    renameSync(original, tombstone);
    try {
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
      unlinkSync(tombstone);
    } catch (error) {
      if (existsSync(tombstone)) {
        this.db.prepare('INSERT OR IGNORE INTO sessions (id, payload, file_key, payload_hash) VALUES (?, ?, ?, ?)').run(row.id, row.payload, row.file_key, row.payload_hash);
        renameSync(tombstone, original);
      }
      throw error;
    }
  }
}

const stores = new Map<string, SessionStore>();
export function getStore(): SessionStore {
  const dir = path.resolve(/* turbopackIgnore: true */ process.env.MOTIONTRIAL_DATA_DIR || path.join(process.cwd(), 'data'));
  let store = stores.get(dir);
  if (!store) { store = new SessionStore(dir); stores.set(dir, store); }
  return store;
}
