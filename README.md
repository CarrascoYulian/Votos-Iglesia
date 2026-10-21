# Votaciones Arca de Salvación

Sistema oficial de **registro, conteo, clasificación y publicación de resultados** de las elecciones internas de la Iglesia
Arca de Salvación Paz en la Tormenta (Concilio Evangélico Pentecostal "Arca de Salvación", CEPAS).

Los asistentes **votan en papel**. Los responsables leen cada papel en público y un operador autorizado pulsa el botón
`+1 voto — Nombre` del candidato. Cada voto se guarda en Supabase antes de mostrarse como registrado.
No se pide ningún dato de los votantes.

## Tecnología

- **Next.js 15** (App Router, Server Components y Server Actions) + TypeScript + Tailwind CSS v4
- **Supabase**: Postgres con Row Level Security, Auth, Storage (fotografías) y Realtime
- **Vercel** para el despliegue

## Funcionalidades

| Área | Detalle |
|---|---|
| Conteo (`/conteo/[id]`) | Una tarjeta por candidato con foto, votos, posición y cargo provisional, y un botón `+1 voto`. Tiempo real entre varias pantallas. |
| Idempotencia | Cada pulsación lleva un `operation_id` único. Si falla la red, **Reintentar** reenvía el mismo id y el voto no se duplica. |
| Quitar voto | Botón `−1` en cada candidato (o "Quitar" en la lista de votos) con motivo: "Se marcó por error", "Voto nulo" u otro. El voto no se borra: queda marcado y auditado. |
| Reasignar | Pasar un voto al candidato correcto (operadores con permiso "puede reasignar" y administradores). |
| Retirar candidato | Durante el conteo se puede retirar a un candidato de la elección (y restaurarlo). Sus votos se conservan pero no cuentan mientras esté retirado. En preparación simplemente se quita de la papeleta. |
| Clasificación | Se calcula en la base de datos desde los votos guardados (posición por número de votos). |
| Cargos | El 1er lugar (sin empate) recibe automáticamente el primer cargo de la lista (p. ej. Presidente). Los demás cargos los asigna quien está contando, al terminar los votos. Si hay empate en el 1er lugar, el operador elige a quién darle el primer cargo. |
| Cierre | Solo se cierra con el primer cargo definido y sin cargos repetidos de más. Guarda una instantánea definitiva (`election_results`), quién cerró y cuándo, y bloquea nuevos votos. |
| Reapertura | Solo un administrador, con motivo. Conserva los resultados de cada cierre anterior. |
| `/admin` | Indicadores, tabla general de resultados con filtros y vista móvil, departamentos, candidatos con fotos, elecciones, usuarios e historial. |

## Roles

| Rol | Puede |
|---|---|
| **Administrador** | Todo: departamentos, candidatos, fotos, elecciones, inicio, cierre, reapertura, usuarios y correcciones. |
| **Operador de conteo** | En las elecciones que tenga asignadas: registrar y quitar votos, retirar/restaurar candidatos y asignar cargos. Con "puede reasignar" también pasa un voto a otro candidato. |
| **Consulta** | Ver resultados e historial. No registra ni modifica votos. |
| **Pendiente** | Nada (cuenta recién creada, sin aprobar). |

Los permisos se comprueban en tres capas: interfaz, servidor (Server Actions y middleware) y **base de datos** (RLS y
funciones `security definer` que validan el rol). Nadie puede insertar, editar ni borrar votos directamente: solo
mediante `register_vote`, `annul_vote`, `annul_last_vote` y `reassign_vote`.

## Base de datos

Migraciones en [`supabase/migrations`](supabase/migrations):

1. `esquema_base`: tablas `profiles`, `departments`, `candidates`, `elections`, `election_candidates`, `election_operators`,
   `votes`, `vote_adjustments`, `election_results` y `audit_logs`.
2. `seguridad_rls`: funciones de permisos, disparadores de integridad y auditoría, políticas RLS y bucket privado
   `candidate-photos`.
3. `funciones_conteo`: `election_standings`, `register_vote`, `annul_vote`, `reassign_vote`, `resolve_tie`,
   `start_election`, `close_election`, `reopen_election`, `all_results` y `set_user_role`.
4. `admin_inicial`: correo que recibe el rol de administrador al confirmar su cuenta. **Cámbialo antes de aplicarlo en
   otro proyecto.**
5. `revocar_funciones_internas`: impide llamar a las funciones de disparadores por la API.
6. `cargos_manuales_retiros`: cargos asignados por el operador (`assign_cargo`), quitar el último voto de un candidato
   (`annul_last_vote`), retirar/restaurar candidatos (`withdraw_candidate`, `restore_candidate`) y nuevas reglas de cierre.
   Elimina el desempate por orden (`resolve_tie`).

Garantías de integridad:

- La clave foránea compuesta `votes(election_id, candidate_id) → election_candidates` impide votar por un candidato de
  otra elección o departamento.
- `register_vote` toma un bloqueo compartido de la elección y `close_election` uno exclusivo, así que un voto no puede
  colarse durante el cierre.
- Los totales se calculan siempre a partir de los votos guardados (`count` de los votos no anulados). No hay contadores en el navegador.

Para aplicarlas en un proyecto nuevo:

```bash
npx supabase link --project-ref TU_PROYECTO
npx supabase db push
```

## Desarrollo local

```bash
cp .env.example .env.local   # completa URL y clave publicable
npm install
npm run dev
```

Variables de entorno (en `.env.local` y en Vercel; nunca en el repositorio):

| Variable | Uso |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Clave publicable (pública, protegida por RLS) |
| `NEXT_PUBLIC_SITE_URL` | URL pública del sitio, usada en los enlaces de los correos |
| `NEXT_PUBLIC_TIME_ZONE` | Opcional. Zona horaria de las fechas (por defecto `America/Santo_Domingo`) |

La aplicación **no usa la clave `service_role`**.

## Primer uso

1. En Supabase → Authentication → URL Configuration, pon la URL de Vercel como **Site URL** y agrega
   `https://TU-DOMINIO/auth/callback` en **Redirect URLs**.
2. Entra en `/login` → "Solicitar una cuenta de acceso" con el correo administrador y confirma el correo.
   Esa cuenta recibe el rol **Administrador** automáticamente.
3. En `/admin/departamentos`, crea los departamentos y candidatos y sube sus fotografías.
4. Crea la elección (título y cargos en orden), revisa los candidatos, asigna operadores e **inicia el conteo**.
5. Los operadores solicitan cuenta y el administrador les asigna el rol en `/admin/usuarios`.
6. Al terminar de leer los papeles, el operador **asigna los cargos** (el 1er lugar ya tiene el primero) y el administrador
   **cierra la elección**.
