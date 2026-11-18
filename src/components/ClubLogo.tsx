import { useState } from 'react';
import { clubLogoUrl } from '@/lib/clubLogos';

const SIZES = {
  xs: 'w-6 h-6 text-[10px] rounded-md',
  sm: 'w-8 h-8 text-xs rounded-lg',
  md: 'w-12 h-12 text-base rounded-xl',
  lg: 'w-24 h-24 text-3xl rounded-2xl',
} as const;

/**
 * A club's logo. Falls back to the club's initials on a green tile when the club has no logo
 * or the picture fails to load. Used next to the club name, so it is hidden from screen readers.
 */
export default function ClubLogo({
  name,
  path,
  size = 'sm',
}: {
  name: string;
  path?: string | null;
  size?: keyof typeof SIZES;
}) {
  const url = clubLogoUrl(path);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (url && failedUrl !== url) {
    return (
      <img
        src={url}
        alt=""
        aria-hidden
        loading="lazy"
        onError={() => setFailedUrl(url)}
        className={`${SIZES[size]} object-contain bg-white border border-pitch-100 shrink-0`}
      />
    );
  }
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
  return (
    <div
      aria-hidden
      className={`${SIZES[size]} bg-pitch-100 text-pitch-700 font-display font-bold flex items-center justify-center shrink-0`}
    >
      {initials || '?'}
    </div>
  );
}
