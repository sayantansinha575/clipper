import { execFile } from 'child_process';
import path from 'path';
import { promisify } from 'util';
import { DIRS } from '../config.ts';

const execFileAsync = promisify(execFile);

export async function extractAudioTrack(
  videoPath: string,
  jobId: string,
  rangeStart?: number,
  rangeEnd?: number
): Promise<string> {
  const outPath = path.join(DIRS.temp, `${jobId}_audio.mp3`);
  const args = ['-y'];
  if (
    typeof rangeStart === 'number' &&
    typeof rangeEnd === 'number' &&
    rangeEnd > rangeStart
  ) {
    args.push('-ss', String(Math.max(0, rangeStart)), '-t', String(rangeEnd - Math.max(0, rangeStart)));
  }
  args.push(
    '-i',
    videoPath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-b:a',
    '48k',
    '-f',
    'mp3',
    outPath
  );
  await execFileAsync('ffmpeg', args, { maxBuffer: 20 * 1024 * 1024 });
  return outPath;
}

export async function sliceAudioChunk(
  audioPath: string,
  jobId: string,
  chunkIndex: number,
  startSec: number,
  durationSec: number
): Promise<string> {
  const chunkPath = path.join(DIRS.temp, `${jobId}_chunk_${chunkIndex}.mp3`);
  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-ss',
      String(startSec),
      '-t',
      String(durationSec),
      '-i',
      audioPath,
      '-c',
      'copy',
      chunkPath,
    ],
    { maxBuffer: 10 * 1024 * 1024 }
  );
  return chunkPath;
}

export async function extractVideoFrame(
  videoPath: string,
  timestampSec: number,
  outPath: string
): Promise<string> {
  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-ss',
      String(Math.max(0, timestampSec)),
      '-i',
      videoPath,
      '-vframes',
      '1',
      '-vf',
      'scale=640:-2',
      '-q:v',
      '4',
      outPath,
    ],
    { maxBuffer: 10 * 1024 * 1024 }
  );
  return outPath;
}

export async function extractVideoFilmstrip(
  videoPath: string,
  duration: number,
  outPath: string,
  tileCount = 8
): Promise<string> {
  const safeDur = Math.max(0.5, duration || 1);
  const count = Math.max(2, Math.min(12, tileCount));
  const args: string[] = ['-y'];
  const filterParts: string[] = [];
  const stackInputs: string[] = [];

  for (let i = 0; i < count; i++) {
    const ts = Number((((i + 0.5) / count) * safeDur).toFixed(2));
    args.push('-ss', String(ts), '-i', videoPath);
    filterParts.push(
      `[${i}:v]scale=160:90:force_original_aspect_ratio=increase,crop=160:90,setsar=1[v${i}]`
    );
    stackInputs.push(`[v${i}]`);
  }

  filterParts.push(`${stackInputs.join('')}hstack=inputs=${count}[strip]`);
  args.push(
    '-filter_complex',
    filterParts.join(';'),
    '-map',
    '[strip]',
    '-vframes',
    '1',
    '-q:v',
    '5',
    outPath
  );

  await execFileAsync('ffmpeg', args, { maxBuffer: 15 * 1024 * 1024, timeout: 60_000 });
  return outPath;
}
