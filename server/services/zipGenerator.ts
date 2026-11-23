import { ZipArchive } from 'archiver';
import fs from 'fs';
import path from 'path';
import { DIRS } from '../config.ts';
import type { ClipRecord } from '../types.ts';

export async function createClipsZip(params: {
  archiveName: string;
  clips: ClipRecord[];
}): Promise<{ zipPath: string; fileCount: number; fileSize: number }> {
  const { archiveName, clips } = params;
  const safeName = archiveName.replace(/[^a-zA-Z0-9_-]+/g, '_');
  const zipPath = path.join(DIRS.output, `${safeName}.zip`);

  const readyClips = clips.filter(
    (c) => c.status === 'completed' && c.videoPath && fs.existsSync(c.videoPath)
  );

  if (readyClips.length === 0) {
    throw new Error('No completed MP4 clips are available to package into a ZIP archive.');
  }

  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = new ZipArchive({ zlib: { level: 6 } });

    output.on('close', () => resolve());
    output.on('error', (err: Error) => reject(err));
    archive.on('error', (err: Error) => reject(err));

    archive.pipe(output);

    readyClips.forEach((clip, idx) => {
      if (!clip.videoPath) return;
      const slug = clip.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40);
      const entryName = `${String(idx + 1).padStart(2, '0')}_${slug || clip.id}.mp4`;
      archive.file(clip.videoPath, { name: entryName });

      if (clip.srtPath && fs.existsSync(clip.srtPath)) {
        archive.file(clip.srtPath, {
          name: `subtitles/${String(idx + 1).padStart(2, '0')}_${slug || clip.id}.srt`,
        });
      }
    });

    void archive.finalize();
  });

  const stat = fs.statSync(zipPath);
  return { zipPath, fileCount: readyClips.length, fileSize: stat.size };
}
