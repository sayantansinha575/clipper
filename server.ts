import 'dotenv/config';
import cors from 'cors';
import crypto from 'crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import {
  ADMIN_API_KEY,
  ALLOWED_ORIGINS,
  CAPTION_PRESETS,
  DIRS,
  MAX_UPLOAD_MB,
  PORT,
  ensureStorageDirectories,
} from './server/config.ts';
import {
  deleteClipById,
  deleteVideoById,
  getClipById,
  getJobById,
  getSettings,
  getVideoById,
  insertJob,
  insertVideo,
  listAllClips,
  listClipsByJob,
  listJobs,
  listVideos,
  saveSettings,
  updateClip,
  updateJob,
} from './server/db.ts';
import { generateClipSubtitles, getInstalledFonts } from './server/services/captionGenerator.ts';
import {
  normalizeOllamaBaseUrl,
  testOllamaConnection,
} from './server/services/ollamaClient.ts';
import { generateClipThumbnail } from './server/services/thumbnailGenerator.ts';
import { probeVideo } from './server/services/videoProbe.ts';
import { getDimensionsForConfig } from './server/services/videoRenderer.ts';
import { createClipsZip } from './server/services/zipGenerator.ts';
import type {
  AppSettings,
  AspectRatio,
  CaptionPresetId,
  ClipRecord,
  CropMode,
  JobConfig,
  JobRecord,
  OutputResolution,
  SelectionFocus,
  TranscriptData,
  VideoRecord,
} from './server/types.ts';
import {
  cleanupExpiredOutputs,
  cleanupTempDirectory,
  removeFileIfExists,
} from './server/utils/cleanup.ts';
import { checkDiskSpaceForJob, getStorageStats } from './server/utils/storage.ts';
import { sanitizeFilename, validateVideoExtension } from './server/utils/validators.ts';
import {
  enqueueJobProcessing,
  initializeWorkerOnStartup,
  jobProgressBus,
  rerenderSingleClip,
  requestJobCancellation,
} from './server/workers/processingWorker.ts';

ensureStorageDirectories();

function serializeVideo(v: VideoRecord) {
  return {
    id: v.id,
    originalFilename: v.originalFilename,
    safeFilename: v.safeFilename,
    fileSize: v.fileSize,
    duration: v.duration,
    width: v.width,
    height: v.height,
    fps: v.fps,
    videoCodec: v.videoCodec,
    audioCodec: v.audioCodec,
    bitrate: v.bitrate,
    hasAudio: v.hasAudio,
    audioStreams: v.audioStreams,
    formatName: v.formatName,
    createdAt: v.createdAt,
  };
}

function serializeClip(c: ClipRecord) {
  return {
    id: c.id,
    jobId: c.jobId,
    videoId: c.videoId,
    clipIndex: c.clipIndex,
    title: c.title,
    hook: c.hook,
    reason: c.reason,
    category: c.category,
    score: c.score,
    startTime: c.startTime,
    endTime: c.endTime,
    duration: c.duration,
    status: c.status,
    hasVideo: Boolean(c.videoPath && fs.existsSync(c.videoPath)),
    hasThumbnail: Boolean(c.thumbnailPath && fs.existsSync(c.thumbnailPath)),
    hasAss: Boolean(c.assPath && fs.existsSync(c.assPath)),
    hasSrt: Boolean(c.srtPath && fs.existsSync(c.srtPath)),
    fileSize: c.fileSize,
    errorMessage: c.errorMessage,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

function serializeJob(j: JobRecord) {
  return {
    id: j.id,
    videoId: j.videoId,
    videoFilename: j.videoFilename,
    videoDuration: j.videoDuration,
    status: j.status,
    progressPct: j.progressPct,
    stageMessage: j.stageMessage,
    config: j.config,
    hasTranscript: Boolean(j.transcriptPath && fs.existsSync(j.transcriptPath)),
    scenesCount: j.scenes.length,
    totalClips: j.totalClips,
    completedClips: j.completedClips,
    failedClips: j.failedClips,
    hasZip: Boolean(j.zipPath && fs.existsSync(j.zipPath)),
    aiNotes: j.aiNotes,
    errorMessage: j.errorMessage,
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
    completedAt: j.completedAt,
  };
}

function requireAdminIfConfigured(req: Request, res: Response, next: NextFunction): void {
  if (!ADMIN_API_KEY) {
    next();
    return;
  }
  const provided = req.header('x-admin-api-key');
  if (provided !== ADMIN_API_KEY) {
    res.status(401).json({ error: 'Unauthorized: invalid or missing admin API key.' });
    return;
  }
  next();
}

const uploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureStorageDirectories();
    cb(null, DIRS.uploads);
  },
  filename: (_req, file, cb) => {
    const idPrefix = crypto.randomUUID().slice(0, 8);
    const safe = sanitizeFilename(file.originalname);
    cb(null, `${idPrefix}_${safe}`);
  },
});

const uploadMiddleware = multer({
  storage: uploadStorage,
  limits: {
    fileSize: MAX_UPLOAD_MB * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (!validateVideoExtension(file.originalname)) {
      cb(new Error('Unsupported video format. Allowed: MP4, MOV, MKV, WEBM.'));
      return;
    }
    cb(null, true);
  },
});

async function startServer(): Promise<void> {
  const app = express();

  app.use(
    cors({
      origin: ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : true,
    })
  );
  app.use(express.json({ limit: '4mb' }));

  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 240,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api/', apiLimiter);

  // Health
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Upload video & inspect with FFprobe
  app.post('/api/upload', (req, res) => {
    uploadMiddleware.single('video')(req, res, async (err: unknown) => {
      if (err) {
        const message = err instanceof Error ? err.message : 'Upload failed';
        res.status(400).json({ error: message });
        return;
      }

      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'No video file provided under field "video".' });
        return;
      }

      try {
        const meta = await probeVideo(file.path);
        const decodedOriginalName = (() => {
          try {
            const utf8 = Buffer.from(file.originalname, 'latin1').toString('utf8');
            return utf8 && !utf8.includes('\uFFFD') ? utf8 : file.originalname;
          } catch {
            return file.originalname;
          }
        })();
        const videoRecord: VideoRecord = {
          id: `vid_${crypto.randomUUID().slice(0, 12)}`,
          originalFilename: path.basename(decodedOriginalName),
          safeFilename: file.filename,
          filePath: file.path,
          fileSize: file.size,
          duration: meta.duration,
          width: meta.width,
          height: meta.height,
          fps: meta.fps,
          videoCodec: meta.videoCodec,
          audioCodec: meta.audioCodec,
          bitrate: meta.bitrate,
          hasAudio: meta.hasAudio,
          audioStreams: meta.audioStreams,
          formatName: meta.formatName,
          createdAt: new Date().toISOString(),
        };

        insertVideo(videoRecord);
        res.status(201).json({ video: serializeVideo(videoRecord) });
      } catch (probeErr) {
        removeFileIfExists(file.path);
        const message =
          probeErr instanceof Error ? probeErr.message : 'Failed to inspect video metadata.';
        res.status(422).json({ error: message });
      }
    });
  });

  // Videos
  app.get('/api/videos', (_req, res) => {
    res.json({ videos: listVideos().map(serializeVideo) });
  });

  app.get('/api/videos/:id', (req, res) => {
    const video = getVideoById(req.params.id);
    if (!video) {
      res.status(404).json({ error: 'Video not found.' });
      return;
    }
    res.json({ video: serializeVideo(video) });
  });

  app.delete('/api/videos/:id', requireAdminIfConfigured, (req, res) => {
    const video = getVideoById(req.params.id);
    if (!video) {
      res.status(404).json({ error: 'Video not found.' });
      return;
    }

    const jobs = listJobs().filter((j) => j.videoId === video.id);
    for (const job of jobs) {
      requestJobCancellation(job.id);
      const clips = listClipsByJob(job.id);
      for (const clip of clips) {
        removeFileIfExists(clip.videoPath);
        removeFileIfExists(clip.thumbnailPath);
        removeFileIfExists(clip.assPath);
        removeFileIfExists(clip.srtPath);
      }
      removeFileIfExists(job.transcriptPath);
      removeFileIfExists(job.zipPath);
    }

    removeFileIfExists(video.filePath);
    deleteVideoById(video.id);
    res.json({ deleted: true, id: video.id });
  });

  // Jobs
  app.post('/api/jobs', (req, res) => {
    const body = req.body as {
      videoId?: string;
      config?: Partial<JobConfig>;
    };

    if (!body.videoId) {
      res.status(400).json({ error: 'videoId is required.' });
      return;
    }

    const video = getVideoById(body.videoId);
    if (!video || !fs.existsSync(video.filePath)) {
      res.status(404).json({ error: 'Source video not found on disk.' });
      return;
    }

    const settings = getSettings();
    const rawCfg = body.config || {};

    const clipCount = Math.max(
      1,
      Math.min(settings.ai.maxClips || 50, Number(rawCfg.clipCount ?? 15))
    );
    const minDuration = Math.max(3, Math.min(180, Number(rawCfg.minDuration ?? 20)));
    const maxDuration = Math.max(minDuration, Math.min(300, Number(rawCfg.maxDuration ?? 60)));
    const aspectRatio: AspectRatio = (['9:16', '1:1', '16:9'] as AspectRatio[]).includes(
      rawCfg.aspectRatio as AspectRatio
    )
      ? (rawCfg.aspectRatio as AspectRatio)
      : '9:16';

    const outputResolution: OutputResolution = (
      ['1080x1920', '720x1280', '1080x1080', '1920x1080'] as OutputResolution[]
    ).includes(rawCfg.outputResolution as OutputResolution)
      ? (rawCfg.outputResolution as OutputResolution)
      : settings.video.defaultResolution;

    const selectionFocus: SelectionFocus = (
      [
        'best_moments',
        'educational',
        'funny',
        'storytelling',
        'motivational',
        'podcast_highlights',
        'custom',
      ] as SelectionFocus[]
    ).includes(rawCfg.selectionFocus as SelectionFocus)
      ? (rawCfg.selectionFocus as SelectionFocus)
      : 'best_moments';

    const presetKey = (rawCfg.captionStyle?.preset || settings.caption.preset) as CaptionPresetId;
    const basePreset = CAPTION_PRESETS[presetKey] || settings.caption;

    const cropMode: CropMode = (['center', 'blurred_bg', 'subject_aware'] as CropMode[]).includes(
      rawCfg.effects?.cropMode as CropMode
    )
      ? (rawCfg.effects?.cropMode as CropMode)
      : 'blurred_bg';

    const jobConfig: JobConfig = {
      clipCount,
      minDuration,
      maxDuration,
      aspectRatio,
      outputResolution,
      selectionFocus,
      customInstructions: String(rawCfg.customInstructions ?? settings.ai.defaultInstructions).slice(
        0,
        1000
      ),
      captionStyle: {
        ...basePreset,
        ...(rawCfg.captionStyle || {}),
      },
      effects: {
        cropMode,
        subtleZoomIn: Boolean(rawCfg.effects?.subtleZoomIn),
        zoomOut: Boolean(rawCfg.effects?.zoomOut),
        fadeInOut: Boolean(rawCfg.effects?.fadeInOut ?? true),
        audioNormalize: Boolean(rawCfg.effects?.audioNormalize ?? true),
      },
    };

    const diskCheck = checkDiskSpaceForJob(
      video.fileSize,
      jobConfig.clipCount,
      settings.storage.minFreeDiskMb
    );
    if (!diskCheck.ok) {
      res.status(507).json({ error: diskCheck.message });
      return;
    }

    const now = new Date().toISOString();
    const job = insertJob({
      id: `job_${crypto.randomUUID().slice(0, 12)}`,
      videoId: video.id,
      videoFilename: video.originalFilename,
      videoDuration: video.duration,
      status: 'queued',
      progressPct: 2,
      stageMessage: 'Job queued for background processing.',
      config: jobConfig,
      transcriptPath: null,
      scenes: [],
      totalClips: 0,
      completedClips: 0,
      failedClips: 0,
      zipPath: null,
      aiNotes: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    });

    jobProgressBus.emitJobUpdate(job);
    enqueueJobProcessing();

    res.status(201).json({ job: serializeJob(job) });
  });

  app.get('/api/jobs', (_req, res) => {
    res.json({ jobs: listJobs().map(serializeJob) });
  });

  app.get('/api/jobs/:id', (req, res) => {
    const job = getJobById(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }
    res.json({ job: serializeJob(job) });
  });

  app.get('/api/jobs/:id/progress', (req, res) => {
    const job = getJobById(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }

    // Support both SSE streaming and standard JSON poll
    const accept = req.header('accept') || '';
    if (!accept.includes('text/event-stream')) {
      res.json({ job: serializeJob(job) });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendSnapshot = (payload: JobRecord) => {
      res.write(`data: ${JSON.stringify(serializeJob(payload))}\n\n`);
    };

    sendSnapshot(job);

    const listener = (updated: JobRecord) => {
      sendSnapshot(updated);
    };

    jobProgressBus.on(`job:${job.id}`, listener);

    const keepAlive = setInterval(() => {
      res.write(': ping\n\n');
    }, 15000);

    req.on('close', () => {
      clearInterval(keepAlive);
      jobProgressBus.off(`job:${job.id}`, listener);
      res.end();
    });
  });

  app.post('/api/jobs/:id/cancel', (req, res) => {
    const updated = requestJobCancellation(req.params.id);
    if (!updated) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }
    res.json({ job: serializeJob(updated) });
  });

  app.get('/api/jobs/:id/clips', (req, res) => {
    const job = getJobById(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }
    const clips = listClipsByJob(job.id).map(serializeClip);
    res.json({ clips });
  });

  app.get('/api/jobs/:id/transcript', (req, res) => {
    const job = getJobById(req.params.id);
    if (!job || !job.transcriptPath || !fs.existsSync(job.transcriptPath)) {
      res.status(404).json({ error: 'Transcript not available for this job.' });
      return;
    }
    const transcript = JSON.parse(fs.readFileSync(job.transcriptPath, 'utf-8')) as TranscriptData;
    res.json({ transcript });
  });

  // Clips
  app.get('/api/clips', (_req, res) => {
    res.json({ clips: listAllClips().map(serializeClip) });
  });

  app.get('/api/clips/:id', (req, res) => {
    const clip = getClipById(req.params.id);
    if (!clip) {
      res.status(404).json({ error: 'Clip not found.' });
      return;
    }
    res.json({ clip: serializeClip(clip) });
  });

  app.put('/api/clips/:id', (req, res) => {
    const clip = getClipById(req.params.id);
    if (!clip) {
      res.status(404).json({ error: 'Clip not found.' });
      return;
    }

    const video = getVideoById(clip.videoId);
    const job = getJobById(clip.jobId);
    const body = req.body as {
      title?: string;
      hook?: string;
      category?: string;
      startTime?: number;
      endTime?: number;
      regenerateSubtitles?: boolean;
    };

    const maxDur = video ? video.duration : Number.MAX_SAFE_INTEGER;
    const startTime =
      body.startTime !== undefined
        ? Math.max(0, Math.min(maxDur - 1, Number(body.startTime)))
        : clip.startTime;
    const endTime =
      body.endTime !== undefined
        ? Math.max(startTime + 1, Math.min(maxDur, Number(body.endTime)))
        : Math.max(startTime + 1, clip.endTime);

    const duration = Number((endTime - startTime).toFixed(2));

    let assPath = clip.assPath;
    let srtPath = clip.srtPath;
    if (
      (body.regenerateSubtitles ||
        body.startTime !== undefined ||
        body.endTime !== undefined) &&
      job?.transcriptPath &&
      fs.existsSync(job.transcriptPath)
    ) {
      const transcript = JSON.parse(fs.readFileSync(job.transcriptPath, 'utf-8')) as TranscriptData;
      const { width: playResX, height: playResY } = getDimensionsForConfig(
        job.config.aspectRatio,
        job.config.outputResolution
      );
      const subs = generateClipSubtitles({
        clipId: clip.id,
        transcript,
        clipStart: startTime,
        clipEnd: endTime,
        style: job.config.captionStyle,
        playResX,
        playResY,
      });
      assPath = subs.assPath;
      srtPath = subs.srtPath;
    }

    const updated = updateClip(clip.id, {
      title: body.title !== undefined ? String(body.title).trim().slice(0, 100) : clip.title,
      hook: body.hook !== undefined ? String(body.hook).trim().slice(0, 140) : clip.hook,
      category:
        body.category !== undefined ? String(body.category).trim().slice(0, 40) : clip.category,
      startTime: Number(startTime.toFixed(2)),
      endTime: Number(endTime.toFixed(2)),
      duration,
      assPath,
      srtPath,
    });

    res.json({ clip: serializeClip(updated!) });
  });

  app.post('/api/clips/:id/render', async (req, res) => {
    try {
      const updated = await rerenderSingleClip(req.params.id);
      res.json({ clip: serializeClip(updated) });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to render clip.',
      });
    }
  });

  app.post('/api/clips/:id/thumbnail', async (req, res) => {
    const clip = getClipById(req.params.id);
    if (!clip || !clip.videoPath || !fs.existsSync(clip.videoPath)) {
      res.status(404).json({ error: 'Rendered clip video not found.' });
      return;
    }
    try {
      const offsetSec =
        req.body?.offsetSec !== undefined ? Number(req.body.offsetSec) : undefined;
      const thumbPath = await generateClipThumbnail({
        clipId: clip.id,
        videoPath: clip.videoPath,
        clipDuration: clip.duration,
        offsetSec,
      });
      const updated = updateClip(clip.id, { thumbnailPath: thumbPath });
      res.json({ clip: serializeClip(updated!) });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Thumbnail regeneration failed.',
      });
    }
  });

  app.get('/api/clips/:id/thumbnail', (req, res) => {
    const clip = getClipById(req.params.id);
    if (!clip || !clip.thumbnailPath || !fs.existsSync(clip.thumbnailPath)) {
      res.status(404).json({ error: 'Thumbnail not found.' });
      return;
    }
    res.sendFile(path.resolve(clip.thumbnailPath));
  });

  app.get('/api/clips/:id/preview', (req, res) => {
    const clip = getClipById(req.params.id);
    if (!clip || !clip.videoPath || !fs.existsSync(clip.videoPath)) {
      res.status(404).json({ error: 'Clip MP4 not found.' });
      return;
    }
    res.sendFile(path.resolve(clip.videoPath));
  });

  app.get('/api/clips/:id/download', (req, res) => {
    const clip = getClipById(req.params.id);
    if (!clip || !clip.videoPath || !fs.existsSync(clip.videoPath)) {
      res.status(404).json({ error: 'Clip MP4 not found.' });
      return;
    }
    const slug = clip.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48);
    res.download(path.resolve(clip.videoPath), `${slug || clip.id}.mp4`);
  });

  app.get('/api/clips/:id/subtitles', (req, res) => {
    const clip = getClipById(req.params.id);
    if (!clip) {
      res.status(404).json({ error: 'Clip not found.' });
      return;
    }
    const format = req.query.format === 'srt' ? 'srt' : 'ass';
    const targetPath = format === 'srt' ? clip.srtPath : clip.assPath;
    if (!targetPath || !fs.existsSync(targetPath)) {
      res.status(404).json({ error: `Subtitle (${format.toUpperCase()}) not found.` });
      return;
    }
    res.download(path.resolve(targetPath), `${clip.id}.${format}`);
  });

  app.delete('/api/clips/:id', (req, res) => {
    const clip = getClipById(req.params.id);
    if (!clip) {
      res.status(404).json({ error: 'Clip not found.' });
      return;
    }
    removeFileIfExists(clip.videoPath);
    removeFileIfExists(clip.thumbnailPath);
    removeFileIfExists(clip.assPath);
    removeFileIfExists(clip.srtPath);
    deleteClipById(clip.id);
    res.json({ deleted: true, id: clip.id });
  });

  // ZIP Packaging
  app.post('/api/jobs/:id/download-zip', async (req, res) => {
    const job = getJobById(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }
    try {
      const clips = listClipsByJob(job.id);
      const result = await createClipsZip({
        archiveName: `${job.id}_shorts`,
        clips,
      });
      updateJob(job.id, { zipPath: result.zipPath });
      res.json({
        downloadUrl: `/api/jobs/${job.id}/zip`,
        fileCount: result.fileCount,
        fileSize: result.fileSize,
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to build ZIP archive.',
      });
    }
  });

  app.get('/api/jobs/:id/zip', (req, res) => {
    const job = getJobById(req.params.id);
    if (!job || !job.zipPath || !fs.existsSync(job.zipPath)) {
      res.status(404).json({ error: 'ZIP archive not found.' });
      return;
    }
    res.download(path.resolve(job.zipPath), `${job.id}_shorts.zip`);
  });

  app.post('/api/clips/download-zip', async (req, res) => {
    const clipIds = Array.isArray(req.body?.clipIds) ? (req.body.clipIds as string[]) : [];
    if (clipIds.length === 0) {
      res.status(400).json({ error: 'Select at least one clip to download.' });
      return;
    }
    const clips = clipIds.map((id) => getClipById(id)).filter((c): c is ClipRecord => Boolean(c));
    try {
      const archiveId = `selected_${crypto.randomUUID().slice(0, 8)}`;
      const result = await createClipsZip({ archiveName: archiveId, clips });
      res.download(path.resolve(result.zipPath), `ai_shorts_selected.zip`, () => {
        removeFileIfExists(result.zipPath);
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to create ZIP.',
      });
    }
  });

  // Settings
  app.get('/api/settings', (_req, res) => {
    res.json({ settings: getSettings() });
  });

  app.put('/api/settings', requireAdminIfConfigured, (req, res) => {
    const current = getSettings();
    const incoming = req.body as Partial<AppSettings>;
    const provider =
      incoming.ai?.provider === 'ollama_only' ||
      incoming.ai?.provider === 'gemini_only' ||
      incoming.ai?.provider === 'gemini_with_ollama_fallback'
        ? incoming.ai.provider
        : current.ai.provider;

    let ollamaBaseUrl = current.ai.ollamaBaseUrl;
    if (incoming.ai?.ollamaBaseUrl !== undefined) {
      try {
        ollamaBaseUrl = normalizeOllamaBaseUrl(incoming.ai.ollamaBaseUrl);
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Invalid Ollama Base URL',
        });
        return;
      }
    }

    const merged: AppSettings = {
      ai: {
        ...current.ai,
        ...(incoming.ai || {}),
        provider,
        ollamaBaseUrl,
        ollamaModel: String(incoming.ai?.ollamaModel ?? current.ai.ollamaModel).trim() || 'qwen3.5:4b',
        maxClips: Math.max(1, Math.min(50, Number(incoming.ai?.maxClips ?? current.ai.maxClips))),
      },
      whisper: { ...current.whisper, ...(incoming.whisper || {}) },
      video: { ...current.video, ...(incoming.video || {}) },
      caption: { ...current.caption, ...(incoming.caption || {}) },
      storage: {
        ...current.storage,
        ...(incoming.storage || {}),
        retentionDays: Math.max(
          1,
          Math.min(365, Number(incoming.storage?.retentionDays ?? current.storage.retentionDays))
        ),
      },
    };
    const saved = saveSettings(merged);
    res.json({ settings: saved });
  });

  app.post('/api/ollama/test', async (req, res) => {
    const settings = getSettings();
    const baseUrl = String(req.body?.baseUrl ?? settings.ai.ollamaBaseUrl);
    const result = await testOllamaConnection(baseUrl);
    res.status(result.ok ? 200 : 502).json(result);
  });

  // Storage & Cleanup
  app.get('/api/storage', (_req, res) => {
    const settings = getSettings();
    res.json({ storage: getStorageStats(settings.storage.minFreeDiskMb) });
  });

  app.post('/api/storage/cleanup', requireAdminIfConfigured, (_req, res) => {
    const settings = getSettings();
    const tempRemoved = cleanupTempDirectory(0);
    const expiredRemoved = cleanupExpiredOutputs(settings.storage.retentionDays);
    res.json({
      tempRemoved,
      expiredRemoved,
      storage: getStorageStats(settings.storage.minFreeDiskMb),
    });
  });

  // Fonts
  app.get('/api/fonts', (_req, res) => {
    res.json({ fonts: getInstalledFonts() });
  });

  // Initialize background worker & recover unfinished jobs
  initializeWorkerOnStartup();

  // Vite dev middleware vs static production serving
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AI Shorts Studio running on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
