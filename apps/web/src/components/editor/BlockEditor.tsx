'use client';

// Structured, Canva-style CV editor: a flowing (non-paginated) list of sections, each
// broken into draggable/editable blocks (entries, bullets, paragraphs). Unlike
// PaginatedCv, no block here is ever split/clipped across a page break, so every
// block maps to exactly one stable DOM node — the property dnd-kit's sortable
// contexts require. Real A4 page breaks are shown separately via the read-only
// "Preview" mode (PaginatedCv, reused unchanged).
//
// Edits stay client-side: this component mutates a local, id-tagged copy of each
// section's blocks, then re-serializes via blocksToContent() and writes the flat
// string back into the store (useCVStore().updateSectionContent) on every commit —
// the server/export pipeline only ever sees the same flat CVSection.content shape
// it always has.

import React, { useEffect, useRef, useState } from 'react';
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { CVSection } from '@/lib/types';
import {
  formatSection,
  groupEntries,
  parseInline,
  runsToMarkdown,
  blocksToContent,
  sectionKind,
  type CvBlock,
} from '@/lib/cvFormat';
import { PDF_SECTION_ORDER, sectionLabel, sortByPdfOrder } from './CvPaper';
import { useCVStore } from '@/store/cvStore';
import { rescoreJob } from '@/lib/api';

type EditableBlock = CvBlock & { id: string };
interface EditableSection {
  type: string;
  blocks: EditableBlock[];
}
type BlockField = 'text' | 'title' | 'date' | 'label';

type DragData =
  | { type: 'section' }
  | { type: 'group'; sectionType: string }
  | { type: 'bullet'; sectionType: string; groupId: string };

function isDragData(data: unknown): data is DragData {
  if (!data || typeof data !== 'object') return false;
  const t = (data as { type?: unknown }).type;
  return t === 'section' || t === 'group' || t === 'bullet';
}

function stripId(b: EditableBlock): CvBlock {
  const { id: _id, ...rest } = b;
  return rest;
}

function seedSections(cvSections: CVSection[], order: string[] | null): EditableSection[] {
  const ordered = order
    ? [...cvSections].sort((a, b) => {
        const ai = order.indexOf(a.type);
        const bi = order.indexOf(b.type);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      })
    : sortByPdfOrder(cvSections);
  return ordered.map((s) => ({
    type: s.type,
    blocks: formatSection(s.type, s.content).map((b): EditableBlock => ({ ...b, id: crypto.randomUUID() })),
  }));
}

function sectionsToRecord(list: EditableSection[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of list) out[s.type] = blocksToContent(s.blocks.map(stripId));
  return out;
}

function reorderGroups(blocks: EditableBlock[], activeLeaderId: string, overLeaderId: string): EditableBlock[] {
  const groups = groupEntries(blocks, (b) => b.kind);
  const oldIndex = groups.findIndex((g) => g[0].id === activeLeaderId);
  const newIndex = groups.findIndex((g) => g[0].id === overLeaderId);
  if (oldIndex === -1 || newIndex === -1) return blocks;
  return arrayMove(groups, oldIndex, newIndex).flat();
}

function reorderBulletsInGroup(
  blocks: EditableBlock[],
  leaderId: string,
  activeId: string,
  overId: string
): EditableBlock[] {
  const groups = groupEntries(blocks, (b) => b.kind);
  return groups.flatMap((g) => {
    if (g[0].id !== leaderId) return g;
    const [head, ...rest] = g;
    const oldIndex = rest.findIndex((b) => b.id === activeId);
    const newIndex = rest.findIndex((b) => b.id === overId);
    if (oldIndex === -1 || newIndex === -1) return g;
    return [head, ...arrayMove(rest, oldIndex, newIndex)];
  });
}

// ---------------------------------------------------------------------------
// Inline editable text — an uncontrolled field seeded with the block's literal
// markdown source. Uncontrolled specifically so re-rendering the parent on every
// keystroke can't fight the caret position; commit happens on blur/Enter, and
// Ctrl/Cmd+B / Ctrl/Cmd+I splice ** / * around the current selection.
// ---------------------------------------------------------------------------

function EditableText({
  value,
  multiline,
  placeholder,
  onCommit,
  className,
  ariaLabel,
  autoFocus,
}: {
  value: string;
  multiline?: boolean;
  placeholder?: string;
  onCommit: (next: string) => void;
  className?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
}) {
  const elRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);

  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  // Focus a freshly-added block's field so typing lands in it — without this, the
  // "+ Add bullet/entry" button keeps focus, and a space in the first keystroke
  // re-triggers the button (native browser behavior for a focused <button>) instead
  // of reaching the new field.
  const focusIfNeeded = (el: HTMLTextAreaElement | HTMLInputElement | null) => {
    if (el && autoFocus) {
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }
  };

  const setTextareaRef = (el: HTMLTextAreaElement | null) => {
    elRef.current = el;
    if (el) {
      autoGrow(el);
      focusIfNeeded(el);
    }
  };

  const commit = () => {
    const next = elRef.current?.value ?? value;
    if (next !== value) onCommit(next);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    const el = elRef.current;
    if (!el) return;
    if ((e.metaKey || e.ctrlKey) && (e.key === 'b' || e.key === 'i')) {
      e.preventDefault();
      const { selectionStart, selectionEnd, value: v } = el;
      if (selectionStart == null || selectionEnd == null) return;
      const wrap = e.key === 'b' ? '**' : '*';
      el.value = v.slice(0, selectionStart) + wrap + v.slice(selectionStart, selectionEnd) + wrap + v.slice(selectionEnd);
      el.selectionStart = selectionStart + wrap.length;
      el.selectionEnd = selectionEnd + wrap.length;
      if (multiline) autoGrow(el as HTMLTextAreaElement);
    } else if (e.key === 'Escape') {
      el.value = value;
      el.blur();
    } else if (!multiline && e.key === 'Enter') {
      e.preventDefault();
      el.blur();
    }
  };

  if (multiline) {
    return (
      <textarea
        ref={setTextareaRef}
        defaultValue={value}
        key={value}
        onBlur={commit}
        onKeyDown={onKeyDown}
        onInput={(e) => autoGrow(e.currentTarget)}
        rows={1}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={className}
      />
    );
  }
  return (
    <input
      ref={(el) => {
        elRef.current = el;
        focusIfNeeded(el);
      }}
      defaultValue={value}
      key={value}
      onBlur={commit}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className={className}
    />
  );
}

// w-full matters beyond flex contexts: the standalone paragraph/summary field isn't
// inside any flex row, so flex-1 alone wouldn't size it — without an explicit width a
// <textarea> falls back to its intrinsic ~20-column browser default, wrapping into many
// narrow lines and inflating the auto-grow height far past what the text actually needs.
const FIELD_CLASS =
  'w-full min-w-0 flex-1 resize-none border-none bg-transparent p-0 text-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-primary-300 rounded dark:text-slate-200';
const TITLE_FIELD_CLASS =
  'w-full min-w-0 flex-1 border-none bg-transparent p-0 text-sm font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-primary-300 rounded dark:text-slate-100';

// ---------------------------------------------------------------------------
// A single bullet nested inside an entry — its own drag handle/sortable id,
// scoped to reorder only within that entry's bullets (see the `groupId` guard
// in handleDragEnd).
// ---------------------------------------------------------------------------

function BulletRow({
  sectionType,
  groupId,
  block,
  focusBlockId,
  onDelete,
  onEditText,
}: {
  sectionType: string;
  groupId: string;
  block: EditableBlock;
  focusBlockId: string | null;
  onDelete: () => void;
  onEditText: (blockId: string, field: BlockField, value: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
    data: { type: 'bullet', sectionType, groupId },
  });
  const style = { transform: CSS.Transform.toString(transform), transition };
  if (block.kind !== 'bullet') return null;

  return (
    <li ref={setNodeRef} style={style} className={`flex items-start gap-1.5 py-0.5 ${isDragging ? 'opacity-60' : ''}`}>
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="mt-0.5 cursor-grab touch-none rounded p-0.5 text-slate-300 hover:bg-slate-100 hover:text-slate-500 active:cursor-grabbing dark:hover:bg-slate-700"
        aria-label="Drag to reorder bullet"
      >
        <GripVertical size={13} />
      </button>
      <span className="mt-0.5 text-slate-400">•</span>
      {block.label !== undefined && (
        <EditableText
          value={block.label ?? ''}
          placeholder="Label"
          onCommit={(v) => onEditText(block.id, 'label', v)}
          className="w-20 shrink-0 border-none bg-transparent p-0 text-sm font-semibold text-slate-700 focus:outline-none focus:ring-1 focus:ring-primary-300 rounded dark:text-slate-200"
          ariaLabel="Bullet label"
        />
      )}
      <EditableText
        multiline
        value={runsToMarkdown(block.runs)}
        placeholder="…"
        onCommit={(v) => onEditText(block.id, 'text', v)}
        className={FIELD_CLASS}
        ariaLabel="Bullet text"
        autoFocus={block.id === focusBlockId}
      />
      <button
        type="button"
        onClick={onDelete}
        className="mt-0.5 rounded p-0.5 text-slate-300 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
        title="Remove bullet"
        aria-label="Remove bullet"
      >
        <Trash2 size={12} />
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// One draggable group: an entry (title + date + its bullets) or, for list-kind
// sections, a single bullet. Reordering groups covers both "entries within a
// section" and "bullets within a list section" — they're the same operation.
// ---------------------------------------------------------------------------

function GroupRow({
  sectionType,
  group,
  focusBlockId,
  onDeleteGroup,
  onDeleteBlock,
  onAddBullet,
  onEditText,
}: {
  sectionType: string;
  group: EditableBlock[];
  focusBlockId: string | null;
  onDeleteGroup: (leaderId: string) => void;
  onDeleteBlock: (blockId: string) => void;
  onAddBullet: (afterGroupLeaderId?: string) => void;
  onEditText: (blockId: string, field: BlockField, value: string) => void;
}) {
  const leader = group[0];
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: leader.id,
    data: { type: 'group', sectionType },
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  if (leader.kind === 'entry') {
    const bullets = group.slice(1);
    const bulletIds = bullets.map((b) => b.id);
    return (
      <div
        ref={setNodeRef}
        style={style}
        className={`rounded-md border border-slate-100 p-2 dark:border-slate-700 ${isDragging ? 'opacity-60' : ''}`}
      >
        <div className="flex items-start gap-1.5">
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="mt-1 cursor-grab touch-none rounded p-0.5 text-slate-300 hover:bg-slate-100 hover:text-slate-500 active:cursor-grabbing dark:hover:bg-slate-700"
            aria-label="Drag to reorder entry"
          >
            <GripVertical size={14} />
          </button>
          <div className="flex flex-1 items-baseline justify-between gap-2">
            <EditableText
              value={runsToMarkdown(leader.titleRuns)}
              placeholder="Role · Company"
              onCommit={(v) => onEditText(leader.id, 'title', v)}
              className={TITLE_FIELD_CLASS}
              ariaLabel="Entry title"
              autoFocus={leader.id === focusBlockId}
            />
            <EditableText
              value={leader.date ?? ''}
              placeholder="Dates"
              onCommit={(v) => onEditText(leader.id, 'date', v)}
              className="w-28 shrink-0 border-none bg-transparent p-0 text-right text-sm font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-primary-300 rounded dark:text-slate-100"
              ariaLabel="Entry dates"
            />
          </div>
          <button
            type="button"
            onClick={() => onDeleteGroup(leader.id)}
            className="mt-1 rounded p-0.5 text-slate-300 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
            title="Remove entry"
            aria-label="Remove entry"
          >
            <Trash2 size={13} />
          </button>
        </div>

        <SortableContext items={bulletIds} strategy={verticalListSortingStrategy}>
          <ul className="mt-1 space-y-0.5 pl-5">
            {bullets.map((b) => (
              <BulletRow
                key={b.id}
                sectionType={sectionType}
                groupId={leader.id}
                block={b}
                focusBlockId={focusBlockId}
                onDelete={() => onDeleteBlock(b.id)}
                onEditText={onEditText}
              />
            ))}
          </ul>
        </SortableContext>
        <button
          type="button"
          onClick={() => onAddBullet(leader.id)}
          className="ml-5 mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700"
        >
          <Plus size={12} /> Add bullet
        </button>
      </div>
    );
  }

  if (leader.kind === 'bullet') {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className={`flex items-start gap-1.5 py-0.5 ${isDragging ? 'opacity-60' : ''}`}
      >
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="mt-0.5 cursor-grab touch-none rounded p-0.5 text-slate-300 hover:bg-slate-100 hover:text-slate-500 active:cursor-grabbing dark:hover:bg-slate-700"
          aria-label="Drag to reorder"
        >
          <GripVertical size={14} />
        </button>
        <span className="mt-0.5 text-slate-400">•</span>
        {leader.label !== undefined && (
          <EditableText
            value={leader.label ?? ''}
            placeholder="Label"
            onCommit={(v) => onEditText(leader.id, 'label', v)}
            className="w-20 shrink-0 border-none bg-transparent p-0 text-sm font-semibold text-slate-700 focus:outline-none focus:ring-1 focus:ring-primary-300 rounded dark:text-slate-200"
            ariaLabel="Bullet label"
          />
        )}
        <EditableText
          multiline
          value={runsToMarkdown(leader.runs)}
          placeholder="…"
          onCommit={(v) => onEditText(leader.id, 'text', v)}
          className={FIELD_CLASS}
          ariaLabel="Bullet text"
          autoFocus={leader.id === focusBlockId}
        />
        <button
          type="button"
          onClick={() => onDeleteGroup(leader.id)}
          className="mt-0.5 rounded p-0.5 text-slate-300 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
          title="Remove"
          aria-label="Remove"
        >
          <Trash2 size={13} />
        </button>
      </div>
    );
  }

  return null; // unreachable — paragraph-kind sections never enter the group path
}

// ---------------------------------------------------------------------------
// One section card: drag handle to reorder among sections, a body that's either
// a single paragraph field or a sortable list of entry/bullet groups.
// ---------------------------------------------------------------------------

function SectionCard({
  section,
  focusBlockId,
  onDeleteSection,
  onAddBullet,
  onAddEntry,
  onDeleteGroup,
  onDeleteBlock,
  onEditText,
}: {
  section: EditableSection;
  focusBlockId: string | null;
  onDeleteSection: () => void;
  onAddBullet: (afterGroupLeaderId?: string) => void;
  onAddEntry: () => void;
  onDeleteGroup: (leaderId: string) => void;
  onDeleteBlock: (blockId: string) => void;
  onEditText: (blockId: string, field: BlockField, value: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: section.type,
    data: { type: 'section' },
  });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const kind = sectionKind(section.type);
  const groups = groupEntries(section.blocks, (b) => b.kind);
  const groupIds = groups.map((g) => g[0].id);
  const firstBlock = section.blocks[0];

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 ${isDragging ? 'opacity-60' : ''}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="cursor-grab touch-none rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing dark:hover:bg-slate-700"
            aria-label={`Drag to reorder ${sectionLabel(section.type)}`}
          >
            <GripVertical size={15} />
          </button>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {sectionLabel(section.type)}
          </h3>
        </div>
        <button
          type="button"
          onClick={onDeleteSection}
          className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
          title="Remove section"
          aria-label={`Remove ${sectionLabel(section.type)}`}
        >
          <Trash2 size={14} />
        </button>
      </div>

      {kind === 'paragraph' && firstBlock?.kind === 'paragraph' ? (
        <EditableText
          multiline
          value={runsToMarkdown(firstBlock.runs)}
          placeholder="Write a short professional summary…"
          onCommit={(v) => onEditText(firstBlock.id, 'text', v)}
          className={FIELD_CLASS}
          ariaLabel={sectionLabel(section.type)}
          autoFocus={firstBlock.id === focusBlockId}
        />
      ) : (
        <SortableContext items={groupIds} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {groups.map((g) => (
              <GroupRow
                key={g[0].id}
                sectionType={section.type}
                group={g}
                focusBlockId={focusBlockId}
                onDeleteGroup={onDeleteGroup}
                onDeleteBlock={onDeleteBlock}
                onAddBullet={onAddBullet}
                onEditText={onEditText}
              />
            ))}
          </div>
        </SortableContext>
      )}

      {kind === 'entries' && (
        <button
          type="button"
          onClick={onAddEntry}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700"
        >
          <Plus size={13} /> Add entry
        </button>
      )}
      {kind === 'list' && (
        <button
          type="button"
          onClick={() => onAddBullet()}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700"
        >
          <Plus size={13} /> Add item
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// BlockEditor — the editing surface itself.
// ---------------------------------------------------------------------------

export function BlockEditor({ jobId, sections: cvSections }: { jobId: string; sections: CVSection[] }) {
  const { sectionOrder, updateSectionContent, setSectionOrder, setAtsScore } = useCVStore();
  const [sections, setSections] = useState<EditableSection[]>(() => seedSections(cvSections, sectionOrder));
  // Id of a just-added block to autofocus once, so typing lands in it instead of
  // re-triggering the still-focused "Add" button. Cleared right after the mount
  // that consumes it — see EditableText's focusIfNeeded.
  const [focusBlockId, setFocusBlockId] = useState<string | null>(null);
  const focusNewBlock = (id: string) => {
    setFocusBlockId(id);
    setTimeout(() => setFocusBlockId(null), 0);
  };

  // Re-seed only when the job identity changes — never on our own store writes,
  // or an in-flight edit/drag would be clobbered mid-interaction.
  const prevJobIdRef = useRef(jobId);
  useEffect(() => {
    if (prevJobIdRef.current !== jobId) {
      prevJobIdRef.current = jobId;
      setSections(seedSections(cvSections, sectionOrder));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const rescoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (rescoreTimer.current) clearTimeout(rescoreTimer.current);
    },
    []
  );
  const scheduleRescore = (next: EditableSection[]) => {
    if (rescoreTimer.current) clearTimeout(rescoreTimer.current);
    rescoreTimer.current = setTimeout(() => {
      rescoreJob(jobId, sectionsToRecord(next))
        .then(setAtsScore)
        .catch(() => {
          // Best-effort — the header score just stays at its last known value.
        });
    }, 800);
  };

  const commitSection = (type: string, blocks: EditableBlock[]) => {
    updateSectionContent(type, blocksToContent(blocks.map(stripId)));
  };

  const withUpdatedSection = (type: string, updater: (blocks: EditableBlock[]) => EditableBlock[]): EditableSection[] =>
    sections.map((s) => (s.type === type ? { ...s, blocks: updater(s.blocks) } : s));

  const applySectionEdit = (type: string, updater: (blocks: EditableBlock[]) => EditableBlock[]) => {
    const next = withUpdatedSection(type, updater);
    setSections(next);
    commitSection(type, next.find((s) => s.type === type)!.blocks);
    scheduleRescore(next);
  };

  const onEditText = (sectionType: string, blockId: string, field: BlockField, value: string) => {
    applySectionEdit(sectionType, (blocks) =>
      blocks.map((b) => {
        if (b.id !== blockId) return b;
        if (field === 'date' && b.kind === 'entry') return { ...b, date: value || undefined };
        if (field === 'title' && b.kind === 'entry') return { ...b, titleRuns: parseInline(value) };
        if (field === 'label' && b.kind === 'bullet') return { ...b, label: value || undefined };
        if (field === 'text' && (b.kind === 'bullet' || b.kind === 'paragraph')) return { ...b, runs: parseInline(value) };
        return b;
      })
    );
  };

  const onAddBullet = (sectionType: string, afterGroupLeaderId?: string) => {
    const newBlock: EditableBlock = { id: crypto.randomUUID(), kind: 'bullet', runs: [{ text: '' }] };
    applySectionEdit(sectionType, (blocks) => {
      if (!afterGroupLeaderId) return [...blocks, newBlock];
      const groups = groupEntries(blocks, (b) => b.kind);
      const flat: EditableBlock[] = [];
      for (const g of groups) {
        flat.push(...g);
        if (g[0].id === afterGroupLeaderId) flat.push(newBlock);
      }
      return flat;
    });
    focusNewBlock(newBlock.id);
  };

  const onAddEntry = (sectionType: string) => {
    const newEntry: EditableBlock = { id: crypto.randomUUID(), kind: 'entry', titleRuns: [{ text: '' }] };
    applySectionEdit(sectionType, (blocks) => [...blocks, newEntry]);
    focusNewBlock(newEntry.id);
  };

  const onDeleteBlock = (sectionType: string, blockId: string) => {
    applySectionEdit(sectionType, (blocks) => blocks.filter((b) => b.id !== blockId));
  };

  const onDeleteGroup = (sectionType: string, leaderId: string) => {
    applySectionEdit(sectionType, (blocks) =>
      groupEntries(blocks, (b) => b.kind)
        .filter((g) => g[0].id !== leaderId)
        .flat()
    );
  };

  const onDeleteSection = (sectionType: string) => {
    updateSectionContent(sectionType, '');
    const next = sections.filter((s) => s.type !== sectionType);
    setSections(next);
    setSectionOrder(next.map((s) => s.type));
  };

  const onAddSection = (sectionType: string) => {
    const kind = sectionKind(sectionType);
    const initialBlock: EditableBlock =
      kind === 'paragraph'
        ? { id: crypto.randomUUID(), kind: 'paragraph', runs: [{ text: '' }] }
        : { id: crypto.randomUUID(), kind: 'bullet', runs: [{ text: '' }] };
    const next = [...sections, { type: sectionType, blocks: [initialBlock] }];
    setSections(next);
    commitSection(sectionType, [initialBlock]);
    setSectionOrder(next.map((s) => s.type));
    focusNewBlock(initialBlock.id);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const a = active.data.current;
    const o = over.data.current;
    if (!isDragData(a) || !isDragData(o) || a.type !== o.type) return;

    if (a.type === 'section') {
      const oldIndex = sections.findIndex((s) => s.type === active.id);
      const newIndex = sections.findIndex((s) => s.type === over.id);
      if (oldIndex === -1 || newIndex === -1) return;
      const next = arrayMove(sections, oldIndex, newIndex);
      setSections(next);
      setSectionOrder(next.map((s) => s.type));
      scheduleRescore(next);
      return;
    }

    if (a.type === 'group' && o.type === 'group' && a.sectionType === o.sectionType) {
      const next = withUpdatedSection(a.sectionType, (blocks) =>
        reorderGroups(blocks, String(active.id), String(over.id))
      );
      setSections(next);
      commitSection(a.sectionType, next.find((s) => s.type === a.sectionType)!.blocks);
      scheduleRescore(next);
      return;
    }

    if (a.type === 'bullet' && o.type === 'bullet' && a.sectionType === o.sectionType && a.groupId === o.groupId) {
      const next = withUpdatedSection(a.sectionType, (blocks) =>
        reorderBulletsInGroup(blocks, a.groupId, String(active.id), String(over.id))
      );
      setSections(next);
      commitSection(a.sectionType, next.find((s) => s.type === a.sectionType)!.blocks);
      scheduleRescore(next);
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const availableToAdd = PDF_SECTION_ORDER.filter((t) => !sections.some((s) => s.type === t));

  return (
    <div className="mx-auto max-w-[760px] space-y-4 px-1 pb-10">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        modifiers={[restrictToVerticalAxis]}
      >
        <SortableContext items={sections.map((s) => s.type)} strategy={verticalListSortingStrategy}>
          {sections.map((s) => (
            <SectionCard
              key={s.type}
              section={s}
              focusBlockId={focusBlockId}
              onDeleteSection={() => onDeleteSection(s.type)}
              onAddBullet={(afterGroupLeaderId) => onAddBullet(s.type, afterGroupLeaderId)}
              onAddEntry={() => onAddEntry(s.type)}
              onDeleteGroup={(leaderId) => onDeleteGroup(s.type, leaderId)}
              onDeleteBlock={(blockId) => onDeleteBlock(s.type, blockId)}
              onEditText={(blockId, field, value) => onEditText(s.type, blockId, field, value)}
            />
          ))}
        </SortableContext>
      </DndContext>

      {availableToAdd.length > 0 && (
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) onAddSection(e.target.value);
          }}
          className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
        >
          <option value="">+ Add section…</option>
          {availableToAdd.map((t) => (
            <option key={t} value={t}>
              {sectionLabel(t)}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
