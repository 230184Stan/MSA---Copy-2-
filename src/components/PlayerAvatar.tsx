import { useState } from 'react';

const SIZES = {
  sm: 'w-10 h-10 text-sm',
  md: 'w-14 h-14 text-lg',
  lg: 'w-32 h-32 text-4xl',
} as const;

/** A round player photo. Falls back to initials when there is no photo or it fails to load. */
export default function PlayerAvatar({
  name,
  url,
  size = 'md',
}: {
  name: string;
  url?: string | null;
  size?: keyof typeof SIZES;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (url && failedUrl !== url) {
    return (
      <img
        src={url}
        alt={`Photo of ${name}`}
        loading="lazy"
        onError={() => setFailedUrl(url)}
        className={`${SIZES[size]} rounded-full object-cover object-top bg-pitch-100 shrink-0`}
      />
    );
  }

  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');

  return (
    <div
      aria-hidden
      className={`${SIZES[size]} rounded-full bg-pitch-100 text-pitch-700 font-display font-bold flex items-center justify-center shrink-0`}
    >
      {initials || '?'}
    </div>
  );
}
