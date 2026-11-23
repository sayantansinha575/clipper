import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { DIRS } from '../config.ts';

const execFileAsync = promisify(execFile);

export async function generateClipThumbnail(params: {
  clipId: string;
  videoPath: string;
  clipDuration: number;
  offsetSec?: number;
}): Promise<string> {
  const { clipId, videoPath, clipDuration, offsetSec } = params;
  const thumbPath = path.join(DIRS.thumbnails, `${clipId}.jpg`);

  const targetTs =
    offsetSec !== undefined
      ? Math.max(0, Math.min(Math.max(0.1, clipDuration - 0.1), offsetSec))
      : Math.max(0.1, Math.min(clipDuration * 0.25, Math.max(0.1, clipDuration - 0.2)));

  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-ss',
      String(Number(targetTs.toFixed(2))),
      '-i',
      videoPath,
      '-vframes',
      '1',
      '-q:v',
      '2',
      thumbPath,
    ],
    { maxBuffer: 10 * 1024 * 1024 }
  );

  if (!fs.existsSync(thumbPath) || fs.statSync(thumbPath).size < 100) {
    throw new Error('Thumbnail extraction produced an empty file.');
  }

  return thumbPath;
}
