"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function AdminNav({ isAdmin }: { isAdmin: boolean }) {
  const path = usePathname();
  const items = [
    { href: "/admin", label: "Resumen", exact: true },
    { href: "/admin/resultados", label: "Resultados" },
    { href: "/admin/departamentos", label: "Departamentos" },
    ...(isAdmin
      ? [
          { href: "/admin/usuarios", label: "Usuarios" },
          { href: "/admin/historial", label: "Historial" },
        ]
      : []),
  ];

  return (
    <nav className="border-b border-line bg-white" aria-label="Secciones del panel">
      <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4">
        {items.map((item) => {
          const active = item.exact ? path === item.href : path.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm font-semibold transition ${
                active ? "border-gold-500 text-navy-900" : "border-transparent text-muted hover:text-navy-800"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
