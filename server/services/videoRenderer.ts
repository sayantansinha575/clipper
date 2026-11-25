import { type ChildProcess, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { DIRS } from '../config.ts';
import type { AspectRatio, EffectsConfig, OutputResolution } from '../types.ts';
import { validateRenderedVideo } from './videoProbe.ts';

const activeProcesses = new Map<string, ChildProcess>();

export function cancelActiveRender(jobId: string): void {
  const proc = activeProcesses.get(jobId);
  if (proc && !proc.killed) {
    proc.kill('SIGKILL');
  }
  activeProcesses.delete(jobId);
}

export function getDimensionsForConfig(
  aspectRatio: AspectRatio,
  resolution: OutputResolution
): { width: number; height: number } {
  if (aspectRatio === '1:1') {
    return resolution === '720x1280' ? { width: 720, height: 720 } : { width: 1080, height: 1080 };
  }
  if (aspectRatio === '16:9') {
    return resolution === '720x1280' ? { width: 1280, height: 720 } : { width: 1920, height: 1080 };
  }
  // 9:16 default
  return resolution === '720x1280' ? { width: 720, height: 1280 } : { width: 1080, height: 1920 };
}

function escapeFfmpegFilterPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

export async function renderClipWithFfmpeg(params: {
  jobId: string;
  clipId: string;
  sourcePath: string;
  startTime: number;
  endTime: number;
  hasAudio: boolean;
  aspectRatio: AspectRatio;
  outputResolution: OutputResolution;
  effects: EffectsConfig;
  assPath: string | null;
  fps?: number;
  crf?: number;
  preset?: string;
  audioBitrate?: string;
}): Promise<{ outputPath: string; fileSize: number }> {
  const {
    jobId,
    clipId,
    sourcePath,
    startTime,
    endTime,
    hasAudio,
    aspectRatio,
    outputResolution,
    effects,
    assPath,
    fps = 30,
    crf = 23,
    preset = 'veryfast',
    audioBitrate = '128k',
  } = params;

  const duration = Math.max(0.5, Number((endTime - startTime).toFixed(3)));
  const { width: targetW, height: targetH } = getDimensionsForConfig(aspectRatio, outputResolution);
  const outputPath = path.join(DIRS.clips, `${clipId}.mp4`);

  const hasAss = Boolean(assPath && fs.existsSync(assPath));
  const escapedAss = hasAss && assPath ? escapeFfmpegFilterPath(assPath) : '';

  const postFilters: string[] = [];

  if (effects.subtleZoomIn && !effects.zoomOut) {
    // Gentle linear zoom up to 1.06x over clip duration at 30fps
    const totalFrames = Math.max(30, Math.round(duration * fps));
    postFilters.push(
      `scale=${Math.round(targetW * 1.1)}:${Math.round(targetH * 1.1)},zoompan=z='1+0.06*(on/${totalFrames})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${targetW}x${targetH}:fps=${fps}`
    );
  } else if (effects.zoomOut) {
    const totalFrames = Math.max(30, Math.round(duration * fps));
    postFilters.push(
      `scale=${Math.round(targetW * 1.1)}:${Math.round(targetH * 1.1)},zoompan=z='1.06-0.06*(on/${totalFrames})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${targetW}x${targetH}:fps=${fps}`
    );
  }

  if (effects.fadeInOut && duration > 1.2) {
    const fadeOutStart = Math.max(0.4, Number((duration - 0.35).toFixed(2)));
    postFilters.push(`fade=t=in:st=0:d=0.3`, `fade=t=out:st=${fadeOutStart}:d=0.35`);
  }

  if (hasAss) {
    postFilters.push(`ass='${escapedAss}'`);
  }

  postFilters.push('format=yuv420p');
  const postChain = postFilters.join(',');

  const args: string[] = [
    '-y',
    '-ss',
    String(startTime),
    '-i',
    sourcePath,
    '-t',
    String(duration),
  ];

  if (effects.cropMode === 'blurred_bg') {
    const filterComplex = [
      `[0:v]split=2[bg][fg]`,
      `[bg]scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},boxblur=24:6,eq=brightness=-0.08[bgblur]`,
      `[fg]scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease[fgscaled]`,
      `[bgblur][fgscaled]overlay=(W-w)/2:(H-h)/2,${postChain}[vout]`,
    ].join(';');
    args.push('-filter_complex', filterComplex, '-map', '[vout]');
    if (hasAudio) {
      args.push('-map', '0:a:0?');
    }
  } else if (effects.cropMode === 'split_screen') {
    const ratio = Math.min(0.65, Math.max(0.25, Number(effects.splitTopRatio ?? 0.4)));
    const topH = Math.max(64, Math.floor((targetH * ratio) / 2) * 2);
    const bottomH = Math.max(64, targetH - topH);

    const reg = effects.splitTopRegion || { x: 0.01, y: 0.23, w: 0.22, h: 0.32 };
    const rw = Math.min(1, Math.max(0.08, Number(reg.w) || 0.22));
    const rh = Math.min(1, Math.max(0.08, Number(reg.h) || 0.32));
    const rx = Math.min(1 - rw, Math.max(0, Number(reg.x) || 0));
    const ry = Math.min(1 - rh, Math.max(0, Number(reg.y) || 0));

    const cropW = `max(32,trunc(iw*${rw.toFixed(4)}/2)*2)`;
    const cropH = `max(32,trunc(ih*${rh.toFixed(4)}/2)*2)`;
    const cropX = `min(iw-ow,max(0,trunc(iw*${rx.toFixed(4)})))`;
    const cropY = `min(ih-oh,max(0,trunc(ih*${ry.toFixed(4)})))`;

    const filterComplex = [
      `[0:v]split=2[topsrc][botsrc]`,
      `[topsrc]crop=w='${cropW}':h='${cropH}':x='${cropX}':y='${cropY}',scale=${targetW}:${topH}:force_original_aspect_ratio=increase,crop=${targetW}:${topH}:(iw-ow)/2:(ih-oh)/2,setsar=1[topout]`,
      `[botsrc]scale=${targetW}:${bottomH}:force_original_aspect_ratio=increase,crop=${targetW}:${bottomH}:(iw-ow)/2:(ih-oh)/2,setsar=1[botout]`,
      `[topout][botout]vstack=inputs=2,${postChain}[vout]`,
    ].join(';');
    args.push('-filter_complex', filterComplex, '-map', '[vout]');
    if (hasAudio) {
      args.push('-map', '0:a:0?');
    }
  } else {
    // Center crop or subject-aware (slightly higher vertical framing for talking heads)
    const yExpr = effects.cropMode === 'subject_aware' ? '(ih-oh)*0.32' : '(ih-oh)/2';
    const baseScale = `scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH}:(iw-ow)/2:${yExpr}`;
    args.push('-vf', `${baseScale},${postChain}`);
  }

  args.push(
    '-c:v',
    'libx264',
    '-preset',
    preset,
    '-crf',
    String(crf),
    '-r',
    String(fps)
  );

  if (hasAudio) {
    if (effects.audioNormalize) {
      args.push('-af', 'loudnorm=I=-16:TP=-1.5:LRA=11');
    }
    args.push('-c:a', 'aac', '-b:a', audioBitrate, '-ac', '2');
  } else {
    args.push('-an');
  }

  args.push('-movflags', '+faststart', outputPath);

  await new Promise<void>((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    activeProcesses.set(jobId, proc);

    let stderrLog = '';
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderrLog += chunk.toString();
      if (stderrLog.length > 8000) {
        stderrLog = stderrLog.slice(-6000);
      }
    });

    proc.on('error', (err) => {
      activeProcesses.delete(jobId);
      reject(err);
    });

    proc.on('close', (code, signal) => {
      activeProcesses.delete(jobId);
      if (signal === 'SIGKILL') {
        reject(new Error('Job cancelled by user'));
        return;
      }
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg render failed (code ${code}): ${stderrLog.slice(-400)}`));
      }
    });
  });

  const validation = await validateRenderedVideo(outputPath);
  if (!validation.valid) {
    throw new Error(validation.error || 'Rendered clip failed validation.');
  }

  return { outputPath, fileSize: validation.fileSize };
}
