import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { DIRS, ensureStorageDirectories, getDefaultSettings } from './config.ts';
import type {
  AppSettings,
  ClipRecord,
  ClipStatus,
  JobConfig,
  JobRecord,
  JobStatus,
  VideoRecord,
} from './types.ts';

ensureStorageDirectories();

const dbPath = path.join(DIRS.root, 'studio.db');
const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY,
    original_filename TEXT NOT NULL,
    safe_filename TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    duration REAL NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    fps REAL NOT NULL,
    video_codec TEXT NOT NULL,
    audio_codec TEXT,
    bitrate INTEGER NOT NULL,
    has_audio INTEGER NOT NULL,
    audio_streams INTEGER NOT NULL,
    format_name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    video_id TEXT NOT NULL,
    status TEXT NOT NULL,
    progress_pct REAL NOT NULL DEFAULT 0,
    stage_message TEXT NOT NULL DEFAULT '',
    config_json TEXT NOT NULL,
    transcript_path TEXT,
    scenes_json TEXT NOT NULL DEFAULT '[]',
    total_clips INTEGER NOT NULL DEFAULT 0,
    completed_clips INTEGER NOT NULL DEFAULT 0,
    failed_clips INTEGER NOT NULL DEFAULT 0,
    zip_path TEXT,
    ai_notes TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS clips (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    video_id TEXT NOT NULL,
    clip_index INTEGER NOT NULL,
    title TEXT NOT NULL,
    hook TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'highlight',
    score INTEGER NOT NULL DEFAULT 80,
    start_time REAL NOT NULL,
    end_time REAL NOT NULL,
    duration REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    video_path TEXT,
    thumbnail_path TEXT,
    ass_path TEXT,
    srt_path TEXT,
    file_size INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

function mapVideoRow(row: Record<string, unknown>): VideoRecord {
  return {
    id: String(row.id),
    originalFilename: String(row.original_filename),
    safeFilename: String(row.safe_filename),
    filePath: String(row.file_path),
    fileSize: Number(row.file_size),
    duration: Number(row.duration),
    width: Number(row.width),
    height: Number(row.height),
    fps: Number(row.fps),
    videoCodec: String(row.video_codec),
    audioCodec: row.audio_codec ? String(row.audio_codec) : null,
    bitrate: Number(row.bitrate),
    hasAudio: Boolean(row.has_audio),
    audioStreams: Number(row.audio_streams),
    formatName: String(row.format_name),
    createdAt: String(row.created_at),
  };
}

function mapJobRow(row: Record<string, unknown>): JobRecord {
  return {
    id: String(row.id),
    videoId: String(row.video_id),
    videoFilename: row.video_filename ? String(row.video_filename) : undefined,
    videoDuration: row.video_duration !== undefined ? Number(row.video_duration) : undefined,
    status: String(row.status) as JobStatus,
    progressPct: Number(row.progress_pct),
    stageMessage: String(row.stage_message || ''),
    config: JSON.parse(String(row.config_json)) as JobConfig,
    transcriptPath: row.transcript_path ? String(row.transcript_path) : null,
    scenes: JSON.parse(String(row.scenes_json || '[]')) as number[],
    totalClips: Number(row.total_clips),
    completedClips: Number(row.completed_clips),
    failedClips: Number(row.failed_clips),
    zipPath: row.zip_path ? String(row.zip_path) : null,
    aiNotes: row.ai_notes ? String(row.ai_notes) : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
  };
}

function mapClipRow(row: Record<string, unknown>): ClipRecord {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    videoId: String(row.video_id),
    clipIndex: Number(row.clip_index),
    title: String(row.title),
    hook: String(row.hook || ''),
    reason: String(row.reason || ''),
    category: String(row.category || 'highlight'),
    score: Number(row.score),
    startTime: Number(row.start_time),
    endTime: Number(row.end_time),
    duration: Number(row.duration),
    status: String(row.status) as ClipStatus,
    videoPath: row.video_path ? String(row.video_path) : null,
    thumbnailPath: row.thumbnail_path ? String(row.thumbnail_path) : null,
    assPath: row.ass_path ? String(row.ass_path) : null,
    srtPath: row.srt_path ? String(row.srt_path) : null,
    fileSize: Number(row.file_size || 0),
    errorMessage: row.error_message ? String(row.error_message) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function insertVideo(video: VideoRecord): VideoRecord {
  const stmt = db.prepare(`
    INSERT INTO videos (
      id, original_filename, safe_filename, file_path, file_size,
      duration, width, height, fps, video_codec, audio_codec,
      bitrate, has_audio, audio_streams, format_name, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    video.id,
    video.originalFilename,
    video.safeFilename,
    video.filePath,
    video.fileSize,
    video.duration,
    video.width,
    video.height,
    video.fps,
    video.videoCodec,
    video.audioCodec,
    video.bitrate,
    video.hasAudio ? 1 : 0,
    video.audioStreams,
    video.formatName,
    video.createdAt
  );
  return video;
}

export function listVideos(): VideoRecord[] {
  const rows = db.prepare(`SELECT * FROM videos ORDER BY created_at DESC`).all() as Record<string, unknown>[];
  return rows.map(mapVideoRow);
}

export function getVideoById(id: string): VideoRecord | null {
  const row = db.prepare(`SELECT * FROM videos WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  return row ? mapVideoRow(row) : null;
}

export function deleteVideoById(id: string): void {
  db.prepare(`DELETE FROM videos WHERE id = ?`).run(id);
}

export function insertJob(job: JobRecord): JobRecord {
  db.prepare(`
    INSERT INTO jobs (
      id, video_id, status, progress_pct, stage_message, config_json,
      transcript_path, scenes_json, total_clips, completed_clips, failed_clips,
      zip_path, ai_notes, error_message, created_at, updated_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    job.id,
    job.videoId,
    job.status,
    job.progressPct,
    job.stageMessage,
    JSON.stringify(job.config),
    job.transcriptPath,
    JSON.stringify(job.scenes),
    job.totalClips,
    job.completedClips,
    job.failedClips,
    job.zipPath,
    job.aiNotes,
    job.errorMessage,
    job.createdAt,
    job.updatedAt,
    job.completedAt
  );
  return getJobById(job.id)!;
}

export function listJobs(): JobRecord[] {
  const rows = db
    .prepare(
      `SELECT j.*, v.original_filename AS video_filename, v.duration AS video_duration
       FROM jobs j
       LEFT JOIN videos v ON j.video_id = v.id
       ORDER BY j.created_at DESC`
    )
    .all() as Record<string, unknown>[];
  return rows.map(mapJobRow);
}

export function getJobById(id: string): JobRecord | null {
  const row = db
    .prepare(
      `SELECT j.*, v.original_filename AS video_filename, v.duration AS video_duration
       FROM jobs j
       LEFT JOIN videos v ON j.video_id = v.id
       WHERE j.id = ?`
    )
    .get(id) as Record<string, unknown> | undefined;
  return row ? mapJobRow(row) : null;
}

export function updateJob(
  id: string,
  fields: Partial<{
    status: JobStatus;
    progressPct: number;
    stageMessage: string;
    transcriptPath: string | null;
    scenes: number[];
    totalClips: number;
    completedClips: number;
    failedClips: number;
    zipPath: string | null;
    aiNotes: string | null;
    errorMessage: string | null;
    completedAt: string | null;
  }>
): JobRecord | null {
  const sets: string[] = [];
  const values: Array<string | number | null> = [];

  if (fields.status !== undefined) {
    sets.push('status = ?');
    values.push(fields.status);
  }
  if (fields.progressPct !== undefined) {
    sets.push('progress_pct = ?');
    values.push(fields.progressPct);
  }
  if (fields.stageMessage !== undefined) {
    sets.push('stage_message = ?');
    values.push(fields.stageMessage);
  }
  if (fields.transcriptPath !== undefined) {
    sets.push('transcript_path = ?');
    values.push(fields.transcriptPath);
  }
  if (fields.scenes !== undefined) {
    sets.push('scenes_json = ?');
    values.push(JSON.stringify(fields.scenes));
  }
  if (fields.totalClips !== undefined) {
    sets.push('total_clips = ?');
    values.push(fields.totalClips);
  }
  if (fields.completedClips !== undefined) {
    sets.push('completed_clips = ?');
    values.push(fields.completedClips);
  }
  if (fields.failedClips !== undefined) {
    sets.push('failed_clips = ?');
    values.push(fields.failedClips);
  }
  if (fields.zipPath !== undefined) {
    sets.push('zip_path = ?');
    values.push(fields.zipPath);
  }
  if (fields.aiNotes !== undefined) {
    sets.push('ai_notes = ?');
    values.push(fields.aiNotes);
  }
  if (fields.errorMessage !== undefined) {
    sets.push('error_message = ?');
    values.push(fields.errorMessage);
  }
  if (fields.completedAt !== undefined) {
    sets.push('completed_at = ?');
    values.push(fields.completedAt);
  }

  sets.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return getJobById(id);
}

export function getQueuedJobs(): JobRecord[] {
  const rows = db
    .prepare(
      `SELECT j.*, v.original_filename AS video_filename, v.duration AS video_duration
       FROM jobs j
       LEFT JOIN videos v ON j.video_id = v.id
       WHERE j.status = 'queued'
       ORDER BY j.created_at ASC`
    )
    .all() as Record<string, unknown>[];
  return rows.map(mapJobRow);
}

export function recoverInterruptedJobs(): JobRecord[] {
  const inFlightStatuses: JobStatus[] = [
    'analyzing',
    'transcribing',
    'selecting_clips',
    'generating_captions',
    'rendering',
    'packaging',
  ];
  const placeholders = inFlightStatuses.map(() => '?').join(', ');
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE jobs
     SET status = 'queued',
         stage_message = 'Recovered after server restart — queued to resume',
         updated_at = ?
     WHERE status IN (${placeholders})`
  ).run(now, ...inFlightStatuses);

  return getQueuedJobs();
}

export function insertClip(clip: ClipRecord): ClipRecord {
  db.prepare(`
    INSERT INTO clips (
      id, job_id, video_id, clip_index, title, hook, reason, category, score,
      start_time, end_time, duration, status, video_path, thumbnail_path,
      ass_path, srt_path, file_size, error_message, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    clip.id,
    clip.jobId,
    clip.videoId,
    clip.clipIndex,
    clip.title,
    clip.hook,
    clip.reason,
    clip.category,
    clip.score,
    clip.startTime,
    clip.endTime,
    clip.duration,
    clip.status,
    clip.videoPath,
    clip.thumbnailPath,
    clip.assPath,
    clip.srtPath,
    clip.fileSize,
    clip.errorMessage,
    clip.createdAt,
    clip.updatedAt
  );
  return getClipById(clip.id)!;
}

export function listClipsByJob(jobId: string): ClipRecord[] {
  const rows = db
    .prepare(`SELECT * FROM clips WHERE job_id = ? ORDER BY clip_index ASC`)
    .all(jobId) as Record<string, unknown>[];
  return rows.map(mapClipRow);
}

export function listAllClips(): ClipRecord[] {
  const rows = db
    .prepare(`SELECT * FROM clips ORDER BY created_at DESC, clip_index ASC`)
    .all() as Record<string, unknown>[];
  return rows.map(mapClipRow);
}

export function getClipById(id: string): ClipRecord | null {
  const row = db.prepare(`SELECT * FROM clips WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  return row ? mapClipRow(row) : null;
}

export function updateClip(
  id: string,
  fields: Partial<{
    title: string;
    hook: string;
    reason: string;
    category: string;
    score: number;
    startTime: number;
    endTime: number;
    duration: number;
    status: ClipStatus;
    videoPath: string | null;
    thumbnailPath: string | null;
    assPath: string | null;
    srtPath: string | null;
    fileSize: number;
    errorMessage: string | null;
  }>
): ClipRecord | null {
  const sets: string[] = [];
  const values: Array<string | number | null> = [];

  if (fields.title !== undefined) {
    sets.push('title = ?');
    values.push(fields.title);
  }
  if (fields.hook !== undefined) {
    sets.push('hook = ?');
    values.push(fields.hook);
  }
  if (fields.reason !== undefined) {
    sets.push('reason = ?');
    values.push(fields.reason);
  }
  if (fields.category !== undefined) {
    sets.push('category = ?');
    values.push(fields.category);
  }
  if (fields.score !== undefined) {
    sets.push('score = ?');
    values.push(fields.score);
  }
  if (fields.startTime !== undefined) {
    sets.push('start_time = ?');
    values.push(fields.startTime);
  }
  if (fields.endTime !== undefined) {
    sets.push('end_time = ?');
    values.push(fields.endTime);
  }
  if (fields.duration !== undefined) {
    sets.push('duration = ?');
    values.push(fields.duration);
  }
  if (fields.status !== undefined) {
    sets.push('status = ?');
    values.push(fields.status);
  }
  if (fields.videoPath !== undefined) {
    sets.push('video_path = ?');
    values.push(fields.videoPath);
  }
  if (fields.thumbnailPath !== undefined) {
    sets.push('thumbnail_path = ?');
    values.push(fields.thumbnailPath);
  }
  if (fields.assPath !== undefined) {
    sets.push('ass_path = ?');
    values.push(fields.assPath);
  }
  if (fields.srtPath !== undefined) {
    sets.push('srt_path = ?');
    values.push(fields.srtPath);
  }
  if (fields.fileSize !== undefined) {
    sets.push('file_size = ?');
    values.push(fields.fileSize);
  }
  if (fields.errorMessage !== undefined) {
    sets.push('error_message = ?');
    values.push(fields.errorMessage);
  }

  sets.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  db.prepare(`UPDATE clips SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return getClipById(id);
}

export function deleteClipById(id: string): void {
  db.prepare(`DELETE FROM clips WHERE id = ?`).run(id);
}

export function deleteClipsByJobId(jobId: string): void {
  db.prepare(`DELETE FROM clips WHERE job_id = ?`).run(jobId);
}

export function getSettings(): AppSettings {
  const row = db.prepare(`SELECT value_json FROM settings WHERE key = 'app_settings'`).get() as
    | { value_json: string }
    | undefined;
  const defaults = getDefaultSettings();
  if (!row) {
    saveSettings(defaults);
    return defaults;
  }
  const parsed = JSON.parse(row.value_json) as Partial<AppSettings>;
  return {
    ai: {
      ...defaults.ai,
      ...(parsed.ai || {}),
      geminiKeyConfigured: Boolean(
        process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
      ),
    },
    whisper: { ...defaults.whisper, ...(parsed.whisper || {}) },
    video: { ...defaults.video, ...(parsed.video || {}) },
    caption: { ...defaults.caption, ...(parsed.caption || {}) },
    storage: {
      ...defaults.storage,
      ...(parsed.storage || {}),
      storageRoot: DIRS.root,
    },
  };
}

export function saveSettings(settings: AppSettings): AppSettings {
  const now = new Date().toISOString();
  const sanitized: AppSettings = {
    ...settings,
    ai: {
      ...settings.ai,
      geminiKeyConfigured: Boolean(
        process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
      ),
    },
    storage: {
      ...settings.storage,
      storageRoot: DIRS.root,
    },
  };
  db.prepare(`
    INSERT INTO settings (key, value_json, updated_at)
    VALUES ('app_settings', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
  `).run(JSON.stringify(sanitized), now);
  return sanitized;
}
