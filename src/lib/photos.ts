import type { SupabaseClient } from "@supabase/supabase-js";

export const PHOTO_BUCKET = "candidate-photos";

/** URLs firmadas (bucket privado) para un conjunto de rutas. Validez: 12 horas. */
export async function signPhotos(supabase: SupabaseClient, paths: (string | null | undefined)[]) {
  const unique = [...new Set(paths.filter((p): p is string => !!p))];
  const map: Record<string, string> = {};
  if (unique.length === 0) return map;
  const { data } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(unique, 60 * 60 * 12);
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) map[item.path] = item.signedUrl;
  }
  return map;
}
