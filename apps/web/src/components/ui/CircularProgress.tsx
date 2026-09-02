'use client';

import React, { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface CircularProgressProps {
  score: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
  className?: string;
}

function getColor(score: number): string {
  if (score >= 75) return '#16a34a'; // green-600
  if (score >= 50) return '#f59e0b'; // amber-500
  return '#ef4444'; // red-500
}

// Tailwind classes (not inline hex) so the track can pick up a dark: variant via CSS,
// unlike getColor()'s solid arc/label color which reads fine unchanged in both themes.
function getTrackColorClass(score: number): string {
  if (score >= 75) return 'stroke-green-100 dark:stroke-green-900/40';
  if (score >= 50) return 'stroke-amber-100 dark:stroke-amber-900/40';
  return 'stroke-red-100 dark:stroke-red-900/40';
}

export function CircularProgress({
  score,
  size = 120,
  strokeWidth = 10,
  label,
  className,
}: CircularProgressProps) {
  const [animatedScore, setAnimatedScore] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setAnimatedScore(score), 100);
    return () => clearTimeout(timer);
  }, [score]);

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (animatedScore / 100) * circumference;
  const cx = size / 2;
  const cy = size / 2;

  return (
    <div className={cn('flex flex-col items-center gap-1', className)}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        aria-label={`Score: ${score}%`}
      >
        {/* Track */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          className={getTrackColorClass(score)}
          strokeWidth={strokeWidth}
        />
        {/* Progress */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke={getColor(score)}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1s ease-in-out' }}
        />
      </svg>
      {/* Center label — undo SVG rotation with a DOM element */}
      <div
        className="pointer-events-none absolute flex flex-col items-center justify-center"
        style={{ width: size, height: size }}
        aria-hidden
      >
        <span
          className="font-bold leading-none"
          style={{ fontSize: size * 0.22, color: getColor(score) }}
        >
          {animatedScore}
        </span>
        <span className="text-xs text-slate-500">/ 100</span>
      </div>
      {label && <span className="text-sm font-medium text-slate-600 dark:text-slate-400">{label}</span>}
    </div>
  );
}

// Wrapper that positions the overlay correctly
export function CircularProgressWithCenter({
  score,
  size = 120,
  strokeWidth = 10,
  label,
  className,
}: CircularProgressProps) {
  const [animatedScore, setAnimatedScore] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setAnimatedScore(score), 100);
    return () => clearTimeout(timer);
  }, [score]);

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (animatedScore / 100) * circumference;
  const cx = size / 2;
  const cy = size / 2;

  return (
    <div className={cn('flex flex-col items-center gap-2', className)}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="-rotate-90"
          aria-label={`Score: ${score}%`}
        >
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            className={getTrackColorClass(score)}
            strokeWidth={strokeWidth}
          />
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke={getColor(score)}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 1s ease-in-out' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="font-bold leading-none"
            style={{ fontSize: size * 0.22, color: getColor(score) }}
          >
            {animatedScore}
          </span>
          <span className="text-xs text-slate-500">/ 100</span>
        </div>
      </div>
      {label && <span className="text-sm font-semibold text-slate-600 dark:text-slate-400">{label}</span>}
    </div>
  );
}
