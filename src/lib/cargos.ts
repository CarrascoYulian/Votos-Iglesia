import type { Standing } from "@/lib/types";

/** Problemas de la asignación de cargos que impedirían cerrar la elección. */
export function cargoProblems(cargos: string[], standings: Standing[]): string[] {
  const problems: string[] = [];
  const first = cargos[0];
  if (standings.some((s) => s.tie_unresolved)) {
    problems.push(`Empate en el 1er lugar: falta decidir quién es ${first}.`);
  }
  for (const s of standings) {
    if (first && s.cargo === first && s.posicion !== 1) {
      problems.push(`${s.full_name} tiene ${first}, pero ese cargo es del 1er lugar. Cámbialo.`);
    }
  }
  for (const c of new Set(cargos)) {
    const allowed = cargos.filter((x) => x === c).length;
    const holders = standings.filter((s) => s.cargo === c);
    if (holders.length > allowed) {
      problems.push(`${c} está asignado a ${holders.length} personas (máximo ${allowed}): ${holders.map((h) => h.full_name).join(", ")}.`);
    }
  }
  return problems;
}

/** Cargos de la lista que nadie tiene todavía. */
export function vacantCargos(cargos: string[], standings: Standing[]): string[] {
  const left = [...cargos];
  for (const s of standings) {
    const i = s.cargo ? left.indexOf(s.cargo) : -1;
    if (i >= 0) left.splice(i, 1);
  }
  return left;
}
