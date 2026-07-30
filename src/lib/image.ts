// Read a picked image file, downscale it, and return JPEG base64 — keeps the
// upload small (under serverless body limits) and fast for Claude vision.
// iOS HEIC photos decode fine in Safari; if a browser can't decode the format
// it throws, and callers surface a "try a JPEG/PNG" message.

export type ResizedImage = { base64: string; mediaType: 'image/jpeg' };

export async function fileToResizedBase64(
  file: File,
  maxDim = 1600,
  quality = 0.82,
): Promise<ResizedImage> {
  const dataUrl: string = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(new Error('Could not read that file.'));
    fr.readAsDataURL(file);
  });

  const img: HTMLImageElement = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Couldn't read that image — try a JPG or PNG."));
    i.src = dataUrl;
  });

  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process that image.');
  ctx.drawImage(img, 0, 0, w, h);

  const out = canvas.toDataURL('image/jpeg', quality);
  return { base64: out.split(',')[1] ?? '', mediaType: 'image/jpeg' };
}

// Pull an image File out of a paste event's clipboard, if there is one.
export function imageFromClipboard(e: ClipboardEvent): File | null {
  const items = e.clipboardData?.items;
  if (!items) return null;
  for (const it of items) {
    if (it.kind === 'file' && it.type.startsWith('image/')) {
      const f = it.getAsFile();
      if (f) return f;
    }
  }
  return null;
}
