'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { AlignLeft, Upload as UploadIcon, ArrowRight, Wand2, Lightbulb } from 'lucide-react';
import { FileDropzone } from '@/components/upload/FileDropzone';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { useCVStore } from '@/store/cvStore';
import { uploadCV, uploadCVText, startModification } from '@/lib/api';
import { cn } from '@/lib/utils';

type CVInputMode = 'file' | 'text';

const PLACEHOLDER = `Describe what changed or what to add. For example:

• Promoted to Senior Backend Engineer at Acme, 2025–Present
• Cut API p95 latency 40% by adding Redis caching
• Add a side project: "Pico" — a CLI written in Rust, github.com/me/pico
• Drop the old jQuery dashboard project, it's outdated`;

export default function ModifyEntryPage() {
  const router = useRouter();
  const { setCv, setOptimizationJob, config } = useCVStore();

  const [cvMode, setCvMode] = useState<CVInputMode>('file');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [cvText, setCvText] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const onSubmit = async () => {
    if (cvMode === 'file' && !selectedFile) {
      toast.error('Please upload your CV file.');
      return;
    }
    if (cvMode === 'text' && cvText.trim().length < 50) {
      toast.error('Please paste at least 50 characters of your CV.');
      return;
    }
    if (notes.trim().length < 20) {
      toast.error('Please add at least 20 characters describing what to change.');
      return;
    }

    setIsSubmitting(true);
    const toastId = toast.loading('Uploading your CV…');

    try {
      const parsedCV = cvMode === 'file' ? await uploadCV(selectedFile!) : await uploadCVText(cvText);
      setCv(parsedCV);

      toast.loading('Updating your CV with your data…', { id: toastId });
      const { jobId } = await startModification(parsedCV.id, notes.trim(), { maxPages: config.maxPages });

      setOptimizationJob({
        id: jobId,
        cvId: parsedCV.id,
        jdId: '',
        config,
        status: 'pending',
      });

      toast.success('Modification started!', { id: toastId });
      router.push(`/editor/${jobId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      toast.error(message, { id: toastId });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthGuard>
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-8 text-center">
          <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary-100 text-primary-600">
            <Wand2 size={24} />
          </div>
          <h1 className="mb-2 text-3xl font-extrabold text-slate-900">Modify Your CV</h1>
          <p className="text-slate-500">
            Provide your CV and what&apos;s new — the AI updates the right sections following CV best
            practice. No job description needed.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {/* CV input */}
          <Card>
            <CardHeader
              title="Your CV"
              description="Upload a file or paste your CV text."
              action={
                <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs">
                  <button
                    type="button"
                    onClick={() => setCvMode('file')}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 font-medium transition-colors',
                      cvMode === 'file' ? 'bg-primary-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                    )}
                  >
                    <UploadIcon size={12} /> File
                  </button>
                  <button
                    type="button"
                    onClick={() => setCvMode('text')}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 font-medium transition-colors',
                      cvMode === 'text' ? 'bg-primary-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                    )}
                  >
                    <AlignLeft size={12} /> Paste
                  </button>
                </div>
              }
            />
            <CardContent className="pt-4">
              {cvMode === 'file' ? (
                <FileDropzone
                  onFile={setSelectedFile}
                  currentFile={selectedFile}
                  onRemove={() => setSelectedFile(null)}
                  label="Drop your CV here (PDF or DOCX)"
                  maxSize={10 * 1024 * 1024}
                />
              ) : (
                <textarea
                  value={cvText}
                  onChange={(e) => setCvText(e.target.value)}
                  rows={16}
                  placeholder="Paste the full text of your CV here…&#10;&#10;Include your contact info, summary, experience, education, and skills."
                  className="w-full resize-none rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100 transition-colors"
                />
              )}
            </CardContent>
          </Card>

          {/* What changed */}
          <Card>
            <CardHeader
              title="What's new?"
              description="A new role, fresh achievements with numbers, projects to add, or things to drop."
              action={<span className="text-xs text-slate-400">{notes.length} chars</span>}
            />
            <CardContent className="pt-4">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={16}
                placeholder={PLACEHOLDER}
                className="w-full resize-none rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100 transition-colors"
              />

              <div className="mt-4 rounded-lg bg-blue-50 border border-blue-100 px-4 py-3">
                <p className="text-xs font-semibold text-blue-700 mb-1.5 flex items-center gap-1.5">
                  <Lightbulb size={12} /> How it works
                </p>
                <ul className="space-y-1 text-xs text-blue-600 list-disc list-inside">
                  <li>The AI only uses facts you provide — it won&apos;t invent metrics or dates.</li>
                  <li>Weak or outdated projects are flagged for removal to keep the CV to {config.maxPages} pages.</li>
                  <li>You review every change (accept / reject) before exporting.</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="mt-8 flex flex-col items-center gap-3">
          <Button
            size="lg"
            loading={isSubmitting}
            onClick={onSubmit}
            icon={<ArrowRight size={18} />}
            className="min-w-[240px]"
          >
            {isSubmitting ? 'Updating…' : 'Modify CV'}
          </Button>
          <p className="text-xs text-slate-400">Usually takes 10–30 seconds depending on CV length.</p>
        </div>
      </div>
    </AuthGuard>
  );
}
