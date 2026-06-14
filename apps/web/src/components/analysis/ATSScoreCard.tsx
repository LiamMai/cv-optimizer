'use client';

import React, { useEffect, useState } from 'react';
import * as Progress from '@radix-ui/react-progress';
import { CircularProgressWithCenter } from '@/components/ui/CircularProgress';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import type { ATSScore } from '@/lib/types';
import { cn } from '@/lib/utils';

interface ATSScoreCardProps {
  score: ATSScore;
}

interface SubScoreBarProps {
  label: string;
  value: number;
  delay?: number;
}

function SubScoreBar({ label, value, delay = 0 }: SubScoreBarProps) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setProgress(value), 150 + delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  const color =
    value >= 75 ? 'bg-green-500' : value >= 50 ? 'bg-amber-500' : 'bg-red-500';

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-slate-600">{label}</span>
        <span
          className={cn(
            'font-semibold',
            value >= 75 ? 'text-green-600' : value >= 50 ? 'text-amber-500' : 'text-red-500'
          )}
        >
          {value}
        </span>
      </div>
      <Progress.Root
        className="relative h-2 w-full overflow-hidden rounded-full bg-slate-100"
        value={progress}
      >
        <Progress.Indicator
          className={cn('h-full rounded-full transition-all duration-700 ease-out', color)}
          style={{ transform: `translateX(-${100 - progress}%)` }}
        />
      </Progress.Root>
    </div>
  );
}

export function ATSScoreCard({ score }: ATSScoreCardProps) {
  return (
    <Card>
      <CardHeader title="ATS Compatibility Score" />
      <CardContent className="flex flex-col gap-6">
        {/* Main circular score */}
        <div className="flex flex-col items-center gap-2">
          <CircularProgressWithCenter score={score.score} size={140} strokeWidth={12} />
          <div className="flex items-center gap-2">
            <Badge variant={score.score >= 75 ? 'success' : score.score >= 50 ? 'warning' : 'danger'}>
              {score.score >= 75 ? 'Strong Match' : score.score >= 50 ? 'Good Match' : 'Needs Work'}
            </Badge>
            <span className="text-sm text-slate-500">{score.matchPercent}% keyword match</span>
          </div>
        </div>

        {/* Sub-scores */}
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Breakdown</p>
          <SubScoreBar label="Keyword Coverage" value={score.breakdown.keywordScore} delay={0} />
          <SubScoreBar label="Skills Alignment" value={score.breakdown.skillScore} delay={100} />
          <SubScoreBar label="Section Quality" value={score.breakdown.sectionScore} delay={200} />
        </div>

        {/* Missing keywords count */}
        {score.missingKeywords.length > 0 && (
          <div className="rounded-lg bg-red-50 border border-red-100 px-4 py-3 text-sm">
            <span className="font-semibold text-red-700">{score.missingKeywords.length}</span>
            <span className="text-red-600"> missing keywords detected</span>
          </div>
        )}

        {/* Weak sections */}
        {score.weakSections.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Weak Sections
            </p>
            <div className="flex flex-wrap gap-1.5">
              {score.weakSections.map((section) => (
                <Badge key={section} variant="warning" size="sm">
                  {section}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
