import React from 'react';
import { cn } from '@/lib/utils';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  hover?: boolean;
}

export function Card({ className, hover = false, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-slate-200 bg-white shadow-sm',
        hover && 'transition-shadow hover:shadow-md',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  description?: string;
  action?: React.ReactNode;
}

export function CardHeader({ className, title, description, action, children, ...props }: CardHeaderProps) {
  return (
    <div
      className={cn('flex items-start justify-between border-b border-slate-100 px-6 py-4', className)}
      {...props}
    >
      <div className="flex-1">
        {title && <h3 className="font-semibold text-slate-900">{title}</h3>}
        {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
        {children}
      </div>
      {action && <div className="ml-4 shrink-0">{action}</div>}
    </div>
  );
}

export function CardContent({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('px-6 py-4', className)} {...props}>
      {children}
    </div>
  );
}

export function CardFooter({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('border-t border-slate-100 bg-slate-50/50 px-6 py-3 rounded-b-xl', className)}
      {...props}
    >
      {children}
    </div>
  );
}
