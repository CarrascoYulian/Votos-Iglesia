import { redirect } from "next/navigation";
import { Logo } from "@/components/ui";
import { requireProfile } from "@/lib/auth";

export const metadata = { title: "Cuenta pendiente · Votaciones Arca de Salvación" };

export default async function PendientePage() {
  const { profile, user } = await requireProfile("/pendiente");
  if (profile && profile.role !== "pendiente") redirect("/");

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="card w-full max-w-md p-8 text-center">
        <div className="flex justify-center">
          <Logo size={80} />
        </div>
        <h1 className="font-display mt-4 text-xl font-bold text-navy-900">Cuenta pendiente de aprobación</h1>
        <p className="mt-2 text-sm text-muted">
          Tu cuenta <strong className="text-ink">{user.email}</strong> está registrada, pero todavía no tiene permisos.
          Pide a un administrador que te asigne un rol desde el panel de usuarios.
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <a href="/pendiente" className="btn-outline">
            Volver a comprobar
          </a>
          <form action="/auth/salir" method="post">
            <button className="btn-ghost w-full">Cerrar sesión</button>
          </form>
        </div>
      </div>
    </main>
  );
}
