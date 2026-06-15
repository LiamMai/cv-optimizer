'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  FileDown,
  FileText,
  ArrowLeft,
  LayoutPanelLeft,
  CheckCircle,
} from 'lucide-react';
import { useCVStore } from '@/store/cvStore';
import { pollJobStatus, exportPDF, exportDOCX } from '@/lib/api';
import { CVEditor } from '@/components/editor/CVEditor';
import { SuggestionsPanel } from '@/components/editor/SuggestionsPanel';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { CircularProgressWithCenter } from '@/components/ui/CircularProgress';
import type { CVSection } from '@/lib/types';
import { cn, downloadBlob } from '@/lib/utils';

interface EditorPageProps {
  params: { jobId: string };
}

const SECTION_ORDER = ['summary', 'experience', 'skills', 'education', 'projects', 'certifications'];

function getSectionLabel(type: string): string {
  const map: Record<string, string> = {
    summary: 'Summary',
    experience: 'Experience',
    skills: 'Skills',
    education: 'Education',
    projects: 'Projects',
    certifications: 'Certs',
  };
  return map[type] ?? type.charAt(0).toUpperCase() + type.slice(1);
}

function sortSections(sections: CVSection[]): CVSection[] {
  return [...sections].sort((a, b) => {
    const ai = SECTION_ORDER.indexOf(a.type);
    const bi = SECTION_ORDER.indexOf(b.type);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
}

export default function EditorPage({ params }: EditorPageProps) {
  const { jobId } = params;
  const { optimizationJob, updateOptimizationJob, acceptDiff, rejectDiff, acceptedDiffs } =
    useCVStore();

  const [activeSection, setActiveSection] = useState<string>('');
  const [sectionContents, setSectionContents] = useState<Record<string, string>>({});
  const [isExportingPDF, setIsExportingPDF] = useState(false);
  const [isExportingDOCX, setIsExportingDOCX] = useState(false);

  const job = optimizationJob?.id === jobId ? optimizationJob : null;

  // Fetch job if not in store
  useEffect(() => {
    if (!job && jobId) {
      pollJobStatus(jobId).then(updateOptimizationJob).catch(() => {});
    }
  }, [job, jobId, updateOptimizationJob]);

  // Initialize section contents from optimized (or original) sections
  useEffect(() => {
    if (!job?.result) return;
    const sections = sortSections(job.result.optimizedSections);
    const initial: Record<string, string> = {};
    for (const s of sections) {
      initial[s.type] = s.content;
    }
    setSectionContents(initial);
    if (!activeSection && sections.length > 0) {
      setActiveSection(sections[0].type);
    }
  }, [job?.result, activeSection]);

  const handleSectionChange = useCallback((type: string, html: string) => {
    setSectionContents((prev) => ({ ...prev, [type]: html }));
  }, []);

  const handleExportPDF = async () => {
    setIsExportingPDF(true);
    try {
      const { blob, filename } = await exportPDF({ jobId });
      downloadBlob(blob, filename);
      toast.success('PDF downloaded!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setIsExportingPDF(false);
    }
  };

  const handleExportDOCX = async () => {
    setIsExportingDOCX(true);
    try {
      const { blob, filename } = await exportDOCX({ jobId });
      downloadBlob(blob, filename);
      toast.success('DOCX downloaded!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setIsExportingDOCX(false);
    }
  };

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
        <p className="text-slate-600">Optimization is still in progress.</p>
        <Link href={`/analysis/${jobId}`}>
          <Button variant="secondary" icon={<ArrowLeft size={15} />}>Back to Analysis</Button>
        </Link>
      </div>
    );
  }

  const { optimizedSections, diff, atsScore } = job.result;
  const sortedSections = sortSections(optimizedSections);
  const acceptedCount = acceptedDiffs.length;
  const totalDiffs = diff.length;

  return (
    <div className="flex h-[calc(100vh-57px)] flex-col overflow-hidden bg-slate-50">
      {/* Top bar */}
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-2 sm:px-6">
        <div className="flex items-center gap-3">
          <Link href={`/analysis/${jobId}`}>
            <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} />}>
              Analysis
            </Button>
          </Link>
          <div className="h-4 w-px bg-slate-200" />
          <div className="flex items-center gap-2">
            <LayoutPanelLeft size={16} className="text-slate-400" />
            <span className="text-sm font-semibold text-slate-700">CV Editor</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* ATS score badge */}
          {atsScore && (
            <div className="hidden items-center gap-2 sm:flex">
              <CircularProgressWithCenter score={atsScore.score} size={40} strokeWidth={5} />
              <div>
                <p className="text-xs font-semibold text-slate-700">ATS Score</p>
                <p className="text-xs text-slate-400">{atsScore.matchPercent}% match</p>
              </div>
            </div>
          )}

          {/* Progress */}
          <Badge variant={acceptedCount === totalDiffs ? 'success' : 'neutral'}>
            <CheckCircle size={11} />
            {acceptedCount}/{totalDiffs} sections
          </Badge>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              loading={isExportingDOCX}
              icon={<FileText size={14} />}
              onClick={handleExportDOCX}
            >
              DOCX
            </Button>
            <Button
              size="sm"
              loading={isExportingPDF}
              icon={<FileDown size={14} />}
              onClick={handleExportPDF}
            >
              PDF
            </Button>
          </div>
        </div>
      </div>

      {/* Section tabs */}
      <div className="shrink-0 border-b border-slate-200 bg-white px-4 sm:px-6">
        <div className="flex items-center gap-0 overflow-x-auto scrollbar-thin -mb-px">
          {sortedSections.map((section) => {
            const isAccepted = acceptedDiffs.includes(section.type);
            const hasDiff = diff.some((d) => d.sectionType === section.type);
            return (
              <button
                key={section.type}
                onClick={() => setActiveSection(section.type)}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap',
                  activeSection === section.type
                    ? 'border-primary-600 text-primary-700'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                )}
              >
                {getSectionLabel(section.type)}
                {hasDiff && (
                  <span
                    className={cn(
                      'flex h-1.5 w-1.5 rounded-full',
                      isAccepted ? 'bg-green-500' : 'bg-amber-400'
                    )}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main editor area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Editor — 60% */}
        <div className="flex flex-col w-3/5 overflow-y-auto border-r border-slate-200 bg-white p-6 scrollbar-thin">
          {activeSection && (
            <>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-800 capitalize">
                  {getSectionLabel(activeSection)}
                </h2>
                {acceptedDiffs.includes(activeSection) && (
                  <Badge variant="success" size="sm">
                    <CheckCircle size={10} />
                    Accepted
                  </Badge>
                )}
              </div>
              <CVEditor
                key={activeSection}
                content={sectionContents[activeSection] ?? ''}
                onChange={(html) => handleSectionChange(activeSection, html)}
                editable
                placeholder={`Write or edit your ${getSectionLabel(activeSection)} section…`}
              />
            </>
          )}
        </div>

        {/* Suggestions panel — 40% */}
        <div className="flex w-2/5 flex-col overflow-hidden bg-slate-50">
          <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-700">AI Suggestions</h3>
            <p className="text-xs text-slate-400">Review changes for the active section</p>
          </div>
          <div className="flex-1 overflow-hidden">
            {activeSection && (
              <SuggestionsPanel
                diffs={diff}
                currentSection={activeSection}
                onAccept={acceptDiff}
                onReject={rejectDiff}
                acceptedDiffs={acceptedDiffs}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
