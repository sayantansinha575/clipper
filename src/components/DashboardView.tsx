import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Clock,
  Film,
  HardDrive,
  Loader2,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import {
  formatBytes,
  formatDuration,
  formatJobStatusLabel,
  formatRelativeDate,
  isActiveJobStatus,
} from '../lib/format';
import type { ClipItem, JobItem, NavSection, StorageStats, VideoItem } from '../types';

interface DashboardViewProps {
  videos: VideoItem[];
  jobs: JobItem[];
  clips: ClipItem[];
  storage: StorageStats | null;
  onNavigate: (section: NavSection) => void;
  onSelectJobClips: (jobId: string) => void;
  onCancelJob: (jobId: string) => void;
  onCleanupStorage: () => Promise<void>;
  cleaningStorage: boolean;
}

function StatusIcon({ status }: { status: JobItem['status'] }) {
  if (status === 'completed') {
    return <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />;
  }
  if (status === 'failed' || status === 'cancelled') {
    return <XCircle className="w-4 h-4 text-red-500 shrink-0" />;
  }
  if (isActiveJobStatus(status)) {
    return <Loader2 className="w-4 h-4 text-[#06B6D4] animate-spin shrink-0" />;
  }
  return <Clock className="w-4 h-4 text-[#A1A1AA] shrink-0" />;
}

export function DashboardView({
  videos,
  jobs,
  clips,
  storage,
  onNavigate,
  onSelectJobClips,
  onCancelJob,
  onCleanupStorage,
  cleaningStorage,
}: DashboardViewProps) {
  const completedJobs = jobs.filter((j) => j.status === 'completed').length;
  const activeJobs = jobs.filter((j) => isActiveJobStatus(j.status));
  const completedClipsCount = clips.filter((c) => c.status === 'completed').length;

  const freePct =
    storage && storage.totalDiskBytes > 0
      ? Math.round((storage.freeDiskBytes / storage.totalDiskBytes) * 100)
      : 0;

  return (
    <div className="space-y-8">
      {/* Top Action Strip */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-[#FAFAFA]">
            Studio Overview
          </h1>
          <p className="text-sm text-[#A1A1AA] mt-1">
            Monitor source videos, background FFmpeg rendering jobs, and local disk footprint.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('create')}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-sm font-medium transition-colors whitespace-nowrap shrink-0"
        >
          <Upload className="w-4 h-4" />
          Quick Upload Video
        </button>
      </div>

      {/* 4-Column Metric Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-[#18181B] border border-zinc-800/80 rounded-xl p-5">
          <div className="text-xs font-medium text-[#A1A1AA]">Total Projects</div>
          <div className="mt-2 font-mono tabular-nums text-3xl font-semibold text-[#FAFAFA]">
            {videos.length}
          </div>
          <div className="mt-1.5 text-xs text-[#A1A1AA]">
            Source videos inspected via FFprobe
          </div>
        </div>

        <div className="bg-[#18181B] border border-zinc-800/80 rounded-xl p-5">
          <div className="text-xs font-medium text-[#A1A1AA]">Videos Processed</div>
          <div className="mt-2 font-mono tabular-nums text-3xl font-semibold text-[#FAFAFA]">
            {completedJobs}
          </div>
          <div className="mt-1.5 text-xs text-[#A1A1AA]">
            Completed pipeline runs ({jobs.length} total)
          </div>
        </div>

        <div className="bg-[#18181B] border border-zinc-800/80 rounded-xl p-5">
          <div className="text-xs font-medium text-[#A1A1AA]">Total Clips Generated</div>
          <div className="mt-2 font-mono tabular-nums text-3xl font-semibold text-[#FAFAFA]">
            {completedClipsCount}
          </div>
          <div className="mt-1.5 text-xs text-[#A1A1AA]">
            Validated MP4 exports ready
          </div>
        </div>

        <div className="bg-[#18181B] border border-zinc-800/80 rounded-xl p-5">
          <div className="text-xs font-medium text-[#A1A1AA]">Processing Jobs</div>
          <div className="mt-2 font-mono tabular-nums text-3xl font-semibold text-[#FAFAFA]">
            {activeJobs.length}
          </div>
          <div className="mt-1.5 text-xs text-[#A1A1AA]">
            {activeJobs.length > 0 ? 'Sequential CPU worker active' : 'Worker idle'}
          </div>
        </div>
      </div>

      {/* Storage Usage Panel */}
      <div className="bg-[#18181B] border border-zinc-800/80 rounded-xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-5 border-b border-zinc-800/80">
          <div className="flex items-center gap-3">
            <HardDrive className="w-5 h-5 text-[#06B6D4] shrink-0" />
            <div>
              <h2 className="font-display text-base font-semibold text-[#FAFAFA]">
                Storage Usage & Disk Guard
              </h2>
              <p className="text-xs text-[#A1A1AA] mt-0.5">
                {storage
                  ? `${formatBytes(storage.freeDiskBytes)} free of ${formatBytes(
                      storage.totalDiskBytes
                    )} (${freePct}% available) · Studio assets ${formatBytes(
                      storage.totalStudioBytes
                    )}`
                  : 'Inspecting local disk storage...'}
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={cleaningStorage}
            onClick={onCleanupStorage}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-zinc-700 hover:border-zinc-600 text-xs font-medium text-[#FAFAFA] hover:bg-zinc-800/60 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {cleaningStorage ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Trash2 className="w-3.5 h-3.5" />
            )}
            Clean Temp & Expired ZIPs
          </button>
        </div>

        {storage?.lowDiskWarning && (
          <div className="mt-4 flex items-center gap-2.5 px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm text-amber-300">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              Low disk space warning: free space is below the configured safety threshold. Clean
              expired archives or remove unused source videos before starting new jobs.
            </span>
          </div>
        )}

        {storage && (
          <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            <div>
              <div className="text-xs text-[#A1A1AA]">Source Uploads</div>
              <div className="mt-1 font-mono tabular-nums text-sm font-medium text-[#FAFAFA]">
                {formatBytes(storage.directories.uploads)}
              </div>
            </div>
            <div>
              <div className="text-xs text-[#A1A1AA]">Rendered Clips</div>
              <div className="mt-1 font-mono tabular-nums text-sm font-medium text-[#FAFAFA]">
                {formatBytes(storage.directories.clips)}
              </div>
            </div>
            <div>
              <div className="text-xs text-[#A1A1AA]">ASS / SRT Subs</div>
              <div className="mt-1 font-mono tabular-nums text-sm font-medium text-[#FAFAFA]">
                {formatBytes(storage.directories.subtitles)}
              </div>
            </div>
            <div>
              <div className="text-xs text-[#A1A1AA]">Thumbnails</div>
              <div className="mt-1 font-mono tabular-nums text-sm font-medium text-[#FAFAFA]">
                {formatBytes(storage.directories.thumbnails)}
              </div>
            </div>
            <div>
              <div className="text-xs text-[#A1A1AA]">ZIP Archives</div>
              <div className="mt-1 font-mono tabular-nums text-sm font-medium text-[#FAFAFA]">
                {formatBytes(storage.directories.output)}
              </div>
            </div>
            <div>
              <div className="text-xs text-[#A1A1AA]">Temp Scratch</div>
              <div className="mt-1 font-mono tabular-nums text-sm font-medium text-[#FAFAFA]">
                {formatBytes(storage.directories.temp)}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Recent Projects Table */}
      <div className="bg-[#18181B] border border-zinc-800/80 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/80">
          <h2 className="font-display text-base font-semibold text-[#FAFAFA]">
            Recent Processing Jobs
          </h2>
          <button
            type="button"
            onClick={() => onNavigate('projects')}
            className="text-xs font-medium text-[#8B5CF6] hover:text-[#A78BFA] transition-colors whitespace-nowrap"
          >
            View all projects
          </button>
        </div>

        {jobs.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <Film className="w-8 h-8 text-zinc-600 mx-auto mb-3" />
            <div className="text-sm font-medium text-[#FAFAFA]">No processing jobs yet</div>
            <p className="text-xs text-[#A1A1AA] mt-1 max-w-md mx-auto">
              Upload a long-form MP4, MOV, MKV, or WEBM video to transcribe speech, select viral
              highlights with Gemini, and render 9:16 vertical shorts.
            </p>
            <button
              type="button"
              onClick={() => onNavigate('create')}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-medium transition-colors"
            >
              <Upload className="w-3.5 h-3.5" />
              Create First Shorts
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-800/80 text-xs font-medium text-[#A1A1AA]">
                  <th className="py-3 px-6">Source Video</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Duration</th>
                  <th className="py-3 px-4 text-right">Clips</th>
                  <th className="py-3 px-4 text-right">Progress</th>
                  <th className="py-3 px-4">Created</th>
                  <th className="py-3 px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 text-sm">
                {jobs.slice(0, 8).map((job) => (
                  <tr key={job.id} className="hover:bg-zinc-800/30 transition-colors">
                    <td className="py-3.5 px-6">
                      <div className="font-medium text-[#FAFAFA] truncate max-w-[240px]">
                        {job.videoFilename || job.videoId}
                      </div>
                      <div className="text-xs text-[#A1A1AA] truncate max-w-[260px]">
                        {job.config.aspectRatio} · {job.config.captionStyle.preset} ·{' '}
                        {job.stageMessage || 'Ready'}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span className="inline-flex items-center gap-2 text-xs font-medium text-[#FAFAFA]">
                        <StatusIcon status={job.status} />
                        {formatJobStatusLabel(job.status)}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-xs text-[#A1A1AA]">
                      {job.videoDuration ? formatDuration(job.videoDuration) : '—'}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-xs text-[#FAFAFA]">
                      {job.completedClips}/{job.totalClips || job.config.clipCount}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-xs text-[#FAFAFA]">
                      {Math.round(job.progressPct)}%
                    </td>
                    <td className="py-3.5 px-4 text-xs text-[#A1A1AA] whitespace-nowrap">
                      {formatRelativeDate(job.createdAt)}
                    </td>
                    <td className="py-3.5 px-6 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-3">
                        {isActiveJobStatus(job.status) && (
                          <button
                            type="button"
                            onClick={() => onCancelJob(job.id)}
                            className="text-xs font-medium text-red-400 hover:text-red-300"
                          >
                            Cancel
                          </button>
                        )}
                        {job.completedClips > 0 && (
                          <button
                            type="button"
                            onClick={() => onSelectJobClips(job.id)}
                            className="text-xs font-medium text-[#8B5CF6] hover:text-[#A78BFA]"
                          >
                            View Clips
                          </button>
                        )}
                        {job.hasZip && (
                          <a
                            href={`/api/jobs/${job.id}/zip`}
                            className="inline-flex items-center gap-1 text-xs font-medium text-[#06B6D4] hover:text-cyan-300"
                          >
                            <Archive className="w-3.5 h-3.5" />
                            ZIP
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
