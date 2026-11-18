import { supabase } from '@/lib/supabaseClient';

export const LOGO_BUCKET = 'club-logos';

const MAX_EDGE = 256; // pixels, longest side. Logos are shown small.
const MAX_INPUT_BYTES = 15 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 240 * 1024; // the bucket refuses files over 256 KB

/** The public address of a stored logo (the logo bucket is public, so no sign-in is needed). */
export function clubLogoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return supabase.storage.from(LOGO_BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * Shrinks a logo in the browser and keeps any transparent background (PNG, or WebP if the
 * PNG would be too big). Returns the file bytes and the extension to save it under.
 */
export async function compressLogo(file: File): Promise<{ blob: Blob; ext: 'png' | 'webp' }> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose a picture (PNG, JPG or WebP).');
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error('That picture is too large. Choose one under 15 MB.');
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('That file could not be read as a picture. Try a PNG or JPG.'));
      el.src = objectUrl;
    });
    if (!img.naturalWidth || !img.naturalHeight) {
      throw new Error('That picture has no size. Try a different file (SVG logos are not supported).');
    }
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot prepare pictures. Try a different browser.');
    ctx.drawImage(img, 0, 0, width, height);

    const toBlob = (type: string, q?: number) =>
      new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, q));
    const png = await toBlob('image/png');
    if (png && png.size <= MAX_OUTPUT_BYTES) return { blob: png, ext: 'png' };
    const webp = await toBlob('image/webp', 0.85);
    if (webp && webp.type === 'image/webp' && webp.size <= MAX_OUTPUT_BYTES) {
      return { blob: webp, ext: 'webp' };
    }
    throw new Error('That logo is too detailed to store. Try a simpler or smaller picture.');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Uploads a new logo, points the club at it, then deletes the previous file. Returns the new path. */
export async function uploadClubLogo(
  clubId: string,
  file: File,
  previousPath: string | null
): Promise<string> {
  const { blob, ext } = await compressLogo(file);
  const path = `${clubId}/${Date.now()}.${ext}`;
  const up = await supabase.storage
    .from(LOGO_BUCKET)
    .upload(path, blob, { contentType: blob.type, cacheControl: '3600' });
  if (up.error) throw up.error;

  const { error } = await supabase.from('club').update({ logo_path: path }).eq('id', clubId);
  if (error) {
    await supabase.storage.from(LOGO_BUCKET).remove([path]); // don't leave an orphan behind
    throw error;
  }
  if (previousPath) await supabase.storage.from(LOGO_BUCKET).remove([previousPath]);
  return path;
}

export async function removeClubLogo(clubId: string, path: string): Promise<void> {
  const { error } = await supabase.from('club').update({ logo_path: null }).eq('id', clubId);
  if (error) throw error;
  await supabase.storage.from(LOGO_BUCKET).remove([path]);
}
