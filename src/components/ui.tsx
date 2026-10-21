import Image from "next/image";
import Link from "next/link";
import type { ElectionStatus } from "@/lib/types";
import { STATUS_LABEL, initials } from "@/lib/format";

export function Logo({ size = 44 }: { size?: number }) {
  return (
    <Image
      src="/logo.webp"
      alt="Sello del Concilio Evangélico Pentecostal Arca de Salvación"
      width={size}
      height={size}
      className="rounded-full"
      priority
    />
  );
}

export function Brand({ subtitle = "Elecciones internas" }: { subtitle?: string }) {
  return (
    <Link href="/" className="flex min-w-0 items-center gap-3">
      <Logo size={40} />
      <span className="min-w-0 leading-tight">
        <span className="font-display block truncate text-sm font-bold text-navy-900 sm:text-base">
          Arca de Salvación
        </span>
        <span className="block truncate text-xs text-muted">{subtitle}</span>
      </span>
    </Link>
  );
}

const STATUS_STYLE: Record<ElectionStatus, string> = {
  preparacion: "bg-slate-100 text-slate-700",
  en_curso: "bg-amber-100 text-amber-800",
  cerrada: "bg-emerald-100 text-emerald-800",
};

export function StatusBadge({ status }: { status: ElectionStatus }) {
  return (
    <span className={`badge ${STATUS_STYLE[status]}`}>
      {status === "en_curso" && <span className="size-1.5 animate-pulse rounded-full bg-amber-600" />}
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Distingue resultados provisionales (conteo abierto) de definitivos (elección cerrada). */
export function ResultKindBadge({ status }: { status: ElectionStatus }) {
  if (status === "cerrada") {
    return <span className="badge bg-emerald-700 text-white">Resultados definitivos</span>;
  }
  if (status === "en_curso") {
    return <span className="badge border border-amber-400 bg-amber-50 text-amber-800">Resultados provisionales</span>;
  }
  return <span className="badge bg-slate-100 text-slate-600">Sin resultados aún</span>;
}

export function Avatar({ name, url, size = 56 }: { name: string; url?: string | null; size?: number }) {
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- URL firmada temporal de Supabase Storage
      <img
        src={url}
        alt={`Fotografía de ${name}`}
        width={size}
        height={size}
        className="shrink-0 rounded-full border border-line bg-navy-50 object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-label={`Sin fotografía: ${name}`}
      className="font-display inline-flex shrink-0 items-center justify-center rounded-full bg-navy-100 font-bold text-navy-800"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials(name)}
    </span>
  );
}

/** Número del candidato (casilla), bien visible. */
export function NumberBadge({ n, size = "md" }: { n: number; size?: "sm" | "md" | "lg" }) {
  const cls = {
    sm: "h-8 min-w-8 rounded-lg text-base",
    md: "h-11 min-w-11 rounded-xl text-2xl",
    lg: "h-16 min-w-16 rounded-2xl text-4xl",
  }[size];
  return (
    <span
      aria-label={`Número ${n}`}
      title={`Número ${n}`}
      className={`font-display inline-flex shrink-0 items-center justify-center bg-navy-900 px-1.5 font-extrabold leading-none text-white tabular-nums ${cls}`}
    >
      {n}
    </span>
  );
}

export function StatCard({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="card p-4 sm:p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="font-display mt-1 text-2xl font-bold text-navy-900 sm:text-3xl">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="mb-1 inline-block text-sm font-medium text-navy-700 hover:underline">
            ← {back.label}
          </Link>
        )}
        <h1 className="font-display text-2xl font-bold text-navy-900 sm:text-3xl">{title}</h1>
        {description && <div className="mt-1 text-sm text-muted">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-10 text-center">
      <p className="font-display text-lg font-semibold text-navy-900">{title}</p>
      {children && <div className="mt-2 max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}
