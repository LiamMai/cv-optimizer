'use client';

import React from 'react';
import { CheckCircle, Plus } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';

interface KeywordChipsProps {
  matched: string[];
  missing: string[];
}

export function KeywordChips({ matched, missing }: KeywordChipsProps) {
  return (
    <Card>
      <CardHeader title="Keyword Analysis" />
      <CardContent className="space-y-5">
        {/* Matched */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-green-600">
              Matched Keywords
            </p>
            <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full border border-green-200">
              {matched.length}
            </span>
          </div>
          {matched.length === 0 ? (
            <p className="text-sm text-slate-400 italic">No matched keywords found.</p>
          ) : (
            <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto scrollbar-thin pr-1">
              {matched.map((kw) => (
                <span
                  key={kw}
                  className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700"
                >
                  <CheckCircle size={11} className="shrink-0" />
                  {kw}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-slate-100" />

        {/* Missing */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-red-500">
              Missing Keywords
            </p>
            <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full border border-red-200">
              {missing.length}
            </span>
          </div>
          {missing.length === 0 ? (
            <p className="text-sm text-slate-400 italic">All keywords covered!</p>
          ) : (
            <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto scrollbar-thin pr-1">
              {missing.map((kw) => (
                <span
                  key={kw}
                  className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-xs font-medium text-orange-700"
                >
                  <Plus size={11} className="shrink-0" />
                  {kw}
                </span>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
