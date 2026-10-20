import { AppHeader } from "@/components/app-header";
import { requireRole } from "@/lib/auth";
import AdminNav from "./admin-nav";

export const metadata = { title: "Panel administrativo · Votaciones Arca de Salvación" };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireRole(["admin", "consulta", "operador"], "/admin");

  return (
    <>
      <AppHeader profile={profile} subtitle="Panel administrativo" />
      <AdminNav isAdmin={profile.role === "admin"} />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:py-8">
        {profile.role !== "admin" && (
          <p className="mb-5 rounded-xl border border-navy-100 bg-navy-50 px-4 py-2 text-sm text-navy-800">
            Acceso de solo lectura. Las acciones administrativas están reservadas a los administradores.
          </p>
        )}
        {children}
      </main>
    </>
  );
}
