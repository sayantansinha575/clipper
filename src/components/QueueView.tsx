import {
  AlertCircle,
  Archive,
  CheckCircle2,
  Clock,
  Film,
  ListChecks,
  Loader2,
  XCircle,
} from 'lucide-react';
import {
  formatDuration,
  formatJobStatusLabel,
  formatRelativeDate,
  isActiveJobStatus,
} from '../lib/format';
import type { JobItem, JobStatus } from '../types';

interface QueueViewProps {
  jobs: JobItem[];
  onCancelJob: (jobId: string) => void;
  onViewJobClips: (jobId: string) => void;
}

const PIPELINE_STEPS: Array<{ key: JobStatus; label: string }> = [
  { key: 'analyzing', label: 'Analyze' },
  { key: 'transcribing', label: 'Transcribe' },
  { key: 'selecting_clips', label: 'Select AI' },
  { key: 'generating_captions', label: 'ASS Captions' },
  { key: 'rendering', label: 'Render MP4' },
  { key: 'packaging', label: 'Package ZIP' },
  { key: 'completed', label: 'Done' },
];

function stepIndex(status: JobStatus): number {
  const idx = PIPELINE_STEPS.findIndex((s) => s.key === status);
  return idx;
}

export function QueueView({ jobs, onCancelJob, onViewJobClips }: QueueViewProps) {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-[#FAFAFA]">
          Processing Queue
        </h1>
        <p className="text-sm text-[#A1A1AA] mt-1">
          Real-time Server-Sent Events (SSE) progress across sequential CPU rendering jobs.
        </p>
      </div>

      {jobs.length === 0 ? (
        <div className="bg-[#18181B] border border-zinc-800/80 rounded-xl p-12 text-center">
          <ListChecks className="w-8 h-8 text-zinc-600 mx-auto mb-3" />
          <div className="text-sm font-medium text-[#FAFAFA]">Processing queue is empty</div>
          <p className="text-xs text-[#A1A1AA] mt-1">
            Jobs persist in SQLite and automatically recover if the server restarts mid-render.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {jobs.map((job) => {
            const active = isActiveJobStatus(job.status);
            const currentIdx = stepIndex(job.status);
            return (
              <div
                key={job.id}
                className="bg-[#18181B] border border-zinc-800/80 rounded-xl p-6 space-y-4"
              >
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2.5">
                      {job.status === 'completed' ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                      ) : job.status === 'failed' || job.status === 'cancelled' ? (
                        <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                      ) : active ? (
                        <Loader2 className="w-4 h-4 text-[#06B6D4] animate-spin shrink-0" />
                      ) : (
                        <Clock className="w-4 h-4 text-[#A1A1AA] shrink-0" />
                      )}
                      <h2 className="font-display text-base font-semibold text-[#FAFAFA] truncate">
                        {job.videoFilename || job.videoId}
                      </h2>
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-[#A1A1AA]">
                      <span className="font-mono text-[#FAFAFA]">{job.id}</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatJobStatusLabel(job.status)}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {job.completedClips}/{job.totalClips || job.config.clipCount} clips
                      </span>
                      {job.failedClips > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-red-400 font-mono tabular-nums">
                            {job.failedClips} failed
                          </span>
                        </>
                      )}
                      {job.videoDuration && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">
                            Source {formatDuration(job.videoDuration)}
                          </span>
                        </>
                      )}
                      <span aria-hidden="true">·</span>
                      <span>{formatRelativeDate(job.createdAt)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    {active && (
                      <button
                        type="button"
                        onClick={() => onCancelJob(job.id)}
                        className="px-3.5 py-2 rounded-lg border border-red-500/40 text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors"
                      >
                        Cancel Job
                      </button>
                    )}
                    {job.completedClips > 0 && (
                      <button
                        type="button"
                        onClick={() => onViewJobClips(job.id)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-xs font-medium text-white transition-colors"
                      >
                        <Film className="w-3.5 h-3.5" />
                        View Clips
                      </button>
                    )}
                    {job.hasZip && (
                      <a
                        href={`/api/jobs/${job.id}/zip`}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-zinc-700 hover:border-zinc-500 text-xs font-medium text-[#06B6D4] transition-colors"
                      >
                        <Archive className="w-3.5 h-3.5" />
                        Download ZIP
                      </a>
                    )}
                  </div>
                </div>

                {/* Progress Bar */}
                <div>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="text-[#A1A1AA] truncate pr-4">
                      {job.stageMessage || 'Waiting in queue'}
                    </span>
                    <span className="font-mono tabular-nums text-[#FAFAFA] shrink-0">
                      {Math.round(job.progressPct)}%
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-[#09090B] border border-zinc-800 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        job.status === 'failed'
                          ? 'bg-red-500'
                          : job.status === 'completed'
                          ? 'bg-emerald-500'
                          : 'bg-[#8B5CF6]'
                      }`}
                      style={{ width: `${Math.max(2, Math.min(100, job.progressPct))}%` }}
                    />
                  </div>
                </div>

                {/* Stage Stepper */}
                <div className="grid grid-cols-7 gap-2 pt-1">
                  {PIPELINE_STEPS.map((step, i) => {
                    const done =
                      job.status === 'completed' || (currentIdx >= 0 && i < currentIdx);
                    const current = currentIdx === i && job.status !== 'completed';
                    return (
                      <div key={step.key} className="text-center">
                        <div
                          className={`h-1 rounded-full mb-1.5 ${
                            done
                              ? 'bg-emerald-500'
                              : current
                              ? 'bg-[#06B6D4]'
                              : 'bg-zinc-800'
                          }`}
                        />
                        <div
                          className={`text-[11px] truncate ${
                            done || current ? 'text-[#FAFAFA] font-medium' : 'text-zinc-500'
                          }`}
                        >
                          {step.label}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {job.aiNotes && (
                  <div className="text-xs text-[#A1A1AA] pt-2 border-t border-zinc-800/60">
                    AI Selection Notes: {job.aiNotes}
                  </div>
                )}

                {job.errorMessage && (
                  <div className="flex items-center gap-2 text-xs text-red-400 pt-2 border-t border-zinc-800/60">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{job.errorMessage}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
