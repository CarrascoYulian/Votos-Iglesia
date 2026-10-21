"use server";

import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/format";
import type { ActionResult, AppRole } from "@/lib/types";

// Todas las acciones usan la sesión del usuario: RLS y las funciones de la base de datos
// vuelven a validar los permisos, aunque alguien llame a la acción directamente.

async function run(fn: (s: Awaited<ReturnType<typeof createClient>>) => PromiseLike<{ error: unknown }>, paths: string[], message?: string): Promise<ActionResult> {
  try {
    const supabase = await createClient();
    const { error } = await fn(supabase);
    if (error) return { ok: false, error: friendly(errorMessage(error)) };
    paths.forEach((p) => revalidatePath(p));
    return { ok: true, message };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

function friendly(msg: string) {
  if (/row-level security|permission denied/i.test(msg)) return "No tienes permiso para realizar esta acción.";
  if (/departments_name_key/.test(msg)) return "Ya existe un departamento con ese nombre.";
  if (/elections_one_active_per_department/.test(msg)) return "Este departamento ya tiene una elección pendiente o en curso.";
  return msg;
}

function text(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function cargosFrom(form: FormData) {
  return text(form, "cargos")
    .split(/\r?\n|,/)
    .map((c) => c.trim())
    .filter(Boolean);
}

// ----------------------------------------------------------------------------- Departamentos
export async function createDepartment(_: unknown, form: FormData) {
  const name = text(form, "name");
  if (name.length < 2) return { ok: false, error: "Escribe el nombre del departamento." } as ActionResult;
  return run((s) => s.from("departments").insert({ name, description: text(form, "description") || null }), ["/admin", "/admin/departamentos"], "Departamento creado.");
}

export async function updateDepartment(id: string, _: unknown, form: FormData) {
  return run(
    (s) =>
      s
        .from("departments")
        .update({ name: text(form, "name"), description: text(form, "description") || null, active: form.get("active") === "on" })
        .eq("id", id),
    ["/admin", "/admin/departamentos", `/admin/departamentos/${id}`],
    "Departamento actualizado.",
  );
}

// ----------------------------------------------------------------------------- Candidatos
export async function createCandidate(departmentId: string, _: unknown, form: FormData) {
  const fullName = text(form, "full_name");
  if (fullName.length < 2) return { ok: false, error: "Escribe el nombre del candidato." } as ActionResult;
  return run(
    (s) => s.from("candidates").insert({ department_id: departmentId, full_name: fullName, notes: text(form, "notes") || null }),
    [`/admin/departamentos/${departmentId}`],
    "Candidato agregado.",
  );
}

export async function updateCandidate(id: string, departmentId: string, _: unknown, form: FormData) {
  return run(
    (s) =>
      s
        .from("candidates")
        .update({ full_name: text(form, "full_name"), notes: text(form, "notes") || null, active: form.get("active") === "on" })
        .eq("id", id),
    [`/admin/departamentos/${departmentId}`],
    "Candidato actualizado.",
  );
}

export async function setCandidatePhoto(id: string, departmentId: string, path: string) {
  if (!path.startsWith(`candidates/${id}/`)) return { ok: false, error: "Ruta de fotografía no válida." } as ActionResult;
  return run((s) => s.from("candidates").update({ photo_path: path }).eq("id", id), [`/admin/departamentos/${departmentId}`, "/admin/resultados"], "Fotografía actualizada.");
}

// ----------------------------------------------------------------------------- Elecciones
export async function createElection(departmentId: string, _: unknown, form: FormData): Promise<ActionResult & { id?: string }> {
  const title = text(form, "title");
  const cargos = cargosFrom(form);
  if (title.length < 3) return { ok: false, error: "Escribe un título para la elección." };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("elections")
      .insert({ department_id: departmentId, title, cargos, notes: text(form, "notes") || null })
      .select("id")
      .single();
    if (error) return { ok: false, error: friendly(errorMessage(error)) };

    // Por defecto participan todos los candidatos activos del departamento.
    const { data: candidates } = await supabase
      .from("candidates")
      .select("id")
      .eq("department_id", departmentId)
      .eq("active", true)
      .order("numero");
    if (candidates?.length) {
      await supabase
        .from("election_candidates")
        .insert(candidates.map((c, i) => ({ election_id: data.id, candidate_id: c.id, ballot_order: i + 1 })));
    }
    revalidatePath(`/admin/departamentos/${departmentId}`);
    revalidatePath("/admin");
    return { ok: true, id: data.id, message: "Elección creada." };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function updateElection(id: string, _: unknown, form: FormData) {
  return run(
    (s) => s.from("elections").update({ title: text(form, "title"), cargos: cargosFrom(form), notes: text(form, "notes") || null }).eq("id", id),
    [`/admin/elecciones/${id}`],
    "Configuración guardada.",
  );
}

export async function setElectionCandidates(id: string, candidateIds: string[]) {
  try {
    const supabase = await createClient();
    const { data: current, error } = await supabase.from("election_candidates").select("candidate_id").eq("election_id", id);
    if (error) return { ok: false, error: friendly(errorMessage(error)) } as ActionResult;
    const have = new Set((current ?? []).map((c) => c.candidate_id as string));
    const want = new Set(candidateIds);
    const remove = [...have].filter((c) => !want.has(c));
    const add = candidateIds.filter((c) => !have.has(c));
    if (remove.length) {
      const r = await supabase.from("election_candidates").delete().eq("election_id", id).in("candidate_id", remove);
      if (r.error) return { ok: false, error: friendly(errorMessage(r.error)) } as ActionResult;
    }
    if (add.length) {
      const r = await supabase
        .from("election_candidates")
        .insert(add.map((c) => ({ election_id: id, candidate_id: c, ballot_order: candidateIds.indexOf(c) + 1 })));
      if (r.error) return { ok: false, error: friendly(errorMessage(r.error)) } as ActionResult;
    }
    revalidatePath(`/admin/elecciones/${id}`);
    return { ok: true, message: "Candidatos de la elección actualizados." } as ActionResult;
  } catch (err) {
    return { ok: false, error: errorMessage(err) } as ActionResult;
  }
}

export async function assignOperator(electionId: string, userId: string, assign: boolean) {
  return run(
    (s) =>
      assign
        ? s.from("election_operators").insert({ election_id: electionId, user_id: userId })
        : s.from("election_operators").delete().eq("election_id", electionId).eq("user_id", userId),
    [`/admin/elecciones/${electionId}`],
    assign ? "Operador asignado." : "Operador retirado.",
  );
}

export async function startElection(id: string) {
  return run((s) => s.rpc("start_election", { p_election_id: id }), [`/admin/elecciones/${id}`, "/admin", "/conteo"], "Conteo iniciado.");
}

export async function closeElection(id: string, notes: string) {
  return run((s) => s.rpc("close_election", { p_election_id: id, p_notes: notes }), [`/admin/elecciones/${id}`, "/admin", "/admin/resultados"], "Elección cerrada. Resultados definitivos guardados.");
}

export async function reopenElection(id: string, reason: string) {
  return run((s) => s.rpc("reopen_election", { p_election_id: id, p_reason: reason }), [`/admin/elecciones/${id}`, "/admin", "/admin/resultados"], "Elección reabierta.");
}

/**
 * Elimina una elección completa. Verifica la contraseña del administrador con Supabase Auth
 * (sesión temporal, no reemplaza la actual) y llama a delete_election con ese token recién
 * emitido: la base de datos exige un inicio de sesión con contraseña de hace menos de 5 minutos.
 */
export async function deleteElection(id: string, password: string, confirmText: string): Promise<ActionResult & { departmentId?: string }> {
  if (confirmText.trim().toUpperCase() !== "BORRAR") return { ok: false, error: "Escribe BORRAR para confirmar." };
  if (!password) return { ok: false, error: "Escribe tu contraseña." };
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.email) return { ok: false, error: "Tu sesión expiró. Vuelve a iniciar sesión." };

    const verifier = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data: auth, error: authError } = await verifier.auth.signInWithPassword({ email: user.email, password });
    if (authError || !auth.session || auth.user.id !== user.id) {
      return { ok: false, error: /rate|too many/i.test(authError?.message ?? "") ? "Demasiados intentos. Espera unos minutos." : "Contraseña incorrecta." };
    }
    try {
      const { data, error } = await verifier.rpc("delete_election", { p_election_id: id, p_confirm: confirmText });
      if (error) return { ok: false, error: friendly(errorMessage(error)) };
      const departmentId = data as string;
      revalidatePath("/admin");
      revalidatePath(`/admin/departamentos/${departmentId}`);
      revalidatePath("/admin/resultados");
      return { ok: true, message: "Elección eliminada.", departmentId };
    } finally {
      await verifier.auth.signOut({ scope: "local" });
    }
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

// ----------------------------------------------------------------------------- Usuarios
export async function setUserRole(userId: string, role: AppRole, canCorrect: boolean) {
  return run((s) => s.rpc("set_user_role", { p_user_id: userId, p_role: role, p_can_correct: canCorrect }), ["/admin/usuarios"], "Permisos actualizados.");
}
