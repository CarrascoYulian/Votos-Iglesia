"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PHOTO_BUCKET } from "@/lib/photos";
import { errorMessage } from "@/lib/format";
import { newOperationId } from "@/lib/uuid";
import { setCandidatePhoto } from "../../actions";

/** Reduce la imagen a un cuadrado de 600 px en WebP antes de subirla. */
async function toSquareWebp(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const size = Math.min(600, side);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("No se pudo procesar la imagen"))), "image/webp", 0.86),
  );
}

export default function PhotoUpload({ candidateId, departmentId, hasPhoto }: { candidateId: string; departmentId: string; hasPhoto: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError("Selecciona una imagen (JPG, PNG o WebP).");
    if (file.size > 15 * 1024 * 1024) return setError("La imagen es demasiado grande (máximo 15 MB).");
    setBusy(true);
    setError(null);
    try {
      const blob = await toSquareWebp(file);
      const path = `candidates/${candidateId}/${newOperationId()}.webp`;
      const { error: upErr } = await createClient().storage.from(PHOTO_BUCKET).upload(path, blob, {
        contentType: "image/webp",
        upsert: false,
      });
      if (upErr) throw upErr;
      const result = await setCandidatePhoto(candidateId, departmentId, path);
      if (!result.ok) throw new Error(result.error);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onFile} />
      <button type="button" className="btn-outline px-3 py-1.5 text-xs" onClick={() => input.current?.click()} disabled={busy}>
        {busy ? "Subiendo…" : hasPhoto ? "Cambiar foto" : "Subir foto"}
      </button>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}
