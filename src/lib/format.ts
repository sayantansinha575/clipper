import type { CaptionPresetId, CaptionStyleConfig, JobStatus } from '../types';

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const val = bytes / Math.pow(1024, idx);
  return `${val >= 100 || idx === 0 ? val.toFixed(0) : val.toFixed(1)} ${units[idx]}`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function formatBitrate(bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0) return 'N/A';
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)} Mbps`;
  return `${Math.round(bps / 1000)} kbps`;
}

export function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatJobStatusLabel(status: JobStatus): string {
  const labels: Record<JobStatus, string> = {
    uploaded: 'Uploaded',
    queued: 'Queued',
    analyzing: 'Analyzing Video',
    transcribing: 'Transcribing Speech',
    selecting_clips: 'Selecting Clips',
    generating_captions: 'Generating Captions',
    rendering: 'Rendering MP4s',
    packaging: 'Packaging ZIP',
    completed: 'Completed',
    failed: 'Failed',
    cancelled: 'Cancelled',
  };
  return labels[status] || status;
}

export function isActiveJobStatus(status: JobStatus): boolean {
  return (
    status === 'queued' ||
    status === 'analyzing' ||
    status === 'transcribing' ||
    status === 'selecting_clips' ||
    status === 'generating_captions' ||
    status === 'rendering' ||
    status === 'packaging'
  );
}

export const FRONTEND_CAPTION_PRESETS: Record<CaptionPresetId, CaptionStyleConfig> = {
  viral_yellow: {
    preset: 'viral_yellow',
    font: 'DejaVu Sans',
    fontSize: 64,
    primaryColor: '#FFFFFF',
    highlightColor: '#FACC15',
    outlineColor: '#000000',
    outlineWidth: 5,
    shadowDepth: 3,
    position: 'bottom',
    wordsPerLine: 3,
    animationIntensity: 'high',
    uppercase: true,
  },
  mrbeast: {
    preset: 'mrbeast',
    font: 'DejaVu Sans',
    fontSize: 72,
    primaryColor: '#FFFFFF',
    highlightColor: '#22C55E',
    outlineColor: '#000000',
    outlineWidth: 7,
    shadowDepth: 4,
    position: 'middle',
    wordsPerLine: 2,
    animationIntensity: 'high',
    uppercase: true,
  },
  hormozi: {
    preset: 'hormozi',
    font: 'Liberation Sans',
    fontSize: 66,
    primaryColor: '#FFFFFF',
    highlightColor: '#F59E0B',
    outlineColor: '#09090B',
    outlineWidth: 6,
    shadowDepth: 3,
    position: 'bottom',
    wordsPerLine: 3,
    animationIntensity: 'high',
    uppercase: true,
  },
  karaoke: {
    preset: 'karaoke',
    font: 'Noto Sans',
    fontSize: 58,
    primaryColor: '#E4E4E7',
    highlightColor: '#06B6D4',
    outlineColor: '#09090B',
    outlineWidth: 4,
    shadowDepth: 2,
    position: 'bottom',
    wordsPerLine: 4,
    animationIntensity: 'subtle',
    uppercase: false,
  },
  podcast: {
    preset: 'podcast',
    font: 'Noto Sans',
    fontSize: 54,
    primaryColor: '#FAFAFA',
    highlightColor: '#A855F7',
    outlineColor: '#000000',
    outlineWidth: 4,
    shadowDepth: 2,
    position: 'bottom',
    wordsPerLine: 4,
    animationIntensity: 'subtle',
    uppercase: false,
  },
  minimal_white: {
    preset: 'minimal_white',
    font: 'Liberation Sans',
    fontSize: 48,
    primaryColor: '#FFFFFF',
    highlightColor: '#FFFFFF',
    outlineColor: '#18181B',
    outlineWidth: 3,
    shadowDepth: 1,
    position: 'bottom',
    wordsPerLine: 4,
    animationIntensity: 'none',
    uppercase: false,
  },
  custom: {
    preset: 'custom',
    font: 'DejaVu Sans',
    fontSize: 60,
    primaryColor: '#FFFFFF',
    highlightColor: '#8B5CF6',
    outlineColor: '#000000',
    outlineWidth: 5,
    shadowDepth: 3,
    position: 'bottom',
    wordsPerLine: 3,
    animationIntensity: 'subtle',
    uppercase: true,
  },
};

export const CAPTION_PRESET_LABELS: Record<CaptionPresetId, string> = {
  viral_yellow: 'Viral Yellow',
  mrbeast: 'Bold Impact',
  hormozi: 'Punchy Highlight',
  karaoke: 'Karaoke Cyan',
  podcast: 'Podcast Clean',
  minimal_white: 'Minimal White',
  custom: 'Custom',
};
