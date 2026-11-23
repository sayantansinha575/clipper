import fs from 'fs';
import path from 'path';
import { DIRS } from '../config.ts';

export function removeFileIfExists(filePath: string | null | undefined): void {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.warn(`Cleanup warning removing ${filePath}:`, err);
  }
}

export function cleanupJobTempFiles(jobId: string): number {
  if (!fs.existsSync(DIRS.temp)) return 0;
  let removed = 0;
  for (const entry of fs.readdirSync(DIRS.temp)) {
    if (entry.startsWith(jobId)) {
      const target = path.join(DIRS.temp, entry);
      try {
        fs.rmSync(target, { recursive: true, force: true });
        removed += 1;
      } catch {
        // Ignore transient lock
      }
    }
  }
  return removed;
}

export function cleanupTempDirectory(olderThanMinutes = 0): number {
  if (!fs.existsSync(DIRS.temp)) return 0;
  const cutoff = Date.now() - olderThanMinutes * 60 * 1000;
  let removed = 0;
  for (const entry of fs.readdirSync(DIRS.temp)) {
    const target = path.join(DIRS.temp, entry);
    try {
      const st = fs.statSync(target);
      if (olderThanMinutes === 0 || st.mtimeMs < cutoff) {
        fs.rmSync(target, { recursive: true, force: true });
        removed += 1;
      }
    } catch {
      // Ignore
    }
  }
  return removed;
}

export function cleanupExpiredOutputs(retentionDays: number): number {
  if (retentionDays <= 0 || !fs.existsSync(DIRS.output)) return 0;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const entry of fs.readdirSync(DIRS.output)) {
    const target = path.join(DIRS.output, entry);
    try {
      const st = fs.statSync(target);
      if (st.isFile() && st.mtimeMs < cutoff) {
        fs.unlinkSync(target);
        removed += 1;
      }
    } catch {
      // Ignore
    }
  }
  return removed;
}
