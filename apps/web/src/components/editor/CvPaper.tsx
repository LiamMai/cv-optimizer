'use client';

import React from 'react';
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

const PAPER_FONT = '"Helvetica Neue", Helvetica, Arial, "Segoe UI", sans-serif';

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
    <h2 className="mb-2 mt-5 flex items-center gap-2 border-b border-slate-900 pb-1 text-[13px] font-bold uppercase tracking-wide text-slate-900">
      {children}
    </h2>
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
        {bulletRun.map((b, i) =>
          b.kind === 'bullet' ? (
            <li
              key={i}
              className="relative mb-1 pl-4 text-justify text-[13px] leading-relaxed text-slate-800 before:absolute before:left-0 before:text-slate-900 before:content-['•']"
            >
              {b.label && <strong>{b.label}: </strong>}
              <InlineRuns runs={b.runs} />
            </li>
          ) : null
        )}
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
        <p key={idx} className="text-justify text-[13px] leading-relaxed text-slate-800">
          <InlineRuns runs={b.runs} />
        </p>
      );
    } else {
      out.push(
        <div key={idx} className="mb-0.5 mt-3 flex items-baseline justify-between gap-3">
          <span className="text-[13px] font-bold text-slate-900">
            <InlineRuns runs={b.titleRuns} />
          </span>
          {b.date && (
            <span className="whitespace-nowrap text-[13px] font-bold text-slate-900">{b.date}</span>
          )}
        </div>
      );
    }
  });
  flushBullets('ul-final');

  return <>{out}</>;
}

/** The CV "paper": a white page with the centered name/contact header. */
export function CvPage({
  contact,
  children,
}: {
  contact?: CVContact;
  children: React.ReactNode;
}) {
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

  return (
    <div
      className="mx-auto max-w-[760px] rounded-lg bg-white px-8 py-10 shadow-sm ring-1 ring-slate-200 sm:px-12"
      style={{ fontFamily: PAPER_FONT }}
    >
      {(name || contactLine || links.length > 0) && (
        <header className="mb-2">
          {name && (
            <div className="text-center text-[26px] font-bold leading-tight tracking-[2px] text-slate-900">
              {name}
            </div>
          )}
          {title && (
            <div className="mt-1 text-center text-[15px] font-bold uppercase tracking-wider text-slate-800">
              {title}
            </div>
          )}
          {contactLine && (
            <div className="mt-2 text-center text-[12.5px] text-slate-600">{contactLine}</div>
          )}
          {links.length > 0 && (
            <div className="mt-1 text-center text-[12.5px]">
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
      )}
      {children}
    </div>
  );
}

/** Full structured CV body (used for the original pane and the preview). */
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
