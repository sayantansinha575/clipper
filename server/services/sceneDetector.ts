import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export async function detectSceneChanges(
  videoPath: string,
  threshold = 0.32,
  maxScenes = 120
): Promise<number[]> {
  try {
    // Use ffmpeg scene detection filter; showinfo prints pts_time to stderr
    const { stderr } = await execFileAsync(
      'ffmpeg',
      [
        '-i',
        videoPath,
        '-vf',
        `select='gt(scene,${threshold})',showinfo`,
        '-vsync',
        'vfr',
        '-f',
        'null',
        '-',
      ],
      { maxBuffer: 25 * 1024 * 1024, timeout: 120_000 }
    );

    const timestamps: number[] = [];
    const regex = /pts_time:([0-9]+(?:\.[0-9]+)?)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(stderr)) !== null) {
      const t = Number(match[1]);
      if (Number.isFinite(t)) {
        const rounded = Number(t.toFixed(2));
        if (timestamps.length === 0 || rounded - timestamps[timestamps.length - 1] >= 1.5) {
          timestamps.push(rounded);
        }
      }
      if (timestamps.length >= maxScenes) break;
    }
    return timestamps;
  } catch {
    // Graceful fallback if scene filter encounters odd stream metadata
    return [];
  }
}
