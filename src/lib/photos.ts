import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export const PHOTO_BUCKET = 'player-photos';

const MAX_EDGE = 640; // pixels, longest side. Plenty for a profile photo.
const JPEG_QUALITY = 0.8; // keeps a typical photo around 50-150 KB
const MAX_INPUT_BYTES = 25 * 1024 * 1024; // refuse absurdly large originals

/**
 * Shrinks a photo in the browser before it is uploaded. Phone cameras produce 3-10 MB
 * images; on slow mobile data that would be painful, so we send ~100 KB instead.
 * Always outputs JPEG (which is also all the storage bucket accepts).
 */
export async function compressImage(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose a photo (a JPG or PNG picture).');
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error('That photo is too large. Choose one under 25 MB.');
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () =>
        reject(new Error('That file could not be read as a photo. Try a JPG or PNG.'));
      el.src = objectUrl;
    });

    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot prepare photos. Try a different browser.');
    ctx.fillStyle = '#ffffff'; // transparent PNGs would otherwise turn black as JPEG
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
    );
    if (!blob) throw new Error('Could not prepare that photo. Try a different one.');
    return blob;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Uploads a new photo, points the player at it, then deletes the previous file.
 * Each upload gets a new file name, so a replaced photo never shows from a stale cache.
 * Returns the new storage path.
 */
export async function uploadPlayerPhoto(
  playerId: string,
  file: File,
  previousPath: string | null
): Promise<string> {
  const blob = await compressImage(file);
  const path = `${playerId}/${Date.now()}.jpg`;

  const up = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg', cacheControl: '3600' });
  if (up.error) throw up.error;

  const { error } = await supabase.from('player').update({ photo_path: path }).eq('id', playerId);
  if (error) {
    await supabase.storage.from(PHOTO_BUCKET).remove([path]); // don't leave an orphan behind
    throw error;
  }

  if (previousPath) await supabase.storage.from(PHOTO_BUCKET).remove([previousPath]);
  return path;
}

export async function removePlayerPhoto(playerId: string, path: string): Promise<void> {
  const { error } = await supabase.from('player').update({ photo_path: null }).eq('id', playerId);
  if (error) throw error;
  await supabase.storage.from(PHOTO_BUCKET).remove([path]);
}

/**
 * Turns players' stored photo paths into short-lived viewing links (valid 1 hour).
 * The bucket is private, so a photo is only viewable by signed-in people the database
 * lets see that player. Returns a map of player id -> link; players without a photo
 * (or whose link failed) are simply absent, and the avatar falls back to initials.
 */
export function usePlayerPhotoUrls(
  items: { id: string; photo_path: string | null }[]
): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  // A plain string key so the effect re-runs only when a photo is added, changed or removed.
  const key = items
    .filter((i) => i.photo_path)
    .map((i) => `${i.id}|${i.photo_path}`)
    .join(',');

  useEffect(() => {
    let cancelled = false;
    async function sign() {
      const pairs = key ? key.split(',').map((s) => s.split('|') as [string, string]) : [];
      if (pairs.length === 0) {
        setUrls({});
        return;
      }
      const { data, error } = await supabase.storage
        .from(PHOTO_BUCKET)
        .createSignedUrls(
          pairs.map(([, path]) => path),
          3600
        );
      if (cancelled || error || !data) return;
      const next: Record<string, string> = {};
      for (const row of data) {
        const match = pairs.find(([, path]) => path === row.path);
        if (match && row.signedUrl) next[match[0]] = row.signedUrl;
      }
      setUrls(next);
    }
    sign();
    return () => {
      cancelled = true;
    };
  }, [key]);

  return urls;
}
