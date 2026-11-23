import { execFile } from 'child_process';
import fs from 'fs';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface VideoProbeMetadata {
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
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  bit_rate?: string;
}

interface FfprobeResponse {
  streams?: FfprobeStream[];
  format?: {
    duration?: string;
    bit_rate?: string;
    format_name?: string;
  };
}

function parseFrameRate(rateStr?: string): number {
  if (!rateStr) return 0;
  const parts = rateStr.split('/');
  if (parts.length === 2) {
    const num = Number(parts[0]);
    const den = Number(parts[1]);
    if (den > 0 && Number.isFinite(num)) {
      return Number((num / den).toFixed(2));
    }
  }
  const parsed = Number(rateStr);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
}

export async function probeVideo(filePath: string): Promise<VideoProbeMetadata> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Video file not found: ${filePath}`);
  }

  const { stdout } = await execFileAsync(
    'ffprobe',
    ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath],
    { maxBuffer: 10 * 1024 * 1024 }
  );

  const parsed = JSON.parse(stdout) as FfprobeResponse;
  const streams = parsed.streams || [];
  const videoStream = streams.find((s) => s.codec_type === 'video');
  const audioStreamsList = streams.filter((s) => s.codec_type === 'audio');

  if (!videoStream) {
    throw new Error('No video stream found in uploaded media file.');
  }

  const duration = Number(parsed.format?.duration || 0);
  const fps =
    parseFrameRate(videoStream.avg_frame_rate) ||
    parseFrameRate(videoStream.r_frame_rate) ||
    30;

  return {
    duration: Number.isFinite(duration) ? Number(duration.toFixed(2)) : 0,
    width: Number(videoStream.width || 0),
    height: Number(videoStream.height || 0),
    fps,
    videoCodec: videoStream.codec_name || 'unknown',
    audioCodec: audioStreamsList[0]?.codec_name || null,
    bitrate: Number(parsed.format?.bit_rate || videoStream.bit_rate || 0),
    hasAudio: audioStreamsList.length > 0,
    audioStreams: audioStreamsList.length,
    formatName: parsed.format?.format_name || 'unknown',
  };
}

export async function validateRenderedVideo(filePath: string): Promise<{
  valid: boolean;
  fileSize: number;
  metadata?: VideoProbeMetadata;
  error?: string;
}> {
  try {
    if (!fs.existsSync(filePath)) {
      return { valid: false, fileSize: 0, error: 'Output MP4 file does not exist.' };
    }
    const stat = fs.statSync(filePath);
    if (stat.size < 1024) {
      return { valid: false, fileSize: stat.size, error: 'Output MP4 file is empty or corrupted.' };
    }
    const metadata = await probeVideo(filePath);
    if (metadata.duration <= 0 || metadata.width <= 0 || metadata.height <= 0) {
      return { valid: false, fileSize: stat.size, error: 'Invalid video stream dimensions or duration.' };
    }
    return { valid: true, fileSize: stat.size, metadata };
  } catch (err) {
    return {
      valid: false,
      fileSize: 0,
      error: err instanceof Error ? err.message : 'FFprobe validation failed',
    };
  }
}
