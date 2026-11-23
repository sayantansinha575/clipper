import { execFile } from 'child_process';
import path from 'path';
import { promisify } from 'util';
import { DIRS } from '../config.ts';

const execFileAsync = promisify(execFile);

export async function extractAudioTrack(
  videoPath: string,
  jobId: string
): Promise<string> {
  const outPath = path.join(DIRS.temp, `${jobId}_audio.mp3`);
  await execFileAsync(
    'ffmpeg',
    [
      '-y',
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
      outPath,
    ],
    { maxBuffer: 20 * 1024 * 1024 }
  );
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
