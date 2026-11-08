import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, AlertCircle, CheckCircle2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export function PageHeader({
  icon: Icon,
  title,
  intro,
  backTo = '/dashboard',
  backLabel = 'Dashboard',
}: {
  icon: LucideIcon;
  title: string;
  intro?: string;
  backTo?: string;
  backLabel?: string;
}) {
  return (
    <div className="space-y-3">
      <Link
        to={backTo}
        className="inline-flex items-center gap-1 text-pitch-700 font-medium min-h-[44px]"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden /> {backLabel}
      </Link>
      <div className="flex items-center gap-2">
        <Icon className="w-6 h-6 text-pitch-600" aria-hidden />
        <h1 className="font-display font-bold text-2xl">{title}</h1>
      </div>
      {intro && <p className="text-pitch-700">{intro}</p>}
    </div>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="card p-3 border-ember-500 bg-ember-500/5 flex items-start gap-3"
    >
      <AlertCircle className="w-5 h-5 text-ember-600 mt-0.5 shrink-0" aria-hidden />
      <p className="text-sm text-ember-700">{message}</p>
    </div>
  );
}

export function SuccessNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="status" className="card p-3 border-pitch-300 bg-pitch-50 flex items-start gap-3">
      <CheckCircle2 className="w-5 h-5 text-pitch-600 mt-0.5 shrink-0" aria-hidden />
      <p className="text-sm text-pitch-800">{message}</p>
    </div>
  );
}

export function LoadingBlock() {
  return (
    <div className="space-y-3" aria-busy="true">
      <div className="skeleton h-24 w-full" />
      <div className="skeleton h-24 w-full" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-pitch-800">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="block text-xs text-pitch-600 mt-1">{hint}</span>}
    </label>
  );
}
