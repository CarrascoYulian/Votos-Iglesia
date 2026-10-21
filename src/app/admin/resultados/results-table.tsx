"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Avatar, EmptyState, StatusBadge } from "@/components/ui";
import { cargoLabel, STATUS_LABEL } from "@/lib/format";
import type { ElectionStatus, ResultRow } from "@/lib/types";

type Row = ResultRow & { photo_url: string | null };

export default function ResultsTable({ rows }: { rows: Row[] }) {
  const [department, setDepartment] = useState("");
  const [status, setStatus] = useState<"" | ElectionStatus>("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"posicion" | "votos_desc" | "votos_asc">("posicion");

  const departments = useMemo(
    () => [...new Map(rows.map((r) => [r.department_id, r.department_name])).entries()].sort((a, b) => a[1].localeCompare(b[1])),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = rows.filter(
      (r) =>
        (!department || r.department_id === department) &&
        (!status || r.election_status === status) &&
        (!q || r.full_name.toLowerCase().includes(q)),
    );
    return list.sort((a, b) => {
      if (sort === "votos_desc") return b.votes - a.votes;
      if (sort === "votos_asc") return a.votes - b.votes;
      return a.department_name.localeCompare(b.department_name) || a.election_title.localeCompare(b.election_title) || a.posicion - b.posicion;
    });
  }, [rows, department, status, search, sort]);

  return (
    <div>
      <div className="card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label" htmlFor="f-dep">
            Departamento
          </label>
          <select id="f-dep" className="input" value={department} onChange={(e) => setDepartment(e.target.value)}>
            <option value="">Todos</option>
            {departments.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="f-st">
            Estado de la elección
          </label>
          <select id="f-st" className="input" value={status} onChange={(e) => setStatus(e.target.value as "" | ElectionStatus)}>
            <option value="">Todos</option>
            {(Object.keys(STATUS_LABEL) as ElectionStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="f-q">
            Candidato
          </label>
          <input id="f-q" className="input" placeholder="Buscar por nombre" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="f-sort">
            Ordenar
          </label>
          <select id="f-sort" className="input" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="posicion">Departamento y posición</option>
            <option value="votos_desc">Más votos primero</option>
            <option value="votos_asc">Menos votos primero</option>
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="Sin resultados">No hay candidatos que coincidan con los filtros.</EmptyState>
      ) : (
        <>
          {/* Escritorio: tabla */}
          <div className="card hidden overflow-hidden md:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-navy-50 text-xs uppercase tracking-wide text-navy-800">
                <tr>
                  <th className="px-4 py-3">Fotografía</th>
                  <th className="px-4 py-3">Candidato</th>
                  <th className="px-4 py-3">Departamento</th>
                  <th className="px-4 py-3 text-right">Votos</th>
                  <th className="px-4 py-3 text-center">Posición</th>
                  <th className="px-4 py-3">Cargo</th>
                  <th className="px-4 py-3">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map((r) => (
                  <tr key={`${r.election_id}-${r.candidate_id}`} className="hover:bg-paper">
                    <td className="px-4 py-2.5">
                      <Avatar name={r.full_name} url={r.photo_url} size={40} />
                    </td>
                    <td className="px-4 py-2.5 font-semibold text-ink">{r.full_name}</td>
                    <td className="px-4 py-2.5">
                      <Link href={`/admin/elecciones/${r.election_id}`} className="text-navy-700 hover:underline">
                        {r.department_name}
                      </Link>
                      <p className="text-xs text-muted">{r.election_title}</p>
                    </td>
                    <td className="px-4 py-2.5 text-right font-display text-base font-bold text-navy-900">{r.votes}</td>
                    <td className="px-4 py-2.5 text-center">
                      {r.posicion}º
                      {r.election_status !== "cerrada" && <span className="block text-[10px] uppercase text-amber-700">provisional</span>}
                    </td>
                    <td className={`px-4 py-2.5 ${r.tie_unresolved ? "font-semibold text-amber-700" : ""}`}>
                      {r.election_status === "preparacion" ? "Pendiente" : cargoLabel(r, r.election_status)}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={r.election_status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Móvil: tarjetas */}
          <ul className="space-y-3 md:hidden">
            {filtered.map((r) => (
              <li key={`${r.election_id}-${r.candidate_id}`} className="card p-4">
                <div className="flex items-center gap-3">
                  <Avatar name={r.full_name} url={r.photo_url} size={52} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-ink">{r.full_name}</p>
                    <Link href={`/admin/elecciones/${r.election_id}`} className="block truncate text-xs text-navy-700">
                      {r.department_name} · {r.election_title}
                    </Link>
                  </div>
                  <div className="text-right">
                    <p className="font-display text-2xl font-bold text-navy-900">{r.votes}</p>
                    <p className="text-[11px] text-muted">votos</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <span className="badge bg-navy-50 text-navy-800">{r.posicion}º lugar</span>
                  <span className={`badge ${r.tie_unresolved ? "bg-amber-100 text-amber-800" : "bg-gold-50 text-gold-700"}`}>
                    {r.election_status === "preparacion" ? "Cargo pendiente" : cargoLabel(r, r.election_status)}
                  </span>
                  <StatusBadge status={r.election_status} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
