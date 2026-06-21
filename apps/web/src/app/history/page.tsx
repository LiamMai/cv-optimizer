'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Building2, Clock, Trash2, ArrowRight, Sparkles, Plus } from 'lucide-react';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useHistoryStore } from '@/store/historyStore';

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function HistoryPage() {
  const { entries, removeEntry, clear } = useHistoryStore();

  // Avoid hydration mismatch: persisted state is only available on the client.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <AuthGuard>
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Application History</h1>
            <p className="text-sm text-slate-500">Companies you&apos;ve tailored your CV for.</p>
          </div>
          {mounted && entries.length > 0 && (
            <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} onClick={clear}>
              Clear all
            </Button>
          )}
        </div>

        {/* Empty state */}
        {mounted && entries.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                <Clock size={22} />
              </div>
              <p className="font-medium text-slate-700">No applications yet</p>
              <p className="max-w-sm text-sm text-slate-500">
                Each time you optimize your CV for a job, the company gets saved here automatically.
              </p>
              <Link href="/upload" className="mt-2">
                <Button size="sm" icon={<Plus size={15} />}>
                  Optimize a CV
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}

        {/* List */}
        {mounted && entries.length > 0 && (
          <ul className="space-y-3">
            {entries.map((entry) => (
              <li key={entry.id}>
                <Card>
                  <CardContent className="flex items-center gap-4 py-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                      <Building2 size={18} />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-semibold text-slate-900">
                          {entry.company || 'Unknown company'}
                        </p>
                        {entry.companyAutofilled && entry.company && (
                          <Badge variant="info" size="sm" className="flex items-center gap-1">
                            <Sparkles size={10} /> auto
                          </Badge>
                        )}
                      </div>
                      <p className="truncate text-sm text-slate-500">
                        {entry.jobTitle || 'Untitled role'}
                        <span className="text-slate-300"> · </span>
                        {formatDate(entry.appliedAt)}
                      </p>
                    </div>

                    {typeof entry.atsScore === 'number' && (
                      <div className="shrink-0 text-right">
                        <p className="text-lg font-bold text-slate-900">{entry.atsScore}</p>
                        <p className="text-[10px] uppercase tracking-wide text-slate-400">ATS</p>
                      </div>
                    )}

                    <div className="flex shrink-0 items-center gap-1">
                      <Link href={`/analysis/${entry.id}`} title="Open analysis">
                        <Button variant="ghost" size="sm" icon={<ArrowRight size={15} />} />
                      </Link>
                      <button
                        onClick={() => removeEntry(entry.id)}
                        title="Remove from history"
                        className="flex items-center rounded-lg px-2 py-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AuthGuard>
  );
}
