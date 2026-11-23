import path from 'path';

export const ALLOWED_VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.webm']);

export function validateVideoExtension(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return ALLOWED_VIDEO_EXTENSIONS.has(ext);
}

export function sanitizeFilename(originalName: string): string {
  const ext = path.extname(originalName).toLowerCase();
  const base = path
    .basename(originalName, ext)
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  return `${base || 'video'}${ext}`;
}

export interface RawCandidateClip {
  start: number;
  end: number;
  title: string;
  hook: string;
  reason: string;
  category: string;
  score: number;
}

export interface ValidatedCandidateClip extends RawCandidateClip {
  duration: number;
}

function computeOverlapRatio(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  const intersection = Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
  if (intersection <= 0) return 0;
  const minLen = Math.min(aEnd - aStart, bEnd - bStart);
  return minLen > 0 ? intersection / minLen : 0;
}

export function validateClipTimestamps(
  candidates: RawCandidateClip[],
  videoDuration: number,
  minDuration: number,
  maxDuration: number,
  maxClips: number
): ValidatedCandidateClip[] {
  if (!Number.isFinite(videoDuration) || videoDuration <= 1) return [];

  const effectiveMin = Math.max(3, Math.min(minDuration, videoDuration));
  const effectiveMax = Math.max(effectiveMin, maxDuration);

  const normalized: ValidatedCandidateClip[] = [];

  for (const item of candidates) {
    let start = Number(item.start);
    let end = Number(item.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (start >= videoDuration || end <= 0) continue;

    start = Math.max(0, start);
    end = Math.min(videoDuration, end);
    if (start >= end) continue;

    let duration = end - start;

    // Trim gently if slightly above maxDuration
    if (duration > effectiveMax) {
      end = start + effectiveMax;
      duration = effectiveMax;
    }

    // Expand slightly if just under minDuration and video has room
    if (duration < effectiveMin && videoDuration >= effectiveMin) {
      const needed = effectiveMin - duration;
      const expandEnd = Math.min(videoDuration, end + needed);
      end = expandEnd;
      duration = end - start;
      if (duration < effectiveMin) {
        start = Math.max(0, end - effectiveMin);
        duration = end - start;
      }
    }

    if (duration < Math.min(effectiveMin, 4)) continue;

    normalized.push({
      start: Number(start.toFixed(2)),
      end: Number(end.toFixed(2)),
      duration: Number(duration.toFixed(2)),
      title: (item.title || 'Untitled Moment').trim().slice(0, 100),
      hook: (item.hook || '').trim().slice(0, 140),
      reason: (item.reason || '').trim().slice(0, 260),
      category: (item.category || 'highlight').trim().toLowerCase().slice(0, 40),
      score: Math.max(1, Math.min(100, Math.round(Number(item.score) || 75))),
    });
  }

  // Sort by score descending to prioritize highest quality non-overlapping clips
  normalized.sort((a, b) => b.score - a.score);

  const deduplicated: ValidatedCandidateClip[] = [];
  for (const clip of normalized) {
    const hasHeavyOverlap = deduplicated.some(
      (existing) => computeOverlapRatio(clip.start, clip.end, existing.start, existing.end) > 0.35
    );
    if (!hasHeavyOverlap) {
      deduplicated.push(clip);
    }
    if (deduplicated.length >= maxClips) break;
  }

  // Return in chronological order for natural review
  return deduplicated.sort((a, b) => a.start - b.start);
}
