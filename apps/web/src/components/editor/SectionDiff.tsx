'use client';

import React from 'react';
import { Check, X, RotateCcw } from 'lucide-react';
import type { CvBlock } from '@/lib/cvFormat';
import type { WordToken, DiffDecision } from '@/lib/diff';
import type { BlockOp } from '@/lib/blockDiff';
import { InlineRuns } from '@/components/editor/CvPaper';

interface SectionDiffProps {
  ops: BlockOp[];
  decisions: Record<string, DiffDecision>;
  onDecide: (hunkId: string, decision: DiffDecision) => void;
}

function Controls({
  id,
  decision,
  onDecide,
}: {
  id: string;
  decision: DiffDecision | undefined;
  onDecide: (id: string, d: DiffDecision) => void;
}) {
  if (decision) {
    return (
      <button
        type="button"
        title="Undo decision"
        onClick={() => onDecide(id, decision)}
        className="ml-1 inline-flex h-4 w-4 translate-y-[2px] items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-600"
      >
        <RotateCcw size={11} />
      </button>
    );
  }
  return (
    <span className="ml-1 inline-flex translate-y-[2px] items-center gap-0.5 align-middle">
      <button
        type="button"
        title="Accept"
        onClick={() => onDecide(id, 'accepted')}
        className="inline-flex h-4 w-4 items-center justify-center rounded bg-green-600 text-white hover:bg-green-700"
      >
        <Check size={11} />
      </button>
      <button
        type="button"
        title="Reject"
        onClick={() => onDecide(id, 'rejected')}
        className="inline-flex h-4 w-4 items-center justify-center rounded bg-red-500 text-white hover:bg-red-600"
      >
        <X size={11} />
      </button>
    </span>
  );
}

function Tokens({ tokens }: { tokens: WordToken[] }) {
  return (
    <>
      {tokens.map((t, i) => {
        if (t.type === 'unchanged') return <span key={i}>{t.text} </span>;
        if (t.type === 'added') return <span key={i} className="text-green-700">{t.text} </span>;
        return <span key={i} className="text-red-600 line-through">{t.text} </span>;
      })}
    </>
  );
}

/** Inner content of a plain (non-diff) block — label, links, etc. */
function PlainInner({ block }: { block: CvBlock }) {
  if (block.kind === 'paragraph') return <InlineRuns runs={block.runs} />;
  if (block.kind === 'entry') return <InlineRuns runs={block.titleRuns} />;
  return (
    <>
      {block.label && <strong>{block.label}: </strong>}
      <InlineRuns runs={block.runs} />
    </>
  );
}

// Decided state → which block is shown, and whether it survives into the final CV.
function decided(op: BlockOp, d: DiffDecision): { block: CvBlock; present: boolean } {
  if (op.kind === 'added') return { block: op.opt!, present: d !== 'rejected' };
  if (op.kind === 'removed') return { block: op.orig!, present: d === 'rejected' };
  // changed
  return { block: (d === 'rejected' ? op.orig : op.opt)!, present: true };
}

const PENDING = 'rounded px-0.5 ring-1 ring-amber-200 bg-amber-50/60';
const KEPT = 'rounded px-0.5 bg-green-50 text-green-800';
const DROPPED = 'rounded px-0.5 bg-slate-100 text-slate-400 line-through';

/** Highlight span + inner content for a changed/added/removed op. */
function HunkSpan({ op, decision }: { op: BlockOp; decision: DiffDecision | undefined }) {
  if (!decision) {
    // Pending — show the change itself.
    let inner: React.ReactNode;
    if (op.kind === 'changed') inner = <Tokens tokens={op.tokens!} />;
    else if (op.kind === 'added') inner = <span className="text-green-700"><PlainInner block={op.opt!} /></span>;
    else inner = <span className="text-red-600 line-through"><PlainInner block={op.orig!} /></span>;
    return <span className={PENDING}>{inner}</span>;
  }
  const { block, present } = decided(op, decision);
  return (
    <span className={present ? KEPT : DROPPED}>
      <PlainInner block={block} />
    </span>
  );
}

export function SectionDiff({ ops, decisions, onDecide }: SectionDiffProps) {
  const out: React.ReactNode[] = [];
  let bullets: React.ReactNode[] = [];

  const flush = (key: string) => {
    if (!bullets.length) return;
    out.push(
      <ul key={key} className="mb-1">
        {bullets}
      </ul>
    );
    bullets = [];
  };

  ops.forEach((op, idx) => {
    const rep = (op.opt ?? op.orig)!;
    const decision = op.id ? decisions[op.id] : undefined;
    const controls = op.id ? <Controls id={op.id} decision={decision} onDecide={onDecide} /> : null;

    // Content node
    const body =
      op.kind === 'unchanged' ? <PlainInner block={rep} /> : <HunkSpan op={op} decision={decision} />;

    if (rep.kind === 'bullet') {
      bullets.push(
        <li
          key={idx}
          className="relative mb-1 pl-4 text-justify text-[13px] leading-relaxed text-slate-800 before:absolute before:left-0 before:text-slate-900 before:content-['•']"
        >
          {body}
          {controls}
        </li>
      );
      return;
    }

    flush(`ul-${idx}`);

    if (rep.kind === 'paragraph') {
      out.push(
        <p key={idx} className="text-justify text-[13px] leading-relaxed text-slate-800">
          {body}
          {controls}
        </p>
      );
    } else {
      // entry — bold title (+ optional right-aligned date)
      const dateBlock = op.kind === 'removed' ? op.orig : op.opt;
      const date = dateBlock?.kind === 'entry' ? dateBlock.date : undefined;
      out.push(
        <div key={idx} className="mb-0.5 mt-3 flex items-baseline justify-between gap-3">
          <span className="text-[13px] font-bold text-slate-900">
            {body}
            {controls}
          </span>
          {date && op.kind !== 'changed' && (
            <span className="whitespace-nowrap text-[13px] font-bold text-slate-900">{date}</span>
          )}
        </div>
      );
    }
  });

  flush('ul-final');
  return <>{out}</>;
}
