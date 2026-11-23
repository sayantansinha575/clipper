import fs from 'fs';
import path from 'path';
import type { AiProviderMode, AppSettings, CaptionPresetId, CaptionStyleConfig } from './types.ts';

const cwd = process.cwd();

export const STORAGE_ROOT = path.resolve(cwd, process.env.STORAGE_ROOT || './storage');
export const PORT = Number(process.env.PORT || 3000);
export const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 2048);
export const MIN_FREE_DISK_MB = Number(process.env.MIN_FREE_DISK_MB || 1024);
export const ADMIN_API_KEY = process.env.ADMIN_API_KEY || '';
export const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export const DIRS = {
  root: STORAGE_ROOT,
  uploads: path.join(STORAGE_ROOT, 'uploads'),
  output: path.join(STORAGE_ROOT, 'output'),
  temp: path.join(STORAGE_ROOT, 'temp'),
  clips: path.join(STORAGE_ROOT, 'clips'),
  subtitles: path.join(STORAGE_ROOT, 'subtitles'),
  thumbnails: path.join(STORAGE_ROOT, 'thumbnails'),
  logs: path.join(STORAGE_ROOT, 'logs'),
} as const;

export function ensureStorageDirectories(): void {
  for (const dir of Object.values(DIRS)) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

export function resolveSafePath(baseDir: string, targetName: string): string {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, path.basename(targetName));
  if (!resolvedTarget.startsWith(resolvedBase + path.sep) && resolvedTarget !== resolvedBase) {
    throw new Error('Invalid file path');
  }
  return resolvedTarget;
}

export const CAPTION_PRESETS: Record<CaptionPresetId, CaptionStyleConfig> = {
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

export function getDefaultSettings(): AppSettings {
  const envProvider = process.env.AI_PROVIDER as AiProviderMode | undefined;
  const provider: AiProviderMode =
    envProvider === 'ollama_only' ||
    envProvider === 'gemini_only' ||
    envProvider === 'gemini_with_ollama_fallback'
      ? envProvider
      : 'gemini_with_ollama_fallback';

  return {
    ai: {
      provider,
      model: process.env.GEMINI_MODEL || 'gemini-4-hydrogen',
      ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
      ollamaModel: process.env.OLLAMA_MODEL || 'qwen3.5:4b',
      defaultInstructions:
        'Select standalone moments with strong opening hooks, clear emotional or educational payoff, and complete sentences.',
      maxClips: 50,
      geminiKeyConfigured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'),
    },
    whisper: {
      modelSize: 'small',
      device: 'cpu',
      computeType: 'int8',
      language: 'auto',
      cpuThreads: 4,
    },
    video: {
      defaultResolution: '1080x1920',
      fps: 30,
      crf: 23,
      preset: 'veryfast',
      audioBitrate: '128k',
    },
    caption: { ...CAPTION_PRESETS.viral_yellow },
    storage: {
      storageRoot: DIRS.root,
      retentionDays: 14,
      maxUploadMb: MAX_UPLOAD_MB,
      minFreeDiskMb: MIN_FREE_DISK_MB,
    },
  };
}
