'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowRight, Upload, BarChart2, Download, Zap, Shield, FileText, Sparkles } from 'lucide-react';
import { useCVStore } from '@/store/cvStore';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';

const steps = [
  {
    icon: Upload,
    title: 'Upload Your CV',
    description: 'Paste your CV text or upload a PDF/DOCX. We preserve your formatting and structure.',
    step: '01',
    color: 'bg-blue-50 text-blue-600',
  },
  {
    icon: BarChart2,
    title: 'Paste the Job Description',
    description: 'Add the JD and our AI will extract required skills, keywords, and seniority signals.',
    step: '02',
    color: 'bg-purple-50 text-purple-600',
  },
  {
    icon: Download,
    title: 'Export Optimized CV',
    description: 'Review AI edits section by section, accept or reject changes, then export to PDF or DOCX.',
    step: '03',
    color: 'bg-green-50 text-green-600',
  },
];

const features = [
  {
    icon: BarChart2,
    title: 'ATS Score',
    description: 'Real-time ATS compatibility scoring with keyword gap analysis.',
    badge: 'Smart',
    badgeVariant: 'info' as const,
  },
  {
    icon: Sparkles,
    title: 'Human-like Writing',
    description: 'AI rewrites bullets to sound natural and avoid detection filters.',
    badge: 'AI',
    badgeVariant: 'info' as const,
  },
  {
    icon: Shield,
    title: 'Template Preserved',
    description: 'Your original layout and branding stay intact — only content improves.',
    badge: 'Safe',
    badgeVariant: 'success' as const,
  },
  {
    icon: FileText,
    title: 'Export Ready',
    description: 'One-click PDF and DOCX export, ready to submit to any applicant tracking system.',
    badge: 'Fast',
    badgeVariant: 'neutral' as const,
  },
];

export default function HomePage() {
  const { optimizationJob, cv } = useCVStore();
  const hasSession = optimizationJob !== null && cv !== null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      {/* Hero */}
      <div className="mb-16 text-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary-200 bg-primary-50 px-4 py-1.5 text-sm font-medium text-primary-700">
          <Zap size={14} />
          AI-Powered in seconds
        </div>

        <h1 className="mx-auto max-w-3xl text-5xl font-extrabold tracking-tight text-slate-900 sm:text-6xl">
          Tailor Your CV to{' '}
          <span className="text-primary-600">Any Job</span>{' '}
          in Minutes
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-600">
          Stop sending the same generic CV everywhere. CVOptimizer analyzes job descriptions,
          rewrites your bullets with the right keywords, and boosts your ATS score —
          while keeping your voice human.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/upload">
            <Button size="lg" icon={<ArrowRight size={18} />}>
              Start Optimizing — It&apos;s Free
            </Button>
          </Link>
          {hasSession && (
            <Link href={`/analysis/${optimizationJob!.id}`}>
              <Button variant="secondary" size="lg">
                Continue Last Session
              </Button>
            </Link>
          )}
        </div>

        <p className="mt-3 text-xs text-slate-400">No signup required · Works with any job board</p>
      </div>

      {/* Continue session card */}
      {hasSession && (
        <div className="mb-10">
          <Card className="border-primary-200 bg-primary-50/50">
            <CardContent className="flex items-center justify-between py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-100">
                  <FileText size={20} className="text-primary-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">
                    Resume: {cv?.fileName ?? 'Uploaded CV'}
                  </p>
                  <p className="text-xs text-slate-500">
                    Last session · Status:{' '}
                    <span
                      className={cn(
                        'font-medium capitalize',
                        optimizationJob.status === 'completed'
                          ? 'text-green-600'
                          : optimizationJob.status === 'failed'
                          ? 'text-red-500'
                          : 'text-amber-500'
                      )}
                    >
                      {optimizationJob.status}
                    </span>
                  </p>
                </div>
              </div>
              <Link href={`/analysis/${optimizationJob!.id}`}>
                <Button variant="secondary" size="sm" icon={<ArrowRight size={14} />}>
                  Resume
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Steps */}
      <div className="mb-16">
        <p className="mb-8 text-center text-xs font-semibold uppercase tracking-widest text-slate-400">
          How it works
        </p>
        <div className="grid gap-6 md:grid-cols-3">
          {steps.map(({ icon: Icon, title, description, step, color }) => (
            <Card key={step} hover className="relative overflow-hidden">
              <CardContent className="pt-6 pb-6">
                <div className="absolute right-4 top-4 text-5xl font-black text-slate-50 select-none">
                  {step}
                </div>
                <div className={cn('mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl', color)}>
                  <Icon size={22} />
                </div>
                <h3 className="mb-2 font-semibold text-slate-900">{title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Feature highlights */}
      <div>
        <p className="mb-8 text-center text-xs font-semibold uppercase tracking-widest text-slate-400">
          Why CVOptimizer
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map(({ icon: Icon, title, description, badge, badgeVariant }) => (
            <Card key={title} hover>
              <CardContent className="pt-5 pb-5">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100">
                    <Icon size={18} className="text-slate-600" />
                  </div>
                  <Badge variant={badgeVariant} size="sm">{badge}</Badge>
                </div>
                <h3 className="mb-1 font-semibold text-slate-900">{title}</h3>
                <p className="text-xs text-slate-500 leading-relaxed">{description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Bottom CTA */}
      <div className="mt-16 rounded-2xl bg-gradient-to-br from-primary-600 to-primary-800 px-8 py-12 text-center text-white">
        <h2 className="mb-3 text-3xl font-bold text-white">Ready to land more interviews?</h2>
        <p className="mb-6 text-primary-200">
          Join thousands who stopped getting ghosted by ATS systems.
        </p>
        <Link href="/upload">
          <Button
            variant="secondary"
            size="lg"
            icon={<ArrowRight size={18} />}
            className="border-white/30 bg-white text-primary-700 hover:bg-primary-50"
          >
            Optimize Your CV Now
          </Button>
        </Link>
      </div>
    </div>
  );
}
