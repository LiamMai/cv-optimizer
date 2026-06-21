'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { AlignLeft, Upload as UploadIcon, ArrowRight, FileText, Building2 } from 'lucide-react';
import { FileDropzone } from '@/components/upload/FileDropzone';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { useCVStore } from '@/store/cvStore';
import { useHistoryStore } from '@/store/historyStore';
import { uploadCV, uploadCVText, analyzeJD, startOptimization } from '@/lib/api';
import { cn } from '@/lib/utils';

const schema = z.object({
  cvText: z.string().optional(),
  company: z.string().optional(),
  jdText: z.string().min(50, 'Please enter at least 50 characters for the job description.'),
});

type FormData = z.infer<typeof schema>;

type CVInputMode = 'file' | 'text';

export default function UploadPage() {
  const router = useRouter();
  const { setCv, setJd, setOptimizationJob, config } = useCVStore();
  const addHistoryEntry = useHistoryStore((s) => s.addEntry);

  const [cvMode, setCvMode] = useState<CVInputMode>('file');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const jdText = watch('jdText', '');

  const onSubmit = async (data: FormData) => {
    // Validate CV input
    if (cvMode === 'file' && !selectedFile) {
      toast.error('Please upload your CV file.');
      return;
    }
    if (cvMode === 'text' && (!data.cvText || data.cvText.trim().length < 50)) {
      toast.error('Please paste at least 50 characters of your CV.');
      return;
    }

    setIsSubmitting(true);
    const toastId = toast.loading('Uploading and analyzing...');

    try {
      // Step 1: Upload CV
      toast.loading('Parsing your CV...', { id: toastId });
      const parsedCV =
        cvMode === 'file'
          ? await uploadCV(selectedFile!)
          : await uploadCVText(data.cvText!);
      setCv(parsedCV);

      // Step 2: Analyze JD
      toast.loading('Analyzing job description...', { id: toastId });
      const jdResult = await analyzeJD(data.jdText);

      // Resolve company: user-typed wins; otherwise auto-fill from the JD analysis.
      // If neither has it, leave blank.
      const typedCompany = data.company?.trim() ?? '';
      const extractedCompany = jdResult.analysis.company?.trim() ?? '';
      const company = typedCompany || extractedCompany;
      const companyAutofilled = !typedCompany && !!extractedCompany;

      setJd({ id: jdResult.id, text: data.jdText, analysis: jdResult.analysis, company });

      // Step 3: Start optimization
      toast.loading('Starting optimization...', { id: toastId });
      const { jobId } = await startOptimization(parsedCV.id, jdResult.id, config);

      const initialJob = {
        id: jobId,
        cvId: parsedCV.id,
        jdId: jdResult.id,
        config,
        status: 'pending' as const,
      };
      setOptimizationJob(initialJob);

      // Step 4: Remember this application (localStorage history)
      addHistoryEntry({
        id: jobId,
        company,
        companyAutofilled,
        jobTitle: jdResult.analysis.jobTitle ?? '',
        cvId: parsedCV.id,
        jdId: jdResult.id,
        appliedAt: new Date().toISOString(),
      });

      toast.success('Optimization started!', { id: toastId });
      router.push(`/analysis/${jobId}`);
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
      {/* Header */}
      <div className="mb-8 text-center">
        <h1 className="mb-2 text-3xl font-extrabold text-slate-900">Upload Your Documents</h1>
        <p className="text-slate-500">
          Add your CV and the job description to get your personalized ATS score.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className="grid gap-6 md:grid-cols-2">
          {/* Left panel — CV */}
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
                      cvMode === 'file'
                        ? 'bg-primary-600 text-white'
                        : 'bg-white text-slate-600 hover:bg-slate-50'
                    )}
                  >
                    <UploadIcon size={12} />
                    File
                  </button>
                  <button
                    type="button"
                    onClick={() => setCvMode('text')}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 font-medium transition-colors',
                      cvMode === 'text'
                        ? 'bg-primary-600 text-white'
                        : 'bg-white text-slate-600 hover:bg-slate-50'
                    )}
                  >
                    <AlignLeft size={12} />
                    Paste
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
                <div>
                  <textarea
                    {...register('cvText')}
                    rows={14}
                    placeholder="Paste the full text of your CV here…&#10;&#10;Include your contact info, summary, experience, education, and skills."
                    className="w-full resize-none rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100 transition-colors"
                  />
                </div>
              )}

              {/* Tips */}
              <div className="mt-4 rounded-lg bg-blue-50 border border-blue-100 px-4 py-3">
                <p className="text-xs font-semibold text-blue-700 mb-1.5 flex items-center gap-1.5">
                  <FileText size={12} /> Tips for best results
                </p>
                <ul className="space-y-1 text-xs text-blue-600 list-disc list-inside">
                  <li>Include full work history with dates</li>
                  <li>List all technical skills and tools</li>
                  <li>Keep education and certifications</li>
                </ul>
              </div>
            </CardContent>
          </Card>

          {/* Right panel — JD */}
          <Card>
            <CardHeader
              title="Job Description"
              description="Paste the full job description from the listing."
              action={
                <span className="text-xs text-slate-400">
                  {jdText?.length ?? 0} chars
                </span>
              }
            />
            <CardContent className="pt-4">
              {/* Company name — optional; auto-filled from the JD when left blank */}
              <div className="mb-3">
                <label htmlFor="company" className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600">
                  <Building2 size={12} />
                  Company name
                  <span className="font-normal text-slate-400">— optional, auto-detected from the JD</span>
                </label>
                <input
                  id="company"
                  type="text"
                  {...register('company')}
                  placeholder="e.g. Acme Inc. (leave blank to auto-detect)"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100 transition-colors"
                />
              </div>

              <textarea
                {...register('jdText')}
                rows={16}
                placeholder="Paste the full job description here…&#10;&#10;Include the role title, responsibilities, required qualifications, and preferred skills."
                className={cn(
                  'w-full resize-none rounded-lg border bg-white p-3 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 transition-colors',
                  errors.jdText
                    ? 'border-red-300 focus:border-red-400 focus:ring-red-100'
                    : 'border-slate-200 focus:border-primary-400 focus:ring-primary-100'
                )}
              />
              {errors.jdText && (
                <p className="mt-1.5 text-xs text-red-500">{errors.jdText.message}</p>
              )}

              <div className="mt-4 rounded-lg bg-amber-50 border border-amber-100 px-4 py-3">
                <p className="text-xs font-semibold text-amber-700 mb-1.5 flex items-center gap-1.5">
                  <FileText size={12} /> What we extract
                </p>
                <ul className="space-y-1 text-xs text-amber-600 list-disc list-inside">
                  <li>Required and preferred skills</li>
                  <li>ATS keywords and industry terms</li>
                  <li>Seniority level and responsibilities</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Submit */}
        <div className="mt-8 flex flex-col items-center gap-3">
          <Button
            type="submit"
            size="lg"
            loading={isSubmitting}
            icon={<ArrowRight size={18} />}
            className="min-w-[240px]"
          >
            {isSubmitting ? 'Analyzing...' : 'Analyze Match & Optimize'}
          </Button>
          <p className="text-xs text-slate-400">
            Usually takes 10–30 seconds depending on CV length.
          </p>
        </div>
      </form>
    </div>
    </AuthGuard>
  );
}
