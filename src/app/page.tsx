import Link from "next/link";
import { Logo } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABEL } from "@/lib/format";
import type { Profile } from "@/lib/types";

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from("profiles").select("id, email, full_name, role, can_correct").eq("id", user.id).single<Profile>()
    : { data: null };

  const role = profile?.role;
  const canCount = role === "admin" || role === "operador";
  const canAdmin = role === "admin" || role === "consulta" || role === "operador";

  return (
    <main className="flex min-h-dvh flex-col bg-gradient-to-b from-navy-900 via-navy-800 to-navy-700 text-white">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-4 py-12 text-center">
        <Logo size={150} />
        <p className="mt-6 text-sm font-semibold uppercase tracking-[0.2em] text-gold-100">
          Concilio Evangélico Pentecostal · CEPAS
        </p>
        <h1 className="font-display mt-2 text-3xl font-extrabold sm:text-5xl">Elecciones internas</h1>
        <p className="mt-3 max-w-xl text-base text-navy-100">
          Iglesia Arca de Salvación Paz en la Tormenta. Registro oficial del conteo público de votos, clasificación y
          resultados por departamento.
        </p>

        {error === "permisos" && (
          <p className="mt-6 rounded-xl bg-red-100 px-4 py-2 text-sm text-red-900">
            Tu rol no tiene acceso a esa sección.
          </p>
        )}

        <div className="mt-8 flex w-full max-w-md flex-col gap-3">
          {!user && (
            <Link href="/login" className="btn-gold py-3.5 text-base">
              Iniciar sesión
            </Link>
          )}
          {user && role === "pendiente" && (
            <Link href="/pendiente" className="btn-gold py-3.5 text-base">
              Ver estado de mi cuenta
            </Link>
          )}
          {canCount && (
            <Link href="/conteo" className="btn-gold py-3.5 text-base">
              Registrar votos (conteo)
            </Link>
          )}
          {canAdmin && (
            <Link href="/admin" className="btn border border-white/30 bg-white/10 py-3.5 text-base text-white hover:bg-white/20">
              {role === "admin" ? "Panel administrativo" : "Consultar resultados"}
            </Link>
          )}
        </div>

        {user && (
          <div className="mt-8 text-sm text-navy-100">
            <p>
              {profile?.full_name || user.email} · {role ? ROLE_LABEL[role] : "Sin perfil"}
            </p>
            <form action="/auth/salir" method="post" className="mt-2">
              <button className="text-gold-100 underline-offset-4 hover:underline">Cerrar sesión</button>
            </form>
          </div>
        )}
      </div>
      <footer className="pb-6 text-center text-xs text-navy-100/80">Heb. 12:14</footer>
    </main>
  );
}
