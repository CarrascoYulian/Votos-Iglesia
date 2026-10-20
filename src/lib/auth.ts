import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AppRole, Profile } from "@/lib/types";

/** Usuario autenticado y su perfil. Redirige a /login si no hay sesión. */
export async function requireProfile(next = "/") {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, can_correct, created_at")
    .eq("id", user.id)
    .single<Profile>();

  return { supabase, user, profile };
}

/** Exige uno de los roles indicados; los usuarios sin aprobar van a /pendiente. */
export async function requireRole(roles: AppRole[], next = "/") {
  const ctx = await requireProfile(next);
  if (!ctx.profile || ctx.profile.role === "pendiente") redirect("/pendiente");
  if (!roles.includes(ctx.profile.role)) redirect("/?error=permisos");
  return { ...ctx, profile: ctx.profile };
}
