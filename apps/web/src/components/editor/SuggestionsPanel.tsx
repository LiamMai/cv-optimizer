'use client';

import React from 'react';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { SectionDiff } from '@/lib/types';
import { cn } from '@/lib/utils';

interface SuggestionsPanelProps {
  diffs: SectionDiff[];
  currentSection: string;
  onAccept: (type: string) => void;
  onReject: (type: string) => void;
  acceptedDiffs: string[];
}

interface WordDiffToken {
  text: string;
  type: 'unchanged' | 'added' | 'removed';
}

function computeWordDiff(original: string, optimized: string): WordDiffToken[] {
  const origWords = original.split(/\s+/).filter(Boolean);
  const optWords = optimized.split(/\s+/).filter(Boolean);
  const tokens: WordDiffToken[] = [];

  // Simple LCS-based diff
  const m = origWords.length;
  const n = optWords.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (origWords[i - 1] === optWords[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack
  let i = m;
  let j = n;
  const result: WordDiffToken[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && origWords[i - 1] === optWords[j - 1]) {
      result.unshift({ text: origWords[i - 1], type: 'unchanged' });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ text: optWords[j - 1], type: 'added' });
      j--;
    } else {
      result.unshift({ text: origWords[i - 1], type: 'removed' });
      i--;
    }
  }

  return result.concat(tokens);
}

function WordDiffView({ original, optimized }: { original: string; optimized: string }) {
  const tokens = computeWordDiff(original, optimized);

  return (
    <p className="text-sm leading-relaxed text-slate-700">
      {tokens.map((token, idx) => {
        if (token.type === 'unchanged') {
          return <span key={idx}>{token.text} </span>;
        }
        if (token.type === 'added') {
          return (
            <span key={idx} className="bg-green-100 text-green-800 rounded px-0.5">
              {token.text}{' '}
            </span>
          );
        }
        return (
          <span key={idx} className="bg-red-100 text-red-700 line-through rounded px-0.5">
            {token.text}{' '}
          </span>
        );
      })}
    </p>
  );
}

export function SuggestionsPanel({
  diffs,
  currentSection,
  onAccept,
  onReject,
  acceptedDiffs,
}: SuggestionsPanelProps) {
  const diff = diffs.find((d) => d.sectionType === currentSection);

  if (!diff) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-8 text-center">
        <div className="h-12 w-12 rounded-full bg-slate-100 flex items-center justify-center">
          <Check size={22} className="text-slate-400" />
        </div>
        <p className="text-sm text-slate-500">No suggestions for this section.</p>
      </div>
    );
  }

  const isAccepted = acceptedDiffs.includes(currentSection);

  return (
    <div className="flex flex-col gap-4 p-4 h-full overflow-y-auto scrollbar-thin">
      {/* Status badge */}
      {isAccepted && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-700">
          <Check size={15} />
          Optimized version accepted
        </div>
      )}

      {/* Original */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Original
        </p>
        <p className="text-sm leading-relaxed text-slate-600 whitespace-pre-wrap">{diff.original}</p>
      </div>

      {/* Optimized */}
      <div
        className={cn(
          'rounded-lg border p-4',
          isAccepted ? 'border-green-200 bg-green-50' : 'border-blue-200 bg-blue-50'
        )}
      >
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-blue-400">
          AI Optimized
        </p>
        <p className="text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">{diff.optimized}</p>
      </div>

      {/* Word diff */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Changes highlighted
        </p>
        <WordDiffView original={diff.original} optimized={diff.optimized} />
        <div className="mt-3 flex items-center gap-3 text-xs text-slate-400">
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded bg-green-100" /> Added
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded bg-red-100" /> Removed
          </span>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <Button
          variant={isAccepted ? 'secondary' : 'primary'}
          size="sm"
          className="flex-1"
          icon={<Check size={14} />}
          onClick={() => onAccept(currentSection)}
          disabled={isAccepted}
        >
          {isAccepted ? 'Accepted' : 'Accept'}
        </Button>
        <Button
          variant="danger"
          size="sm"
          className="flex-1"
          icon={<X size={14} />}
          onClick={() => onReject(currentSection)}
          disabled={!isAccepted}
        >
          Reject
        </Button>
      </div>
    </div>
  );
}
