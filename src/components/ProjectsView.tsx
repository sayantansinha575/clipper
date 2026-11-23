import { useState } from 'react';
import {
  FileText,
  Film,
  FolderKanban,
  Loader2,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import {
  formatBytes,
  formatDuration,
  formatJobStatusLabel,
  formatRelativeDate,
} from '../lib/format';
import type { JobItem, TranscriptData, VideoItem } from '../types';

interface ProjectsViewProps {
  videos: VideoItem[];
  jobs: JobItem[];
  onCreateFromVideo: (videoId: string) => void;
  onViewJobClips: (jobId: string) => void;
  onRefresh: () => Promise<void>;
}

export function ProjectsView({
  videos,
  jobs,
  onCreateFromVideo,
  onViewJobClips,
  onRefresh,
}: ProjectsViewProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [transcriptModal, setTranscriptModal] = useState<{
    title: string;
    data: TranscriptData;
  } | null>(null);
  const [loadingTranscript, setLoadingTranscript] = useState(false);

  const handleDeleteVideo = async (videoId: string) => {
    setDeletingId(videoId);
    try {
      await api.deleteVideo(videoId);
      await onRefresh();
    } finally {
      setDeletingId(null);
    }
  };

  const handleOpenTranscript = async (job: JobItem) => {
    setLoadingTranscript(true);
    try {
      const { transcript } = await api.getJobTranscript(job.id);
      setTranscriptModal({
        title: job.videoFilename || job.id,
        data: transcript,
      });
    } finally {
      setLoadingTranscript(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-[#FAFAFA]">
          Projects & Source Videos
        </h1>
        <p className="text-sm text-[#A1A1AA] mt-1">
          Inspect uploaded source videos, browse speech transcripts, or start a new clipping job on
          an existing video.
        </p>
      </div>

      {videos.length === 0 ? (
        <div className="bg-[#18181B] border border-zinc-800/80 rounded-xl p-12 text-center">
          <FolderKanban className="w-8 h-8 text-zinc-600 mx-auto mb-3" />
          <div className="text-sm font-medium text-[#FAFAFA]">No uploaded source videos</div>
          <p className="text-xs text-[#A1A1AA] mt-1">
            Uploaded videos are stored safely until you explicitly delete them.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {videos.map((video) => {
            const videoJobs = jobs.filter((j) => j.videoId === video.id);
            return (
              <div
                key={video.id}
                className="bg-[#18181B] border border-zinc-800/80 rounded-xl p-6"
              >
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="font-display text-base font-semibold text-[#FAFAFA] truncate">
                      {video.originalFilename}
                    </h2>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#A1A1AA] font-mono tabular-nums">
                      <span>{formatDuration(video.duration)}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {video.width}×{video.height}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{video.fps} FPS</span>
                      <span aria-hidden="true">·</span>
                      <span>{video.videoCodec}</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatBytes(video.fileSize)}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-sans">{formatRelativeDate(video.createdAt)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      type="button"
                      onClick={() => onCreateFromVideo(video.id)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-medium transition-colors whitespace-nowrap"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      New Clip Job
                    </button>
                    <button
                      type="button"
                      disabled={deletingId === video.id}
                      onClick={() => void handleDeleteVideo(video.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-zinc-700 hover:border-red-500/50 text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50 whitespace-nowrap"
                    >
                      {deletingId === video.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                      Delete Video
                    </button>
                  </div>
                </div>

                {videoJobs.length > 0 && (
                  <div className="mt-5 pt-4 border-t border-zinc-800/80 space-y-2.5">
                    {videoJobs.map((job) => (
                      <div
                        key={job.id}
                        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 py-2 text-xs"
                      >
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[#A1A1AA]">
                          <span className="font-mono text-[#FAFAFA]">{job.id}</span>
                          <span aria-hidden="true">·</span>
                          <span className="text-[#FAFAFA] font-medium">
                            {formatJobStatusLabel(job.status)}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">
                            {job.completedClips}/{job.totalClips || job.config.clipCount} clips
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {job.config.aspectRatio} / {job.config.captionStyle.preset}
                          </span>
                        </div>

                        <div className="flex items-center gap-4 shrink-0">
                          {job.hasTranscript && (
                            <button
                              type="button"
                              disabled={loadingTranscript}
                              onClick={() => void handleOpenTranscript(job)}
                              className="inline-flex items-center gap-1 text-[#06B6D4] hover:text-cyan-300 font-medium"
                            >
                              <FileText className="w-3.5 h-3.5" />
                              Transcript
                            </button>
                          )}
                          {job.completedClips > 0 && (
                            <button
                              type="button"
                              onClick={() => onViewJobClips(job.id)}
                              className="inline-flex items-center gap-1 text-[#8B5CF6] hover:text-[#A78BFA] font-medium"
                            >
                              <Film className="w-3.5 h-3.5" />
                              Open Clips
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Transcript Modal */}
      {transcriptModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="bg-[#18181B] border border-zinc-800 rounded-xl w-full max-w-2xl max-h-[82vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
              <div>
                <h3 className="font-display text-base font-semibold text-[#FAFAFA]">
                  Transcript · {transcriptModal.title}
                </h3>
                <p className="text-xs text-[#A1A1AA] mt-0.5 font-mono tabular-nums">
                  Language: {transcriptModal.data.language} ·{' '}
                  {transcriptModal.data.segments.length} segments
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTranscriptModal(null)}
                className="p-1.5 rounded-lg text-[#A1A1AA] hover:text-[#FAFAFA] hover:bg-zinc-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto space-y-3 text-sm">
              {transcriptModal.data.segments.length === 0 ? (
                <div className="text-center text-[#A1A1AA] py-8">
                  No spoken speech detected in this video.
                </div>
              ) : (
                transcriptModal.data.segments.map((seg, i) => (
                  <div key={i} className="flex gap-4 py-2 border-b border-zinc-800/60">
                    <span className="font-mono tabular-nums text-xs text-[#06B6D4] w-24 shrink-0 pt-0.5">
                      {formatDuration(seg.start)}–{formatDuration(seg.end)}
                    </span>
                    <span className="text-[#FAFAFA] leading-relaxed">{seg.text}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
