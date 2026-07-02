'use client';

import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CVContact, CVSection } from '@/lib/types';
import { formatSection, type CvBlock, type InlineRun } from '@/lib/cvFormat';

// Section display order + labels, matching the PDF export template.
export const PDF_SECTION_ORDER = [
  'summary',
  'skills',
  'experience',
  'projects',
  'education',
  'certifications',
  'languages',
  'awards',
  'publications',
  'volunteer',
  'other',
];

const SECTION_LABELS: Record<string, string> = {
  summary: 'Summary',
  skills: 'Skills',
  experience: 'Work Experience',
  projects: 'Projects',
  education: 'Education',
  certifications: 'Certifications',
  languages: 'Languages',
  awards: 'Awards & Honours',
  publications: 'Publications',
  volunteer: 'Volunteer Experience',
  other: 'Additional',
};

export function sectionLabel(type: string): string {
  return SECTION_LABELS[type] ?? type.charAt(0).toUpperCase() + type.slice(1);
}

export function sortByPdfOrder(sections: CVSection[]): CVSection[] {
  return [...sections].sort((a, b) => {
    const ai = PDF_SECTION_ORDER.indexOf(a.type);
    const bi = PDF_SECTION_ORDER.indexOf(b.type);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
}

// Matches the PDF export template: Inter, 11pt body, 25pt name, 15pt title, 13pt headings.
// next/font exposes Inter under a hashed family name via the --font-inter variable
// (set on <html> in layout.tsx) — the literal "Inter" only matches a locally installed copy.
const PAPER_FONT = 'var(--font-inter), Inter, "Helvetica Neue", Helvetica, Arial, "Segoe UI", sans-serif';

// A4 geometry, mirroring the PDF export margins (14mm vertical / 16mm horizontal).
const MM_TO_PX = 96 / 25.4;
const PAGE_W_PX = Math.round(210 * MM_TO_PX); // ≈ 794
const PAGE_CONTENT_H_PX = (297 - 14 * 2) * MM_TO_PX; // ≈ 1017

/** Inline text with clickable links. */
export function InlineRuns({ runs }: { runs: InlineRun[] }) {
  return (
    <>
      {runs.map((r, i) =>
        r.href ? (
          <a
            key={i}
            href={r.href}
            target="_blank"
            rel="noreferrer"
            className="text-blue-700 underline"
          >
            {r.text}
          </a>
        ) : (
          <React.Fragment key={i}>{r.text}</React.Fragment>
        )
      )}
    </>
  );
}

/** Ruled, uppercase section heading like the PDF. */
export function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 mt-5 flex items-center gap-2 border-b border-slate-900 pb-1 text-[13pt] font-bold uppercase tracking-wide text-slate-900">
      {children}
    </h2>
  );
}

const LI_CLASS =
  "relative mb-1 pl-4 text-justify text-[11pt] leading-[1.45] text-slate-800 before:absolute before:left-0 before:text-slate-900 before:content-['•']";
const PARA_CLASS = 'text-justify text-[11pt] leading-[1.45] text-slate-800';
const ENTRY_TITLE_CLASS = 'text-[11pt] font-bold text-slate-900';

function BulletItem({ b }: { b: Extract<CvBlock, { kind: 'bullet' }> }) {
  return (
    <li className={LI_CLASS}>
      {b.label && <strong>{b.label}: </strong>}
      <InlineRuns runs={b.runs} />
    </li>
  );
}

function EntryRow({ b }: { b: Extract<CvBlock, { kind: 'entry' }> }) {
  return (
    <div className="mb-0.5 mt-3 flex items-baseline justify-between gap-3">
      <span className={ENTRY_TITLE_CLASS}>
        <InlineRuns runs={b.titleRuns} />
      </span>
      {b.date && <span className={`whitespace-nowrap ${ENTRY_TITLE_CLASS}`}>{b.date}</span>}
    </div>
  );
}

/** Render structured blocks for one section (PDF-style body). */
export function FormattedBlocks({ blocks }: { blocks: CvBlock[] }) {
  const out: React.ReactNode[] = [];
  let bulletRun: CvBlock[] = [];

  const flushBullets = (key: string) => {
    if (!bulletRun.length) return;
    out.push(
      <ul key={key} className="mb-1">
        {bulletRun.map((b, i) => (b.kind === 'bullet' ? <BulletItem key={i} b={b} /> : null))}
      </ul>
    );
    bulletRun = [];
  };

  blocks.forEach((b, idx) => {
    if (b.kind === 'bullet') {
      bulletRun.push(b);
      return;
    }
    flushBullets(`ul-${idx}`);
    if (b.kind === 'paragraph') {
      out.push(
        <p key={idx} className={PARA_CLASS}>
          <InlineRuns runs={b.runs} />
        </p>
      );
    } else {
      out.push(<EntryRow key={idx} b={b} />);
    }
  });
  flushBullets('ul-final');

  return <>{out}</>;
}

/** Centered name / title / contact / links header, shared by both paper layouts. */
function CvHeader({ contact }: { contact?: CVContact }) {
  const name = contact?.name;
  const title = contact?.title;
  const contactLine = [contact?.location, contact?.phone, contact?.email].filter(Boolean).join(' • ');
  const links: Array<{ label: string; href: string }> = [];
  for (const [key, label] of [
    ['portfolio', 'Portfolio'],
    ['linkedin', 'LinkedIn'],
    ['github', 'GitHub'],
    ['website', 'Website'],
  ] as const) {
    const href = contact?.[key];
    if (href) links.push({ label, href });
  }

  if (!name && !contactLine && links.length === 0) return null;
  return (
    <header className="mb-2">
      {name && (
        <div className="text-center text-[25pt] font-bold leading-tight tracking-[2px] text-slate-900">
          {name}
        </div>
      )}
      {title && (
        <div className="mt-1 text-center text-[15pt] font-bold uppercase tracking-wider text-slate-800">
          {title}
        </div>
      )}
      {contactLine && (
        <div className="mt-2 text-center text-[10pt] text-slate-600">{contactLine}</div>
      )}
      {links.length > 0 && (
        <div className="mt-1 text-center text-[10pt]">
          {links.map((l, i) => (
            <React.Fragment key={l.href}>
              {i > 0 && <span className="mx-2 text-slate-400">•</span>}
              <a href={l.href} target="_blank" rel="noreferrer" className="text-blue-700 underline">
                {l.label}
              </a>
            </React.Fragment>
          ))}
        </div>
      )}
    </header>
  );
}

/** The CV "paper": a continuous white page with the centered header (review/original panes). */
export function CvPage({
  contact,
  children,
}: {
  contact?: CVContact;
  children: React.ReactNode;
}) {
  return (
    <div
      className="mx-auto max-w-[760px] rounded-lg bg-white px-8 py-10 shadow-sm ring-1 ring-slate-200 sm:px-12"
      style={{ fontFamily: PAPER_FONT }}
    >
      <CvHeader contact={contact} />
      {children}
    </div>
  );
}

/** Full structured CV body (used for the original pane and the review pane). */
export function FormattedCv({ sections }: { sections: CVSection[] }) {
  return (
    <>
      {sortByPdfOrder(sections).map((s) => {
        const blocks = formatSection(s.type, s.content);
        if (!blocks.length) return null;
        return (
          <section key={s.type}>
            <SectionHeading>{sectionLabel(s.type)}</SectionHeading>
            <FormattedBlocks blocks={blocks} />
          </section>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Paginated preview — real A4 pages with the same break rules as the PDF:
// a section heading never sits alone at a page bottom, and a whole entry
// (job/project header + its bullets) never splits across pages.
// ---------------------------------------------------------------------------

// An atom is the smallest unit of pagination. `glueNext` marks a heading that must
// not be the last thing on its page. Atoms sharing a `groupId` form one entry
// (job/project header + bullets): the header never separates from the start of its
// first bullet. `splittable` atoms (bullets, paragraphs) may split at text-line
// boundaries — keeping at least two lines on each side, like print orphans/widows —
// so pages fill completely.
interface Atom {
  key: string;
  glueNext?: boolean;
  groupId?: string;
  splittable?: boolean;
  node: React.ReactNode;
}

// Line metrics of a splittable atom's text element, captured during measurement.
interface AtomMeta {
  contentH: number;
  lineH: number;
  lines: number;
}

// A slice of an atom placed on a page: whole atom, or a clipped window of its lines.
interface Segment {
  i: number;
  clip?: { top: number; height: number };
}

// Cap on how much room a non-entry atom (paragraph, list bullet) can demand at a
// page bottom before it simply jumps to the next page.
const LEAD_CAP_PX = PAGE_CONTENT_H_PX * 0.2;

function buildAtoms(contact: CVContact | undefined, sections: CVSection[]): Atom[] {
  const atoms: Atom[] = [];
  const hasHeader =
    !!contact &&
    [contact.name, contact.title, contact.location, contact.phone, contact.email, contact.portfolio, contact.linkedin, contact.github, contact.website].some(Boolean);
  if (hasHeader) atoms.push({ key: 'header', node: <CvHeader contact={contact} /> });

  for (const s of sortByPdfOrder(sections)) {
    const blocks = formatSection(s.type, s.content);
    if (!blocks.length) continue;
    atoms.push({
      key: `${s.type}:h`,
      glueNext: true,
      node: <SectionHeading>{sectionLabel(s.type)}</SectionHeading>,
    });

    // Group an entry with all of its bullets into one unbreakable atom; loose
    // bullets (list sections) and paragraphs are individual atoms, mirroring
    // the PDF's `li { break-inside: avoid }` / `.entry-block { break-inside: avoid }`.
    let entry: CvBlock[] | null = null;
    const groups: CvBlock[][] = [];
    for (const b of blocks) {
      if (b.kind === 'entry') {
        entry = [b];
        groups.push(entry);
      } else if (entry && b.kind === 'bullet') {
        entry.push(b);
      } else {
        groups.push([b]);
        entry = null;
      }
    }

    groups.forEach((group, gi) => {
      const key = `${s.type}:${gi}`;
      const [head, ...rest] = group;
      if (head.kind === 'entry') {
        // Header + each bullet are separate atoms tied by groupId, so paginate()
        // can keep a short entry whole but break a long one at bullet boundaries.
        atoms.push({ key: `${key}:h`, groupId: key, node: <EntryRow b={head} /> });
        rest.forEach((b, i) => {
          if (b.kind !== 'bullet') return;
          atoms.push({
            key: `${key}:b${i}`,
            groupId: key,
            splittable: true,
            node: (
              <ul>
                <BulletItem b={b} />
              </ul>
            ),
          });
        });
      } else if (head.kind === 'paragraph') {
        atoms.push({
          key,
          splittable: true,
          node: (
            <p className={PARA_CLASS}>
              <InlineRuns runs={head.runs} />
            </p>
          ),
        });
      } else {
        atoms.push({
          key,
          splittable: true,
          node: (
            <ul>
              <BulletItem b={head} />
            </ul>
          ),
        });
      }
    });
  }
  return atoms;
}

/**
 * Distribute atoms into pages of A4 content height, filling each page as far as
 * possible. Rules:
 * - an entry group starts on the current page whenever its header + the start of
 *   its first bullet fit (that chunk never separates); the rest flows onward;
 * - a section heading is never the last thing on a page — it needs room for the
 *   lead chunk of whatever follows;
 * - a splittable atom (bullet / paragraph) that doesn't fit splits at a text-line
 *   boundary, keeping ≥ 2 lines on each side (print orphans/widows); anything
 *   else jumps whole only when it doesn't fit.
 */
function paginate(atoms: Atom[], extents: number[], metas: (AtomMeta | null)[]): Segment[][] {
  const H = PAGE_CONTENT_H_PX;
  const pages: Segment[][] = [[]];
  let used = 0;
  const newPage = () => {
    pages.push([]);
    used = 0;
  };
  const place = (i: number) => {
    pages[pages.length - 1].push({ i });
    used += extents[i];
  };
  // Place a flowing atom: fit whole, else split at a line boundary, else jump whole.
  const placeFlow = (i: number) => {
    if (used === 0 || used + extents[i] <= H) {
      place(i);
      return;
    }
    const m = metas[i];
    if (atoms[i].splittable && m && m.lines >= 4) {
      const fit = Math.min(Math.floor((H - used) / m.lineH), m.lines - 2);
      if (fit >= 2) {
        const h1 = fit * m.lineH;
        pages[pages.length - 1].push({ i, clip: { top: 0, height: h1 } });
        newPage();
        const h2 = m.contentH - h1;
        pages[pages.length - 1].push({ i, clip: { top: h1, height: h2 } });
        used += h2 + (extents[i] - m.contentH); // remaining lines + trailing margin
        return;
      }
    }
    newPage();
    place(i);
  };
  const groupEnd = (i: number): number => {
    let j = i;
    while (j < atoms.length && atoms[j].groupId === atoms[i].groupId) j++;
    return j;
  };
  const sum = (a: number, b: number) => {
    let s = 0;
    for (let j = a; j < b; j++) s += extents[j];
    return s;
  };
  // The unbreakable lead chunk of a group: the header plus the start of its first
  // bullet — two lines if the bullet can split, the whole bullet otherwise.
  const minChunk = (i: number, end: number) => {
    if (i + 1 >= end) return extents[i];
    const m = metas[i + 1];
    const firstLead = m && m.lines >= 4 ? 2 * m.lineH : extents[i + 1];
    return extents[i] + firstLead;
  };
  // Height the unit starting at atom i needs on the current page before it may break.
  const leadNeed = (i: number): number => {
    if (i >= atoms.length) return 0;
    if (atoms[i].groupId != null) return minChunk(i, groupEnd(i));
    return Math.min(extents[i], LEAD_CAP_PX);
  };

  let i = 0;
  while (i < atoms.length) {
    const a = atoms[i];
    if (a.glueNext) {
      if (used > 0 && used + extents[i] + leadNeed(i + 1) > H) newPage();
      place(i);
      i++;
      continue;
    }
    if (a.groupId != null) {
      const end = groupEnd(i);
      if (used > 0 && used + minChunk(i, end) > H) newPage();
      if (used + sum(i, end) <= H) {
        for (let j = i; j < end; j++) place(j);
      } else {
        // the minChunk check guarantees the header + start of the first bullet fit
        place(i);
        for (let j = i + 1; j < end; j++) placeFlow(j);
      }
      i = end;
      continue;
    }
    placeFlow(i);
    i++;
  }
  return pages;
}

/**
 * A4-paginated CV preview matching the downloaded PDF: same fonts/sizes, same
 * page-break rules. Renders the atoms once into a hidden measurer, distributes
 * them into pages by measured height, and scales pages down to fit the pane.
 */
export function PaginatedCv({
  contact,
  sections,
}: {
  contact?: CVContact;
  sections: CVSection[];
}) {
  const atoms = useMemo(() => buildAtoms(contact, sections), [contact, sections]);
  const measureRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<Segment[][] | null>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    let cancelled = false;
    const measure = () => {
      const el = measureRef.current;
      if (cancelled || !el) return;
      const children = Array.from(el.children) as HTMLElement[];
      if (children.length !== atoms.length) return;
      const tops = children.map((c) => c.offsetTop);
      const extents = children.map(
        (c, i) => (i + 1 < children.length ? tops[i + 1] : el.scrollHeight) - tops[i]
      );
      // Line metrics for splittable atoms so paginate() can cut at line boundaries.
      const metas = children.map((c, i): AtomMeta | null => {
        if (!atoms[i].splittable) return null;
        const text = c.querySelector('li, p');
        if (!text) return null;
        const contentH = text.getBoundingClientRect().height;
        const lineH = parseFloat(getComputedStyle(text).lineHeight);
        if (!lineH || !isFinite(lineH)) return null;
        return { contentH, lineH, lines: Math.max(1, Math.round(contentH / lineH)) };
      });
      setPages(paginate(atoms, extents, metas));
    };
    measure();
    // Re-measure once webfonts finish loading — Inter metrics change line wraps.
    document.fonts?.ready?.then(() => {
      if (!cancelled) measure();
    });
    return () => {
      cancelled = true;
    };
  }, [atoms]);

  // Scale pages down when the pane is narrower than a real A4 page.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setScale(Math.min(1, el.clientWidth / PAGE_W_PX));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A clipped segment shows a window of the atom's lines: the same rendered node,
  // shifted up and cropped, so a split bullet continues seamlessly on the next page.
  const pageInner = (segments: Segment[]) =>
    segments.map((s) =>
      s.clip ? (
        <div
          key={`${atoms[s.i].key}@${Math.round(s.clip.top)}`}
          style={{ height: s.clip.height, overflow: 'hidden' }}
        >
          <div style={{ marginTop: -s.clip.top }}>{atoms[s.i].node}</div>
        </div>
      ) : (
        <div key={atoms[s.i].key}>{atoms[s.i].node}</div>
      )
    );

  return (
    <div ref={wrapRef} style={{ fontFamily: PAPER_FONT }}>
      {/* Hidden measurer at true A4 content width. */}
      <div
        ref={measureRef}
        aria-hidden
        className="pointer-events-none absolute left-[-9999px] top-0 invisible"
        style={{ width: '178mm' }}
      >
        {atoms.map((a) => (
          <div key={a.key}>{a.node}</div>
        ))}
      </div>

      <div style={{ zoom: scale }} className="flex flex-col items-center gap-6">
        {(pages ?? [atoms.map((_, i): Segment => ({ i }))]).map((indices, pi, all) => (
          <div key={pi} className="shrink-0">
            <div className="mb-1 text-center text-[11px] text-slate-400">
              Page {pi + 1} / {all.length}
            </div>
            <div
              className="overflow-hidden bg-white shadow-sm ring-1 ring-slate-200"
              style={{
                width: '210mm',
                height: pages ? '297mm' : undefined,
                minHeight: '297mm',
                padding: '14mm 16mm',
              }}
            >
              {pageInner(indices)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
