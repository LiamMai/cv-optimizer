'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { Wand2, ArrowRight, Lightbulb } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { useCVStore } from '@/store/cvStore';
import { getCV, startModification } from '@/lib/api';

interface ModifyPageProps {
  params: { cvId: string };
}

const PLACEHOLDER = `Describe what changed or what to add. For example:

• Promoted to Senior Backend Engineer at Acme, 2025–Present
• Cut API p95 latency 40% by adding Redis caching
• Add a side project: "Pico" — a CLI written in Rust, github.com/me/pico
• Drop the old jQuery dashboard project, it's outdated`;

export default function ModifyPage({ params }: ModifyPageProps) {
  const { cvId } = params;
  const router = useRouter();
  const { cv, setCv, setOptimizationJob, config } = useCVStore();

  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cvName, setCvName] = useState<string | null>(cv?.id === cvId ? cv.fileName : null);

  // Make sure the CV is loaded (e.g. on a fresh page load / shared link).
  useEffect(() => {
    if (cv?.id === cvId) {
      setCvName(cv.fileName);
      return;
    }
    getCV(cvId)
      .then((loaded) => {
        setCv(loaded);
        setCvName(loaded.fileName);
      })
      .catch(() => toast.error('Could not load that CV. Please upload it again.'));
  }, [cvId, cv, setCv]);

  const onSubmit = async () => {
    if (notes.trim().length < 20) {
      toast.error('Please add at least 20 characters describing what to change.');
      return;
    }

    setIsSubmitting(true);
    const toastId = toast.loading('Updating your CV with your data…');

    try {
      const { jobId } = await startModification(cvId, notes.trim(), { maxPages: config.maxPages });

      setOptimizationJob({
        id: jobId,
        cvId,
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
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-8 text-center">
          <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary-100 text-primary-600">
            <Wand2 size={24} />
          </div>
          <h1 className="mb-2 text-3xl font-extrabold text-slate-900">Modify Your CV</h1>
          <p className="text-slate-500">
            Add your new data and the AI updates the right sections — experience, projects, skills —
            following CV best practice. No job description needed.
          </p>
          {cvName && (
            <p className="mt-2 text-xs text-slate-400">
              Editing <span className="font-medium text-slate-600">{cvName}</span>
            </p>
          )}
        </div>

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
              rows={14}
              placeholder={PLACEHOLDER}
              className="w-full resize-none rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100 transition-colors"
            />

            <div className="mt-4 rounded-lg bg-blue-50 border border-blue-100 px-4 py-3">
              <p className="text-xs font-semibold text-blue-700 mb-1.5 flex items-center gap-1.5">
                <Lightbulb size={12} /> How it works
              </p>
              <ul className="space-y-1 text-xs text-blue-600 list-disc list-inside">
                <li>The AI only uses facts you provide — it won't invent metrics or dates.</li>
                <li>Weak or outdated projects are flagged for removal to keep the CV to {config.maxPages} pages.</li>
                <li>You review every change (accept / reject) before exporting.</li>
              </ul>
            </div>
          </CardContent>
        </Card>

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
          <p className="text-xs text-slate-400">Usually takes 10–30 seconds.</p>
        </div>
      </div>
    </AuthGuard>
  );
}
