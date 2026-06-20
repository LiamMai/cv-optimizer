// Block-level diff between the original and optimized version of a CV section.
// Operates on structured blocks (paragraph / entry / bullet) so the optimized
// side renders in the SAME layout as the exported PDF — bullets stay bullets,
// experience entries keep their bold title + date — with changes highlighted
// and accepted/rejected one block at a time.

import { formatSection, blockText, blocksToContent, type CvBlock } from '@/lib/cvFormat';
import { wordTokens, type WordToken, type DiffDecision } from '@/lib/diff';

export type BlockOpKind = 'unchanged' | 'changed' | 'added' | 'removed';

export interface BlockOp {
  kind: BlockOpKind;
  /** Stable hunk id for changed/added/removed ops (undefined for unchanged). */
  id?: string;
  /** Optimized-side block (present for unchanged/changed/added). */
  opt?: CvBlock;
  /** Original-side block (present for unchanged/changed/removed). */
  orig?: CvBlock;
  /** Word-level tokens for a changed block (orig → opt). */
  tokens?: WordToken[];
}

function tokenSet(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/\s+/).filter(Boolean));
}

function jaccard(a: string, b: string): number {
  const sa = tokenSet(a);
  const sb = tokenSet(b);
  if (!sa.size && !sb.size) return 1;
  let inter = 0;
  sa.forEach((t) => {
    if (sb.has(t)) inter++;
  });
  return inter / (sa.size + sb.size - inter);
}

// Two blocks are "the same block" (matched) if they're the same layout kind and
// share enough words. Paragraphs (one per section) always match each other.
function similar(a: CvBlock, b: CvBlock): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'paragraph') return true;
  return jaccard(blockText(a), blockText(b)) >= 0.4;
}

/** LCS over blocks using fuzzy equality, returning ops in optimized-document order. */
export function diffBlocks(sectionType: string, origContent: string, optContent: string): BlockOp[] {
  const orig = formatSection(sectionType, origContent);
  const opt = formatSection(sectionType, optContent);
  const m = orig.length;
  const n = opt.length;

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = similar(orig[i], opt[j])
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops: BlockOp[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (similar(orig[i], opt[j])) {
      const oText = blockText(orig[i]);
      const pText = blockText(opt[j]);
      if (oText === pText) {
        ops.push({ kind: 'unchanged', opt: opt[j], orig: orig[i] });
      } else {
        ops.push({
          kind: 'changed',
          id: `${sectionType}#c${j}`,
          opt: opt[j],
          orig: orig[i],
          tokens: wordTokens(oText, pText),
        });
      }
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ kind: 'removed', id: `${sectionType}#r${i}`, orig: orig[i] });
      i++;
    } else {
      ops.push({ kind: 'added', id: `${sectionType}#a${j}`, opt: opt[j] });
      j++;
    }
  }
  while (i < m) ops.push({ kind: 'removed', id: `${sectionType}#r${i}`, orig: orig[i++] });
  while (j < n) ops.push({ kind: 'added', id: `${sectionType}#a${j}`, opt: opt[j++] });

  return ops;
}

export function hasBlockChanges(ops: BlockOp[]): boolean {
  return ops.some((o) => o.kind !== 'unchanged');
}

export function blockHunkIds(ops: BlockOp[]): string[] {
  return ops.filter((o) => o.id).map((o) => o.id!) as string[];
}

/**
 * Reconstruct the section content from the ops + decisions. Rejected changes
 * revert to the original block; rejected additions drop; rejected removals are
 * restored. Accepted/pending follow the optimizer.
 */
export function resolveBlocks(ops: BlockOp[], decisions: Record<string, DiffDecision>): string {
  const blocks: CvBlock[] = [];
  for (const op of ops) {
    const rejected = op.id ? decisions[op.id] === 'rejected' : false;
    switch (op.kind) {
      case 'unchanged':
        if (op.opt) blocks.push(op.opt);
        break;
      case 'changed':
        blocks.push((rejected ? op.orig : op.opt) as CvBlock);
        break;
      case 'added':
        if (!rejected && op.opt) blocks.push(op.opt);
        break;
      case 'removed':
        if (rejected && op.orig) blocks.push(op.orig);
        break;
    }
  }
  return blocksToContent(blocks);
}
