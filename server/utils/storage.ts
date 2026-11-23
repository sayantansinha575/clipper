import fs from 'fs';
import path from 'path';
import { DIRS, MIN_FREE_DISK_MB, ensureStorageDirectories } from '../config.ts';
import type { StorageStats } from '../types.ts';

function getDirectorySize(dirPath: string): number {
  if (!fs.existsSync(dirPath)) return 0;
  let total = 0;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += getDirectorySize(full);
    } else if (entry.isFile()) {
      try {
        total += fs.statSync(full).size;
      } catch {
        // Ignore transient temp files removed mid-scan
      }
    }
  }
  return total;
}

export function getStorageStats(minFreeDiskMb = MIN_FREE_DISK_MB): StorageStats {
  ensureStorageDirectories();

  let totalDiskBytes = 0;
  let freeDiskBytes = 0;
  try {
    const statfs = fs.statfsSync(DIRS.root);
    totalDiskBytes = statfs.blocks * statfs.bsize;
    freeDiskBytes = statfs.bavail * statfs.bsize;
  } catch {
    totalDiskBytes = 0;
    freeDiskBytes = 0;
  }

  const directories = {
    uploads: getDirectorySize(DIRS.uploads),
    clips: getDirectorySize(DIRS.clips),
    subtitles: getDirectorySize(DIRS.subtitles),
    thumbnails: getDirectorySize(DIRS.thumbnails),
    output: getDirectorySize(DIRS.output),
    temp: getDirectorySize(DIRS.temp),
    logs: getDirectorySize(DIRS.logs),
  };

  const totalStudioBytes = Object.values(directories).reduce((acc, v) => acc + v, 0);
  const lowDiskWarning = freeDiskBytes > 0 && freeDiskBytes < minFreeDiskMb * 1024 * 1024;

  return {
    totalDiskBytes,
    freeDiskBytes,
    usedDiskBytes: Math.max(0, totalDiskBytes - freeDiskBytes),
    directories,
    totalStudioBytes,
    lowDiskWarning,
  };
}

export function estimateRequiredStorageBytes(sourceSizeBytes: number, clipCount: number): number {
  // Estimate ~10% for temp audio + ~8 MB per rendered vertical short + buffer for ZIP
  const audioTemp = Math.max(5 * 1024 * 1024, Math.round(sourceSizeBytes * 0.1));
  const clipsEstimate = Math.max(1, clipCount) * 8 * 1024 * 1024;
  return audioTemp + clipsEstimate;
}

export function checkDiskSpaceForJob(
  sourceSizeBytes: number,
  clipCount: number,
  minFreeDiskMb = MIN_FREE_DISK_MB
): { ok: boolean; freeBytes: number; requiredBytes: number; message?: string } {
  const stats = getStorageStats(minFreeDiskMb);
  const requiredBytes = estimateRequiredStorageBytes(sourceSizeBytes, clipCount);
  const minReserveBytes = minFreeDiskMb * 1024 * 1024;

  if (stats.freeDiskBytes > 0 && stats.freeDiskBytes < minReserveBytes + requiredBytes) {
    const freeMb = Math.round(stats.freeDiskBytes / (1024 * 1024));
    const needMb = Math.round((minReserveBytes + requiredBytes) / (1024 * 1024));
    return {
      ok: false,
      freeBytes: stats.freeDiskBytes,
      requiredBytes,
      message: `Insufficient disk space: ${freeMb} MB free, need at least ${needMb} MB including safety reserve.`,
    };
  }

  return {
    ok: true,
    freeBytes: stats.freeDiskBytes,
    requiredBytes,
  };
}
