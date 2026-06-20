// Word-level diff between an original and an optimized section, grouped into
// "hunks" (runs of change) so each edit can be accepted or rejected on its own.

export type DiffDecision = 'accepted' | 'rejected';

export interface EqualSegment {
  kind: 'equal';
  text: string;
}

export interface ChangeSegment {
  kind: 'change';
  /** Stable id: `${sectionType}#${segmentIndex}` — used as the decision key. */
  id: string;
  /** Words present in the original but dropped by the optimizer. */
  removed: string;
  /** Words the optimizer added. */
  added: string;
}

export type DiffSegment = EqualSegment | ChangeSegment;

export type WordToken = { text: string; type: 'unchanged' | 'added' | 'removed' };

function tokenize(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

// Standard LCS word diff (same approach the old SuggestionsPanel used).
export function wordTokens(original: string, optimized: string): WordToken[] {
  const a = tokenize(original);
  const b = tokenize(optimized);
  const m = a.length;
  const n = b.length;

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const out: WordToken[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      out.unshift({ text: a[i - 1], type: 'unchanged' });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      out.unshift({ text: b[j - 1], type: 'added' });
      j--;
    } else {
      out.unshift({ text: a[i - 1], type: 'removed' });
      i--;
    }
  }
  return out;
}

/**
 * Build the segment list for a section. Consecutive added/removed words collapse
 * into a single change hunk; runs of unchanged words become equal segments.
 */
export function diffSegments(sectionType: string, original: string, optimized: string): DiffSegment[] {
  const tokens = wordTokens(original, optimized);
  const segments: DiffSegment[] = [];

  let equal: string[] = [];
  let removed: string[] = [];
  let added: string[] = [];

  const flushEqual = () => {
    if (equal.length) {
      segments.push({ kind: 'equal', text: equal.join(' ') });
      equal = [];
    }
  };

  const flushChange = () => {
    if (removed.length || added.length) {
      segments.push({
        kind: 'change',
        id: `${sectionType}#${segments.length}`,
        removed: removed.join(' '),
        added: added.join(' '),
      });
      removed = [];
      added = [];
    }
  };

  for (const tok of tokens) {
    if (tok.type === 'unchanged') {
      flushChange();
      equal.push(tok.text);
    } else {
      flushEqual();
      if (tok.type === 'removed') removed.push(tok.text);
      else added.push(tok.text);
    }
  }
  flushEqual();
  flushChange();

  return segments;
}

/** Does this section have any changes at all? */
export function hasChanges(segments: DiffSegment[]): boolean {
  return segments.some((s) => s.kind === 'change');
}

/**
 * Reconstruct the final section text from the segments and the user's per-hunk
 * decisions. A rejected hunk reverts to the original words; accepted/pending
 * hunks keep the optimizer's words.
 */
export function resolveSectionText(
  segments: DiffSegment[],
  decisions: Record<string, DiffDecision>
): string {
  return segments
    .map((seg) => {
      if (seg.kind === 'equal') return seg.text;
      return decisions[seg.id] === 'rejected' ? seg.removed : seg.added;
    })
    .filter(Boolean)
    .join(' ');
}
