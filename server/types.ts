export type AspectRatio = '9:16' | '1:1' | '16:9';
export type OutputResolution = '1080x1920' | '720x1280' | '1080x1080' | '1920x1080';
export type CropMode = 'center' | 'split_screen' | 'blurred_bg' | 'subject_aware';
export type JobClipMode = 'auto_ai' | 'portion_single' | 'portion_multi';
export type SelectionFocus =
  | 'best_moments'
  | 'educational'
  | 'funny'
  | 'storytelling'
  | 'motivational'
  | 'podcast_highlights'
  | 'custom';

export type CaptionPresetId =
  | 'viral_yellow'
  | 'mrbeast'
  | 'hormozi'
  | 'karaoke'
  | 'podcast'
  | 'minimal_white'
  | 'custom';

export type JobStatus =
  | 'uploaded'
  | 'queued'
  | 'analyzing'
  | 'transcribing'
  | 'selecting_clips'
  | 'generating_captions'
  | 'rendering'
  | 'packaging'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ClipStatus = 'pending' | 'rendering' | 'completed' | 'failed';

export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  words: TranscriptWord[];
}

export interface TranscriptData {
  language: string;
  duration: number;
  hasSpeech: boolean;
  segments: TranscriptSegment[];
}

export interface CaptionStyleConfig {
  preset: CaptionPresetId;
  font: string;
  fontSize: number;
  primaryColor: string;
  highlightColor: string;
  outlineColor: string;
  outlineWidth: number;
  shadowDepth: number;
  position: 'bottom' | 'middle' | 'top';
  wordsPerLine: number;
  animationIntensity: 'none' | 'subtle' | 'high';
  uppercase: boolean;
}

export interface SplitRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface EffectsConfig {
  cropMode: CropMode;
  splitTopRegion?: SplitRegion;
  splitTopRatio?: number;
  subtleZoomIn: boolean;
  zoomOut: boolean;
  fadeInOut: boolean;
  audioNormalize: boolean;
}

export interface PortionRange {
  start: number;
  end: number;
}

export interface JobConfig {
  clipMode?: JobClipMode;
  portionRange?: PortionRange;
  clipCount: number;
  minDuration: number;
  maxDuration: number;
  aspectRatio: AspectRatio;
  outputResolution: OutputResolution;
  selectionFocus: SelectionFocus;
  customInstructions: string;
  captionStyle: CaptionStyleConfig;
  effects: EffectsConfig;
}

export interface VideoRecord {
  id: string;
  originalFilename: string;
  safeFilename: string;
  filePath: string;
  fileSize: number;
  duration: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  audioCodec: string | null;
  bitrate: number;
  hasAudio: boolean;
  audioStreams: number;
  formatName: string;
  createdAt: string;
}

export interface JobRecord {
  id: string;
  videoId: string;
  videoFilename?: string;
  videoDuration?: number;
  status: JobStatus;
  progressPct: number;
  stageMessage: string;
  config: JobConfig;
  transcriptPath: string | null;
  scenes: number[];
  totalClips: number;
  completedClips: number;
  failedClips: number;
  zipPath: string | null;
  aiNotes: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface ClipRecord {
  id: string;
  jobId: string;
  videoId: string;
  clipIndex: number;
  title: string;
  hook: string;
  reason: string;
  category: string;
  score: number;
  startTime: number;
  endTime: number;
  duration: number;
  status: ClipStatus;
  videoPath: string | null;
  thumbnailPath: string | null;
  assPath: string | null;
  srtPath: string | null;
  fileSize: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AiProviderMode =
  | 'gemini_with_ollama_fallback'
  | 'ollama_only'
  | 'gemini_only';

export interface AppSettings {
  ai: {
    provider: AiProviderMode;
    model: string;
    ollamaBaseUrl: string;
    ollamaModel: string;
    defaultInstructions: string;
    maxClips: number;
    geminiKeyConfigured: boolean;
  };
  whisper: {
    modelSize: 'tiny' | 'base' | 'small' | 'medium';
    device: 'cpu' | 'cuda';
    computeType: 'int8' | 'float16' | 'float32';
    language: string;
    cpuThreads: number;
  };
  video: {
    defaultResolution: OutputResolution;
    fps: number;
    crf: number;
    preset: 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium';
    audioBitrate: string;
  };
  caption: CaptionStyleConfig;
  storage: {
    storageRoot: string;
    retentionDays: number;
    maxUploadMb: number;
    minFreeDiskMb: number;
  };
}

export interface StorageStats {
  totalDiskBytes: number;
  freeDiskBytes: number;
  usedDiskBytes: number;
  directories: {
    uploads: number;
    clips: number;
    subtitles: number;
    thumbnails: number;
    output: number;
    temp: number;
    logs: number;
  };
  totalStudioBytes: number;
  lowDiskWarning: boolean;
}
