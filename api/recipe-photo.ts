// api/recipe-photo.ts — attach a dish photo to a recipe. Uploads to the public
// recipe-photos storage bucket via the service-role key and stores the URL on
// the recipe.
//
//   POST   /api/recipe-photo  { slug, image (base64), mediaType } → { photo_url }
//   DELETE /api/recipe-photo?slug=the-stew                        → { ok }

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { maxDuration: 30 };
const BUCKET = 'recipe-photos';

function client(res: VercelResponse): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    res.status(500).json({ error: 'Supabase not configured' });
    return null;
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

async function removeExisting(supabase: SupabaseClient, slug: string) {
  const { data } = await supabase.storage.from(BUCKET).list(slug);
  if (data && data.length) {
    await supabase.storage.from(BUCKET).remove(data.map((f) => `${slug}/${f.name}`));
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supabase = client(res);
  if (!supabase) return;

  if (req.method === 'POST') {
    const { slug, image, mediaType } = req.body ?? {};
    if (!slug || !image) return res.status(400).json({ error: 'Provide slug and image.' });

    const ext = String(mediaType || 'image/jpeg').includes('png') ? 'png' : 'jpg';
    const path = `${slug}/${Date.now()}.${ext}`;
    try {
      await removeExisting(supabase, slug); // one photo per recipe — clear old ones
      const bytes = Buffer.from(image, 'base64');
      const up = await supabase.storage.from(BUCKET).upload(path, bytes, {
        contentType: mediaType || 'image/jpeg',
        upsert: true,
      });
      if (up.error) return res.status(500).json({ error: up.error.message });

      const photo_url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      const { error } = await supabase.from('recipes').update({ photo_url }).eq('slug', slug);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ photo_url });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === 'DELETE') {
    const slug = typeof req.query.slug === 'string' ? req.query.slug : '';
    if (!slug) return res.status(400).json({ error: 'Provide ?slug=.' });
    await removeExisting(supabase, slug);
    const { error } = await supabase.from('recipes').update({ photo_url: null }).eq('slug', slug);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'POST, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}
