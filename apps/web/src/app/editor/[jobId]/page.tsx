'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  FileDown,
  FileText,
  ArrowLeft,
  Columns2,
  CheckCheck,
  X,
  Eye,
  GitCompare,
  Wand2,
  ListChecks,
  Trash2,
  HelpCircle,
  RotateCw,
} from 'lucide-react';
import { useCVStore } from '@/store/cvStore';
import { pollJobStatus, exportPDF, exportDOCX, startModification } from '@/lib/api';
import { SectionDiff } from '@/components/editor/SectionDiff';
import {
  CvPage,
  FormattedCv,
  FormattedBlocks,
  PaginatedCv,
  SectionHeading,
  sectionLabel,
  sortByPdfOrder,
} from '@/components/editor/CvPaper';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { CircularProgressWithCenter } from '@/components/ui/CircularProgress';
import type { CVSection, SectionDiff as SectionDiffData } from '@/lib/types';
import type { DiffDecision } from '@/lib/diff';
import { diffBlocks, resolveBlocks, blockHunkIds, type BlockOp } from '@/lib/blockDiff';
import { formatSection } from '@/lib/cvFormat';
import { downloadBlob, cn } from '@/lib/utils';

interface EditorPageProps {
  params: { jobId: string };
}

type RightView = 'review' | 'preview';

export default function EditorPage({ params }: EditorPageProps) {
  const { jobId } = params;
  const router = useRouter();
  const {
    optimizationJob,
    setOptimizationJob,
    diffDecisions,
    setDiffDecision,
    setManyDecisions,
    config,
  } = useCVStore();

  const [rightView, setRightView] = useState<RightView>('review');
  const [isExportingPDF, setIsExportingPDF] = useState(false);
  const [isExportingDOCX, setIsExportingDOCX] = useState(false);
  const [showChanges, setShowChanges] = useState(false);
  const [moreNotes, setMoreNotes] = useState('');
  const [isRerunning, setIsRerunning] = useState(false);

  const job = optimizationJob?.id === jobId ? optimizationJob : null;

  // Poll until the job has a result. Covers the modify flow (which routes here
  // straight from /modify with a pending job) and reloads on an unfinished job.
  const hasResult = !!job?.result;
  useEffect(() => {
    if (hasResult || !jobId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const fresh = await pollJobStatus(jobId);
        if (cancelled) return;
        setOptimizationJob(fresh);
        if (fresh.status === 'pending' || fresh.status === 'processing') {
          timer = setTimeout(tick, 2000);
        }
      } catch {
        if (!cancelled) timer = setTimeout(tick, 3000);
      }
    };
    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobId, hasResult, setOptimizationJob]);

  // Block-level diff ops per changed section (structured: bullets/entries/paragraph).
  const opsBySection = useMemo<Record<string, BlockOp[]>>(() => {
    const out: Record<string, BlockOp[]> = {};
    const diffs: SectionDiffData[] = job?.result?.diff ?? [];
    for (const d of diffs) out[d.sectionType] = diffBlocks(d.sectionType, d.original, d.optimized);
    return out;
  }, [job?.result?.diff]);

  const allHunkIds = useMemo<string[]>(() => {
    const ids: string[] = [];
    for (const ops of Object.values(opsBySection)) ids.push(...blockHunkIds(ops));
    return ids;
  }, [opsBySection]);

  // Resolved sections (decisions applied) — used by the preview + export.
  const resolvedSections = useMemo<CVSection[]>(() => {
    const sections = job?.result?.optimizedSections ?? [];
    return sections.map((s) => {
      const ops = opsBySection[s.type];
      return ops ? { ...s, content: resolveBlocks(ops, diffDecisions) } : s;
    });
  }, [job?.result?.optimizedSections, opsBySection, diffDecisions]);

  if (!job) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center space-y-3">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600 mx-auto" />
          <p className="text-slate-500">Loading editor…</p>
        </div>
      </div>
    );
  }

  if (!job.result) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
        <p className="text-slate-600">
          {job.jdId === '' ? 'Updating your CV…' : 'Optimization is still in progress.'}
        </p>
        <Link href={job.jdId === '' ? `/modify/${job.cvId}` : `/analysis/${jobId}`}>
          <Button variant="secondary" icon={<ArrowLeft size={15} />}>
            {job.jdId === '' ? 'Back' : 'Back to Analysis'}
          </Button>
        </Link>
      </div>
    );
  }

  const { originalSections, optimizedSections, diff, atsScore, contact } = job.result;
  const sortedOptimized = sortByPdfOrder(optimizedSections);

  const isModify = job.result.kind === 'modify';
  const changes = job.result.changes ?? [];
  const removed = job.result.removed ?? [];
  const needsMoreInfo = job.result.needsMoreInfo ?? [];
  const hasModifyNotes = changes.length > 0 || removed.length > 0 || needsMoreInfo.length > 0;

  // Re-run the modify job with extra notes appended to the original ones.
  const handleRerun = async () => {
    if (moreNotes.trim().length < 5) {
      toast.error('Add a few words describing what to fix or include.');
      return;
    }
    setIsRerunning(true);
    const combined = [job.result?.sourceNotes, moreNotes.trim()].filter(Boolean).join('\n');
    try {
      const { jobId: newJobId } = await startModification(job.cvId, combined, { maxPages: config.maxPages });
      setOptimizationJob({ id: newJobId, cvId: job.cvId, jdId: '', config, status: 'pending' });
      toast.success('Re-running with your notes…');
      router.push(`/editor/${newJobId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Re-run failed');
    } finally {
      setIsRerunning(false);
    }
  };

  const totalHunks = allHunkIds.length;
  const resolvedHunks = allHunkIds.filter((id) => diffDecisions[id]).length;
  const allResolved = totalHunks > 0 && resolvedHunks === totalHunks;

  const bulkDecide = (decision: DiffDecision) => {
    const map: Record<string, DiffDecision> = {};
    for (const id of allHunkIds) map[id] = decision;
    setManyDecisions(map);
  };

  // Only sections with a rejected hunk need a content override for export.
  const buildSectionOverrides = (): Record<string, string> => {
    const overrides: Record<string, string> = {};
    for (const [sectionType, ops] of Object.entries(opsBySection)) {
      if (ops.some((o) => o.id && diffDecisions[o.id] === 'rejected')) {
        overrides[sectionType] = resolveBlocks(ops, diffDecisions);
      }
    }
    return overrides;
  };

  const handleExport = async (kind: 'pdf' | 'docx') => {
    const setLoading = kind === 'pdf' ? setIsExportingPDF : setIsExportingDOCX;
    const run = kind === 'pdf' ? exportPDF : exportDOCX;
    setLoading(true);
    try {
      const { blob, filename } = await run({ jobId, sections: buildSectionOverrides() });
      downloadBlob(blob, filename);
      toast.success(`${kind.toUpperCase()} downloaded!`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh-57px)] flex-col overflow-hidden bg-slate-100">
      {/* Top bar */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2 sm:px-6">
        <div className="flex items-center gap-3">
          <Link href={isModify ? `/modify/${job.cvId}` : `/analysis/${jobId}`}>
            <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} />}>
              {isModify ? 'Back' : 'Analysis'}
            </Button>
          </Link>
          <div className="h-4 w-px bg-slate-200" />
          <div className="flex items-center gap-2">
            {isModify ? <Wand2 size={16} className="text-primary-500" /> : <Columns2 size={16} className="text-slate-400" />}
            <span className="text-sm font-semibold text-slate-700">{isModify ? 'Review Modifications' : 'Review Changes'}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {isModify ? (
            hasModifyNotes && (
              <Button
                variant={showChanges ? 'secondary' : 'ghost'}
                size="sm"
                icon={<ListChecks size={14} />}
                onClick={() => setShowChanges((v) => !v)}
              >
                What changed{needsMoreInfo.length > 0 ? ` · ${needsMoreInfo.length} to confirm` : ''}
              </Button>
            )
          ) : (
            atsScore && (
              <div className="hidden items-center gap-2 sm:flex">
                <CircularProgressWithCenter score={atsScore.score} size={40} strokeWidth={5} />
                <div>
                  <p className="text-xs font-semibold text-slate-700">ATS Score</p>
                  <p className="text-xs text-slate-400">{atsScore.matchPercent}% match</p>
                </div>
              </div>
            )
          )}

          <Badge variant={allResolved ? 'success' : 'neutral'}>
            <CheckCheck size={11} />
            {resolvedHunks}/{totalHunks} changes
          </Badge>

          {totalHunks > 0 && (
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" icon={<CheckCheck size={14} />} onClick={() => bulkDecide('accepted')}>
                Accept all
              </Button>
              <Button variant="ghost" size="sm" icon={<X size={14} />} onClick={() => bulkDecide('rejected')}>
                Reject all
              </Button>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" loading={isExportingDOCX} icon={<FileText size={14} />} onClick={() => handleExport('docx')}>
              DOCX
            </Button>
            <Button size="sm" loading={isExportingPDF} icon={<FileDown size={14} />} onClick={() => handleExport('pdf')}>
              PDF
            </Button>
          </div>
        </div>
      </div>

      {/* Modify: "what changed" + re-run with more notes */}
      {isModify && showChanges && (
        <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
          <div className="mx-auto grid max-w-5xl gap-4 md:grid-cols-2">
            <div className="space-y-3">
              {changes.length > 0 && (
                <div>
                  <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                    <ListChecks size={13} className="text-emerald-600" /> What the AI did
                  </p>
                  <ul className="space-y-1 text-xs text-slate-600 list-disc list-inside">
                    {changes.map((c, i) => <li key={i}>{c}</li>)}
                  </ul>
                </div>
              )}
              {removed.length > 0 && (
                <div>
                  <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                    <Trash2 size={13} className="text-red-500" /> Removed / recommended to drop
                  </p>
                  <ul className="space-y-1 text-xs text-slate-600 list-disc list-inside">
                    {removed.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                  <p className="mt-1 text-[11px] text-slate-400">Reject the red blocks on the right to keep anything you want.</p>
                </div>
              )}
              {needsMoreInfo.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                  <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-amber-700">
                    <HelpCircle size={13} /> Add more detail for a stronger result
                  </p>
                  <ul className="space-y-1 text-xs text-amber-700 list-disc list-inside">
                    {needsMoreInfo.map((q, i) => (
                      <li key={i}>{q.section ? <span className="font-medium">{q.section}: </span> : null}{q.question}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div>
              <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                <RotateCw size={13} className="text-primary-600" /> Not quite right? Add more notes & re-run
              </p>
              <textarea
                value={moreNotes}
                onChange={(e) => setMoreNotes(e.target.value)}
                rows={5}
                placeholder="e.g. The latency win was 40% not 30%. Also add that the Rust CLI has 1.2k GitHub stars."
                className="w-full resize-none rounded-lg border border-slate-200 bg-white p-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100 transition-colors"
              />
              <div className="mt-2 flex justify-end">
                <Button size="sm" loading={isRerunning} icon={<RotateCw size={14} />} onClick={handleRerun}>
                  Re-run with these notes
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Two-column split */}
      <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
        {/* Left — original uploaded CV */}
        <div className="flex w-full flex-col overflow-hidden border-b border-slate-200 lg:w-1/2 lg:border-b-0 lg:border-r">
          <div className="shrink-0 border-b border-slate-200 bg-white px-5 py-2.5">
            <h3 className="text-sm font-semibold text-slate-700">Uploaded CV</h3>
            <p className="text-xs text-slate-400">Your original document</p>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-6 scrollbar-thin">
            <CvPage contact={contact}>
              <FormattedCv sections={originalSections} />
            </CvPage>
          </div>
        </div>

        {/* Right — optimized CV */}
        <div className="flex w-full flex-col overflow-hidden lg:w-1/2">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-white px-5 py-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-700">{isModify ? 'Modified CV' : 'Optimized CV'}</h3>
              <p className="text-xs text-slate-400">
                {rightView === 'review' ? 'Accept or reject each change' : 'Final result preview'}
              </p>
            </div>
            {/* View toggle */}
            <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-medium">
              <button
                onClick={() => setRightView('review')}
                className={cn(
                  'flex items-center gap-1 rounded-md px-2.5 py-1.5 transition-colors',
                  rightView === 'review' ? 'bg-white text-primary-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                )}
              >
                <GitCompare size={13} /> Review
              </button>
              <button
                onClick={() => setRightView('preview')}
                className={cn(
                  'flex items-center gap-1 rounded-md px-2.5 py-1.5 transition-colors',
                  rightView === 'preview' ? 'bg-white text-primary-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                )}
              >
                <Eye size={13} /> Preview
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-6 scrollbar-thin">
            {rightView === 'preview' ? (
              <PaginatedCv contact={contact} sections={resolvedSections} />
            ) : (
              <CvPage contact={contact}>
                {sortedOptimized.map((section) => {
                  const ops = opsBySection[section.type];
                  const hasDiff = diff.some((d) => d.sectionType === section.type);
                  return (
                    <section key={section.type}>
                      <SectionHeading>
                        {sectionLabel(section.type)}
                        {hasDiff && (
                          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium normal-case text-amber-700">
                            edited
                          </span>
                        )}
                      </SectionHeading>
                      {ops && hasDiff ? (
                        <SectionDiff ops={ops} decisions={diffDecisions} onDecide={setDiffDecision} />
                      ) : (
                        <FormattedBlocks blocks={formatSection(section.type, section.content)} />
                      )}
                    </section>
                  );
                })}
              </CvPage>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
