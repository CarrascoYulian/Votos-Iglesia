import Link from "next/link";
import { Brand } from "@/components/ui";
import { ROLE_LABEL } from "@/lib/format";
import type { Profile } from "@/lib/types";

export function AppHeader({ profile, subtitle }: { profile: Profile; subtitle?: string }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4">
        <Brand subtitle={subtitle} />
        <div className="flex items-center gap-2">
          <div className="hidden text-right text-xs leading-tight sm:block">
            <p className="font-semibold text-ink">{profile.full_name || profile.email}</p>
            <p className="text-muted">{ROLE_LABEL[profile.role]}</p>
          </div>
          {(profile.role === "admin" || profile.role === "operador") && (
            <Link href="/conteo" className="btn-ghost hidden px-3 sm:inline-flex">
              Conteo
            </Link>
          )}
          <Link href="/admin" className="btn-ghost hidden px-3 sm:inline-flex">
            Panel
          </Link>
          <form action="/auth/salir" method="post">
            <button className="btn-outline px-3 py-2">Salir</button>
          </form>
        </div>
      </div>
    </header>
  );
}
