'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, AlertTriangle, CheckCircle, Lightbulb, RefreshCw } from 'lucide-react';
import { useCVStore } from '@/store/cvStore';
import { useHistoryStore } from '@/store/historyStore';
import { pollJobStatus } from '@/lib/api';
import { ATSScoreCard } from '@/components/analysis/ATSScoreCard';
import { KeywordChips } from '@/components/analysis/KeywordChips';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';

interface AnalysisPageProps {
  params: { jobId: string };
}

function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <Card>
      <CardContent className="space-y-3 py-6">
        <div className="h-4 w-1/3 animate-pulse rounded bg-slate-200" />
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="h-3 animate-pulse rounded bg-slate-100" style={{ width: `${70 + i * 8}%` }} />
        ))}
      </CardContent>
    </Card>
  );
}

export default function AnalysisPage({ params }: AnalysisPageProps) {
  const { jobId } = params;
  const router = useRouter();
  const { optimizationJob, updateOptimizationJob, jd } = useCVStore();
  const updateHistoryEntry = useHistoryStore((s) => s.updateEntry);

  const job = optimizationJob?.id === jobId ? optimizationJob : null;
  const isPending = !job || job.status === 'pending' || job.status === 'processing';
  const isCompleted = job?.status === 'completed';
  const isFailed = job?.status === 'failed';
  const company = jd?.company?.trim();

  useEffect(() => {
    if (!isPending) return;

    // Single self-scheduling poller: each tick waits for its response before scheduling
    // the next, so slow responses can't pile up overlapping requests. The `active` flag
    // ensures a duplicate mount (React StrictMode in dev) or unmount can't leave a second
    // poller running — which is what caused the bursts of optimize calls.
    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      try {
        const updated = await pollJobStatus(jobId);
        if (!active) return;
        updateOptimizationJob(updated);
        if (updated.status === 'completed' || updated.status === 'failed') return; // stop
      } catch {
        // silent — retry on the next tick
      }
      if (active) timer = setTimeout(tick, 10_000);
    };

    tick(); // immediate first check, then self-schedules every 10s

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [isPending, jobId, updateOptimizationJob]);

  const atsScore = job?.result?.atsScore;

  // Backfill the optimized ATS score into the saved history entry once available.
  useEffect(() => {
    if (isCompleted && typeof atsScore?.score === 'number') {
      updateHistoryEntry(jobId, { atsScore: atsScore.score });
    }
  }, [isCompleted, atsScore?.score, jobId, updateHistoryEntry]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            ATS Analysis{company ? <span className="text-slate-400 font-semibold"> · {company}</span> : null}
          </h1>
          <p className="text-sm text-slate-500">Job ID: {jobId}</p>
        </div>
        <div className="flex items-center gap-2">
          {isPending && (
            <Badge variant="warning" className="flex items-center gap-1.5">
              <RefreshCw size={11} className="animate-spin" />
              {job?.status === 'processing' ? 'Optimizing…' : 'Pending…'}
            </Badge>
          )}
          {isCompleted && (
            <Badge variant="success" className="flex items-center gap-1.5">
              <CheckCircle size={11} />
              Complete
            </Badge>
          )}
          {isFailed && (
            <Badge variant="danger" className="flex items-center gap-1.5">
              <AlertTriangle size={11} />
              Failed
            </Badge>
          )}
        </div>
      </div>

      {/* Failed state */}
      {isFailed && (
        <Card className="mb-6 border-red-200 bg-red-50">
          <CardContent className="flex items-start gap-3 py-5">
            <AlertTriangle size={20} className="text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-red-700">Optimization failed</p>
              <p className="text-sm text-red-600 mt-1">{job?.error ?? 'An unknown error occurred.'}</p>
              <Link href="/upload" className="mt-3 inline-block">
                <Button variant="danger" size="sm">Try Again</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loading skeleton */}
      {isPending && (
        <div className="space-y-6">
          <div className="rounded-2xl bg-gradient-to-br from-primary-50 to-blue-50 border border-primary-100 px-6 py-8 text-center">
            <div className="flex flex-col items-center gap-4">
              <div className="relative flex h-16 w-16 items-center justify-center">
                <div className="absolute inset-0 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
                <RefreshCw size={22} className="text-primary-500" />
              </div>
              <div>
                <p className="font-semibold text-primary-800 text-lg">
                  {job?.status === 'processing' ? 'AI is rewriting your CV…' : 'Queued for processing…'}
                </p>
                <p className="text-sm text-primary-600 mt-1">
                  Analyzing keywords, scoring sections, and generating optimized content.
                </p>
              </div>
            </div>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            <SkeletonCard lines={5} />
            <SkeletonCard lines={8} />
          </div>
          <SkeletonCard lines={4} />
        </div>
      )}

      {/* Results */}
      {isCompleted && atsScore && (
        <div className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <ATSScoreCard score={atsScore} />
            <KeywordChips
              matched={atsScore.coveredKeywords ?? []}
              missing={atsScore.missingKeywords ?? []}
            />
          </div>

          {/* Weak sections */}
          {(atsScore.weakSections?.length ?? 0) > 0 && (
            <Card>
              <CardHeader title="Sections Needing Improvement" />
              <CardContent className="pt-2 pb-4">
                <ul className="space-y-2">
                  {(atsScore.weakSections ?? []).map((section) => (
                    <li key={section} className="flex items-center gap-3 rounded-lg border border-amber-100 bg-amber-50 px-4 py-2.5">
                      <AlertTriangle size={15} className="text-amber-500 shrink-0" />
                      <span className="text-sm font-medium text-amber-800 capitalize">{section}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Suggestions */}
          {(atsScore.suggestions?.length ?? 0) > 0 && (
            <Card>
              <CardHeader title="AI Recommendations" />
              <CardContent className="pt-2 pb-4">
                <ul className="space-y-2">
                  {(atsScore.suggestions ?? []).map((suggestion, idx) => (
                    <li
                      key={idx}
                      className={cn(
                        'flex items-start gap-3 rounded-lg px-4 py-3 text-sm',
                        idx % 2 === 0 ? 'bg-slate-50' : 'bg-white'
                      )}
                    >
                      <Lightbulb size={15} className="mt-0.5 text-primary-500 shrink-0" />
                      <span className="text-slate-700">{suggestion}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* CTA */}
          <div className="flex justify-center pt-2">
            <Link href={`/editor/${jobId}`}>
              <Button size="lg" icon={<ArrowRight size={18} />}>
                Open CV Editor
              </Button>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
