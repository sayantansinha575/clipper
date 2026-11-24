import crypto from 'crypto';
import { EventEmitter } from 'events';
import fs from 'fs';
import {
  deleteClipsByJobId,
  getClipById,
  getJobById,
  getQueuedJobs,
  getSettings,
  getVideoById,
  insertClip,
  listClipsByJob,
  recoverInterruptedJobs,
  updateClip,
  updateJob,
} from '../db.ts';
import type { ClipRecord, JobRecord, TranscriptData } from '../types.ts';
import { cleanupExpiredOutputs, cleanupJobTempFiles, removeFileIfExists } from '../utils/cleanup.ts';
import { checkDiskSpaceForJob } from '../utils/storage.ts';
import { selectClipsWithGemini } from '../services/aiSelector.ts';
import { generateClipSubtitles } from '../services/captionGenerator.ts';
import { detectSceneChanges } from '../services/sceneDetector.ts';
import { generateClipThumbnail } from '../services/thumbnailGenerator.ts';
import { transcribeVideoAudio } from '../services/transcriber.ts';
import {
  cancelActiveRender,
  getDimensionsForConfig,
  renderClipWithFfmpeg,
} from '../services/videoRenderer.ts';
import { createClipsZip } from '../services/zipGenerator.ts';

class JobProgressBus extends EventEmitter {
  emitJobUpdate(job: JobRecord): void {
    this.emit(`job:${job.id}`, job);
    this.emit('job:any', job);
  }
}

export const jobProgressBus = new JobProgressBus();
const cancelledJobIds = new Set<string>();
let isWorkerBusy = false;
let workerKickRequested = false;

export function requestJobCancellation(jobId: string): JobRecord | null {
  cancelledJobIds.add(jobId);
  cancelActiveRender(jobId);

  const job = getJobById(jobId);
  if (!job) return null;

  if (
    job.status === 'queued' ||
    job.status === 'uploaded' ||
    job.status === 'analyzing' ||
    job.status === 'transcribing' ||
    job.status === 'selecting_clips' ||
    job.status === 'generating_captions' ||
    job.status === 'rendering' ||
    job.status === 'packaging'
  ) {
    const updated = updateJob(jobId, {
      status: 'cancelled',
      stageMessage: 'Processing cancelled by user.',
      errorMessage: 'Cancelled by user',
    });
    cleanupJobTempFiles(jobId);
    if (updated) jobProgressBus.emitJobUpdate(updated);
    return updated;
  }

  return job;
}

export function enqueueJobProcessing(): void {
  if (isWorkerBusy) {
    workerKickRequested = true;
    return;
  }
  void runWorkerLoop();
}

export function initializeWorkerOnStartup(): void {
  const settings = getSettings();
  cleanupExpiredOutputs(settings.storage.retentionDays);
  const recovered = recoverInterruptedJobs();
  if (recovered.length > 0) {
    console.log(`Recovered ${recovered.length} interrupted job(s) from SQLite queue.`);
    enqueueJobProcessing();
  }
}

async function runWorkerLoop(): Promise<void> {
  if (isWorkerBusy) return;
  isWorkerBusy = true;

  try {
    while (true) {
      const queued = getQueuedJobs();
      if (queued.length === 0) break;

      for (const job of queued) {
        if (cancelledJobIds.has(job.id)) {
          cancelledJobIds.delete(job.id);
          continue;
        }
        await processSingleJob(job.id);
      }

      if (!workerKickRequested) break;
      workerKickRequested = false;
    }
  } finally {
    isWorkerBusy = false;
    if (workerKickRequested) {
      workerKickRequested = false;
      void runWorkerLoop();
    }
  }
}

function updateAndEmit(
  jobId: string,
  fields: Parameters<typeof updateJob>[1]
): JobRecord | null {
  const updated = updateJob(jobId, fields);
  if (updated) {
    jobProgressBus.emitJobUpdate(updated);
  }
  return updated;
}

function isCancelled(jobId: string): boolean {
  if (cancelledJobIds.has(jobId)) return true;
  const current = getJobById(jobId);
  return current?.status === 'cancelled';
}

async function processSingleJob(jobId: string): Promise<void> {
  const job = getJobById(jobId);
  if (!job) return;

  const video = getVideoById(job.videoId);
  if (!video || !fs.existsSync(video.filePath)) {
    updateAndEmit(jobId, {
      status: 'failed',
      stageMessage: 'Source video file is missing on disk.',
      errorMessage: 'Source video file not found.',
    });
    return;
  }

  const settings = getSettings();

  // Check disk space before starting
  const diskCheck = checkDiskSpaceForJob(
    video.fileSize,
    job.config.clipCount,
    settings.storage.minFreeDiskMb
  );
  if (!diskCheck.ok) {
    updateAndEmit(jobId, {
      status: 'failed',
      stageMessage: 'Insufficient disk space to render clips.',
      errorMessage: diskCheck.message || 'Insufficient disk space.',
    });
    return;
  }

  try {
    // 1. Analyzing (Scene detection + metadata check)
    updateAndEmit(jobId, {
      status: 'analyzing',
      progressPct: 6,
      stageMessage: 'Inspecting video streams and detecting visual scene boundaries...',
      errorMessage: null,
    });

    const scenes = await detectSceneChanges(video.filePath);
    if (isCancelled(jobId)) return;

    updateAndEmit(jobId, {
      scenes,
      progressPct: 14,
      stageMessage: `Detected ${scenes.length} visual scene transition(s).`,
    });

    // 2. Transcribing
    let transcript: TranscriptData;
    let transcriptPath = job.transcriptPath;

    if (transcriptPath && fs.existsSync(transcriptPath)) {
      transcript = JSON.parse(fs.readFileSync(transcriptPath, 'utf-8')) as TranscriptData;
    } else {
      updateAndEmit(jobId, {
        status: 'transcribing',
        progressPct: 16,
        stageMessage: video.hasAudio
          ? 'Extracting audio and transcribing speech with word timestamps...'
          : 'No audio track detected; preparing visual frame analysis...',
      });

      const res = await transcribeVideoAudio({
        videoPath: video.filePath,
        jobId,
        duration: video.duration,
        hasAudio: video.hasAudio,
        languageHint: settings.whisper.language,
        whisperSettings: settings.whisper,
        skipCloudStt: settings.ai.provider === 'ollama_only',
        allowSkipOnQuotaOrLocalOnly: settings.ai.provider !== 'gemini_only',
        onProgress: (pct, message) => {
          if (!isCancelled(jobId)) {
            updateAndEmit(jobId, { progressPct: pct, stageMessage: message });
          }
        },
        isCancelled: () => isCancelled(jobId),
      });
      transcript = res.transcript;
      transcriptPath = res.transcriptPath;
    }

    if (isCancelled(jobId)) return;

    updateAndEmit(jobId, {
      transcriptPath,
      progressPct: 38,
      stageMessage: transcript.hasSpeech
        ? `Transcribed ${transcript.segments.length} speech segment(s) (${transcript.language}).`
        : 'Proceeding with visual highlight selection.',
    });

    // 3. Selecting clips with Gemini (reuse existing clips if recovering mid-render)
    let clips = listClipsByJob(jobId);
    if (clips.length === 0) {
      updateAndEmit(jobId, {
        status: 'selecting_clips',
        progressPct: 40,
        stageMessage: 'Selecting high-retention clips with Gemini AI...',
      });

      const { clips: selected, aiNotes } = await selectClipsWithGemini({
        videoPath: video.filePath,
        jobId,
        videoDuration: video.duration,
        transcript,
        scenes,
        config: job.config,
        aiSettings: settings.ai,
        onProgress: (pct, message) => {
          if (!isCancelled(jobId)) {
            updateAndEmit(jobId, { progressPct: pct, stageMessage: message });
          }
        },
        isCancelled: () => isCancelled(jobId),
      });

      if (isCancelled(jobId)) return;

      if (selected.length === 0) {
        throw new Error(
          'No valid clip timestamps could be generated within the configured duration limits.'
        );
      }

      const now = new Date().toISOString();
      deleteClipsByJobId(jobId);
      clips = selected.map((c, idx) =>
        insertClip({
          id: `clip_${crypto.randomUUID().slice(0, 12)}`,
          jobId,
          videoId: video.id,
          clipIndex: idx + 1,
          title: c.title,
          hook: c.hook,
          reason: c.reason,
          category: c.category,
          score: c.score,
          startTime: c.start,
          endTime: c.end,
          duration: c.duration,
          status: 'pending',
          videoPath: null,
          thumbnailPath: null,
          assPath: null,
          srtPath: null,
          fileSize: 0,
          errorMessage: null,
          createdAt: now,
          updatedAt: now,
        })
      );

      updateAndEmit(jobId, {
        totalClips: clips.length,
        aiNotes,
        progressPct: 56,
        stageMessage: `Selected ${clips.length} clip(s) for captioning and rendering.`,
      });
    }

    if (isCancelled(jobId)) return;

    // 4. Generate ASS & SRT captions for each clip
    updateAndEmit(jobId, {
      status: 'generating_captions',
      progressPct: 58,
      stageMessage: `Generating synchronized ASS viral captions for ${clips.length} clip(s)...`,
    });

    const { width: playResX, height: playResY } = getDimensionsForConfig(
      job.config.aspectRatio,
      job.config.outputResolution
    );

    for (const clip of clips) {
      if (isCancelled(jobId)) return;
      if (clip.status === 'completed' && clip.videoPath && fs.existsSync(clip.videoPath)) {
        continue;
      }
      const { assPath, srtPath } = generateClipSubtitles({
        clipId: clip.id,
        transcript,
        clipStart: clip.startTime,
        clipEnd: clip.endTime,
        style: job.config.captionStyle,
        playResX,
        playResY,
      });
      updateClip(clip.id, { assPath, srtPath });
    }

    // Reload clips with updated subtitle paths
    clips = listClipsByJob(jobId);

    // 5. Sequential FFmpeg rendering & thumbnail extraction
    updateAndEmit(jobId, {
      status: 'rendering',
      progressPct: 62,
      stageMessage: `Rendering ${clips.length} clip(s) sequentially on CPU...`,
    });

    let completedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < clips.length; i++) {
      if (isCancelled(jobId)) return;

      const clip = clips[i];
      if (
        clip.status === 'completed' &&
        clip.videoPath &&
        fs.existsSync(clip.videoPath) &&
        clip.thumbnailPath &&
        fs.existsSync(clip.thumbnailPath)
      ) {
        completedCount += 1;
        continue;
      }

      updateClip(clip.id, { status: 'rendering', errorMessage: null });
      const pct = 62 + Math.round((i / clips.length) * 32);
      updateAndEmit(jobId, {
        progressPct: pct,
        stageMessage: `Rendering clip ${i + 1} of ${clips.length}: "${clip.title}"`,
      });

      try {
        const rendered = await renderClipWithFfmpeg({
          jobId,
          clipId: clip.id,
          sourcePath: video.filePath,
          startTime: clip.startTime,
          endTime: clip.endTime,
          hasAudio: video.hasAudio,
          aspectRatio: job.config.aspectRatio,
          outputResolution: job.config.outputResolution,
          effects: job.config.effects,
          assPath: clip.assPath,
          fps: settings.video.fps,
          crf: settings.video.crf,
          preset: settings.video.preset,
          audioBitrate: settings.video.audioBitrate,
        });

        const thumbPath = await generateClipThumbnail({
          clipId: clip.id,
          videoPath: rendered.outputPath,
          clipDuration: clip.duration,
        });

        updateClip(clip.id, {
          status: 'completed',
          videoPath: rendered.outputPath,
          thumbnailPath: thumbPath,
          fileSize: rendered.fileSize,
          errorMessage: null,
        });
        completedCount += 1;
      } catch (clipErr) {
        if (isCancelled(jobId)) return;
        failedCount += 1;
        updateClip(clip.id, {
          status: 'failed',
          errorMessage: clipErr instanceof Error ? clipErr.message : 'Render error',
        });
      }

      updateAndEmit(jobId, {
        completedClips: completedCount,
        failedClips: failedCount,
        progressPct: 62 + Math.round(((i + 1) / clips.length) * 32),
      });
    }

    if (isCancelled(jobId)) return;

    if (completedCount === 0) {
      throw new Error('All clips failed during FFmpeg rendering.');
    }

    // 6. Packaging ZIP archive
    updateAndEmit(jobId, {
      status: 'packaging',
      progressPct: 95,
      stageMessage: 'Packaging completed clips into downloadable ZIP archive...',
    });

    const finalClips = listClipsByJob(jobId);
    const zipResult = await createClipsZip({
      archiveName: `${jobId}_shorts`,
      clips: finalClips,
    });

    // Final validation before reporting completion
    if (!fs.existsSync(zipResult.zipPath)) {
      throw new Error('ZIP archive validation failed after packaging.');
    }

    cleanupJobTempFiles(jobId);

    updateAndEmit(jobId, {
      status: 'completed',
      progressPct: 100,
      completedClips: completedCount,
      failedClips: failedCount,
      zipPath: zipResult.zipPath,
      stageMessage: `Completed ${completedCount} clip(s)${failedCount > 0 ? ` (${failedCount} failed)` : ''}.`,
      completedAt: new Date().toISOString(),
    });
  } catch (err) {
    if (isCancelled(jobId)) return;
    const msg = err instanceof Error ? err.message : 'Unexpected processing failure';
    cleanupJobTempFiles(jobId);
    updateAndEmit(jobId, {
      status: 'failed',
      stageMessage: 'Processing failed.',
      errorMessage: msg,
    });
  } finally {
    cancelledJobIds.delete(jobId);
  }
}

export async function rerenderSingleClip(clipId: string): Promise<ClipRecord> {
  const clip = getClipById(clipId);
  if (!clip) throw new Error('Clip not found.');
  const job = getJobById(clip.jobId);
  const video = getVideoById(clip.videoId);
  if (!job || !video) throw new Error('Parent job or source video not found.');

  const settings = getSettings();

  // Regenerate ASS/SRT if transcript exists
  let assPath = clip.assPath;
  let srtPath = clip.srtPath;
  if (job.transcriptPath && fs.existsSync(job.transcriptPath)) {
    const transcript = JSON.parse(fs.readFileSync(job.transcriptPath, 'utf-8')) as TranscriptData;
    const { width: playResX, height: playResY } = getDimensionsForConfig(
      job.config.aspectRatio,
      job.config.outputResolution
    );
    const subs = generateClipSubtitles({
      clipId: clip.id,
      transcript,
      clipStart: clip.startTime,
      clipEnd: clip.endTime,
      style: job.config.captionStyle,
      playResX,
      playResY,
    });
    assPath = subs.assPath;
    srtPath = subs.srtPath;
  }

  updateClip(clip.id, { status: 'rendering', assPath, srtPath, errorMessage: null });

  try {
    const rendered = await renderClipWithFfmpeg({
      jobId: `single_${clip.id}`,
      clipId: clip.id,
      sourcePath: video.filePath,
      startTime: clip.startTime,
      endTime: clip.endTime,
      hasAudio: video.hasAudio,
      aspectRatio: job.config.aspectRatio,
      outputResolution: job.config.outputResolution,
      effects: job.config.effects,
      assPath,
      fps: settings.video.fps,
      crf: settings.video.crf,
      preset: settings.video.preset,
      audioBitrate: settings.video.audioBitrate,
    });

    const thumbPath = await generateClipThumbnail({
      clipId: clip.id,
      videoPath: rendered.outputPath,
      clipDuration: clip.duration,
    });

    const updated = updateClip(clip.id, {
      status: 'completed',
      videoPath: rendered.outputPath,
      thumbnailPath: thumbPath,
      fileSize: rendered.fileSize,
      errorMessage: null,
    });

    // Invalidate stale job ZIP so next download regenerates cleanly
    if (job.zipPath) {
      removeFileIfExists(job.zipPath);
      updateJob(job.id, { zipPath: null });
    }

    return updated!;
  } catch (err) {
    const updated = updateClip(clip.id, {
      status: 'failed',
      errorMessage: err instanceof Error ? err.message : 'Clip re-render failed',
    });
    throw new Error(updated?.errorMessage || 'Clip re-render failed');
  }
}
