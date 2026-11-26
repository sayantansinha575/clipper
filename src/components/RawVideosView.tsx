import { useState } from 'react';
import {
  HardDrive,
  Loader2,
  Play,
  Scissors,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import {
  formatBitrate,
  formatBytes,
  formatDuration,
  formatRelativeDate,
} from '../lib/format';
import type { JobItem, VideoItem } from '../types';

interface RawVideosViewProps {
  videos: VideoItem[];
  jobs: JobItem[];
  onAutoClipsFromVideo: (videoId: string) => void;
  onPortionClipFromVideo: (videoId: string) => void;
  onRefresh: () => Promise<void>;
}

export function RawVideosView({
  videos,
  jobs,
  onAutoClipsFromVideo,
  onPortionClipFromVideo,
  onRefresh,
}: RawVideosViewProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [previewVideo, setPreviewVideo] = useState<VideoItem | null>(null);

  const handleDelete = async (videoId: string) => {
    setDeletingId(videoId);
    try {
      await api.deleteVideo(videoId);
      await onRefresh();
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-[#FAFAFA]">
          Raw Videos Library
        </h1>
        <p className="text-sm text-[#A1A1AA] mt-1">
          Uploaded source videos stored on the server. Reuse any video for AI Auto Shorts or Select Portion clipping without re-uploading.
        </p>
      </div>

      {videos.length === 0 ? (
        <div className="bg-[#18181B] border border-zinc-800/80 rounded-xl p-12 text-center">
          <HardDrive className="w-8 h-8 text-zinc-600 mx-auto mb-3" />
          <div className="text-sm font-medium text-[#FAFAFA]">No raw videos stored yet</div>
          <p className="text-xs text-[#A1A1AA] mt-1">
            Upload a video in Create Shorts and it will remain available here for future edits.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {videos.map((video) => {
            const jobCount = jobs.filter((j) => j.videoId === video.id).length;
            return (
              <div
                key={video.id}
                className="bg-[#18181B] border border-zinc-800/80 rounded-xl overflow-hidden flex flex-col"
              >
                <div
                  className="relative aspect-video bg-zinc-950 cursor-pointer group"
                  onClick={() => setPreviewVideo(video)}
                >
                  <img
                    src={`/api/videos/${video.id}/preview-frame`}
                    alt={video.originalFilename}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                  <div className="absolute inset-0 bg-black/35 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                    <div className="w-10 h-10 rounded-full bg-black/70 border border-white/20 flex items-center justify-center text-white">
                      <Play className="w-4 h-4 ml-0.5" />
                    </div>
                  </div>
                  <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-black/80 font-mono text-[11px] text-white tabular-nums">
                    {formatDuration(video.duration)}
                  </div>
                </div>

                <div className="p-4 flex-1 flex flex-col justify-between space-y-4">
                  <div>
                    <h2
                      className="font-display text-sm font-semibold text-[#FAFAFA] truncate"
                      title={video.originalFilename}
                    >
                      {video.originalFilename}
                    </h2>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#A1A1AA] font-mono tabular-nums">
                      <span>
                        {video.width}×{video.height}
                      </span>
                      <span>·</span>
                      <span>{formatBytes(video.fileSize)}</span>
                      <span>·</span>
                      <span>{formatBitrate(video.bitrate)}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-[#A1A1AA]">
                      Uploaded {formatRelativeDate(video.createdAt)} · {jobCount} job
                      {jobCount === 1 ? '' : 's'}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-zinc-800/80">
                    <button
                      type="button"
                      onClick={() => onAutoClipsFromVideo(video.id)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-medium transition-colors whitespace-nowrap"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      AI Shorts
                    </button>
                    <button
                      type="button"
                      onClick={() => onPortionClipFromVideo(video.id)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-zinc-700 hover:border-[#06B6D4] bg-[#09090B] text-[#FAFAFA] text-xs font-medium transition-colors whitespace-nowrap"
                    >
                      <Scissors className="w-3.5 h-3.5 text-[#06B6D4]" />
                      Select Portion
                    </button>
                    <button
                      type="button"
                      disabled={deletingId === video.id}
                      onClick={() => void handleDelete(video.id)}
                      title="Delete stored raw video"
                      className="p-2 rounded-lg border border-zinc-800 hover:border-red-500/50 text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                    >
                      {deletingId === video.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {previewVideo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4">
          <div className="bg-[#18181B] border border-zinc-800 rounded-xl w-full max-w-3xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800">
              <div className="min-w-0 pr-4">
                <h3 className="font-display text-sm font-semibold text-[#FAFAFA] truncate">
                  {previewVideo.originalFilename}
                </h3>
                <div className="text-xs text-[#A1A1AA] font-mono tabular-nums mt-0.5">
                  {formatDuration(previewVideo.duration)} · {previewVideo.width}×{previewVideo.height} ·{' '}
                  {formatBytes(previewVideo.fileSize)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPreviewVideo(null)}
                className="p-1.5 rounded-lg text-[#A1A1AA] hover:text-[#FAFAFA] hover:bg-zinc-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="bg-black flex items-center justify-center">
              <video
                src={`/api/videos/${previewVideo.id}/stream`}
                controls
                autoPlay
                className="w-full max-h-[65vh]"
              />
            </div>
            <div className="px-5 py-3.5 border-t border-zinc-800 flex flex-wrap justify-end gap-2.5">
              <button
                type="button"
                onClick={() => {
                  const id = previewVideo.id;
                  setPreviewVideo(null);
                  onPortionClipFromVideo(id);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-zinc-700 hover:border-[#06B6D4] text-xs font-medium text-[#FAFAFA]"
              >
                <Scissors className="w-3.5 h-3.5 text-[#06B6D4]" />
                Select Portion & Clip
              </button>
              <button
                type="button"
                onClick={() => {
                  const id = previewVideo.id;
                  setPreviewVideo(null);
                  onAutoClipsFromVideo(id);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-xs font-medium text-white"
              >
                <Sparkles className="w-3.5 h-3.5" />
                AI Auto Shorts
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
