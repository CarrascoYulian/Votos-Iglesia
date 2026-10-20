"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/format";

type Mode = "login" | "registro" | "recuperar";

function siteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
}

function safeNext(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(params.get("error"));
  const [info, setInfo] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    const supabase = createClient();
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) {
          setError(
            /invalid login/i.test(error.message)
              ? "Correo o contraseña incorrectos."
              : /not confirmed/i.test(error.message)
                ? "Confirma tu correo antes de iniciar sesión (revisa tu bandeja de entrada)."
                : errorMessage(error),
          );
          return;
        }
        router.replace(next);
        router.refresh();
      } else if (mode === "registro") {
        if (password.length < 8) {
          setError("La contraseña debe tener al menos 8 caracteres.");
          return;
        }
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { full_name: fullName.trim() },
            emailRedirectTo: `${siteUrl()}/auth/callback?next=/pendiente`,
          },
        });
        if (error) {
          setError(errorMessage(error));
          return;
        }
        setInfo(
          "Cuenta creada. Revisa tu correo para confirmarla. Después, un administrador debe asignarte un rol para acceder.",
        );
        setMode("login");
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${siteUrl()}/auth/callback?next=/actualizar-contrasena`,
        });
        if (error) {
          setError(errorMessage(error));
          return;
        }
        setInfo("Si el correo está registrado, recibirás un enlace para crear una nueva contraseña.");
        setMode("login");
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <h2 className="font-display text-xl font-bold text-navy-900">
        {mode === "login" ? "Iniciar sesión" : mode === "registro" ? "Solicitar acceso" : "Recuperar contraseña"}
      </h2>

      {error && (
        <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      {info && (
        <p role="status" className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {info}
        </p>
      )}

      {mode === "registro" && (
        <div>
          <label className="label" htmlFor="fullName">
            Nombre completo
          </label>
          <input
            id="fullName"
            className="input"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            autoComplete="name"
          />
        </div>
      )}

      <div>
        <label className="label" htmlFor="email">
          Correo electrónico
        </label>
        <input
          id="email"
          type="email"
          className="input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
      </div>

      {mode !== "recuperar" && (
        <div>
          <label className="label" htmlFor="password">
            Contraseña
          </label>
          <input
            id="password"
            type="password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={mode === "registro" ? 8 : undefined}
            autoComplete={mode === "registro" ? "new-password" : "current-password"}
          />
        </div>
      )}

      <button type="submit" className="btn-primary w-full py-3" disabled={busy}>
        {busy
          ? "Procesando…"
          : mode === "login"
            ? "Entrar"
            : mode === "registro"
              ? "Crear cuenta"
              : "Enviar enlace"}
      </button>

      <div className="flex flex-col items-center gap-1 pt-1 text-sm">
        {mode !== "login" && (
          <button type="button" className="text-navy-700 hover:underline" onClick={() => setMode("login")}>
            Ya tengo cuenta — iniciar sesión
          </button>
        )}
        {mode === "login" && (
          <>
            <button type="button" className="text-navy-700 hover:underline" onClick={() => setMode("recuperar")}>
              ¿Olvidaste tu contraseña?
            </button>
            <button type="button" className="text-navy-700 hover:underline" onClick={() => setMode("registro")}>
              Solicitar una cuenta de acceso
            </button>
          </>
        )}
      </div>
      {mode === "registro" && (
        <p className="text-xs text-muted">
          Las cuentas nuevas no tienen permisos hasta que un administrador las aprueba. Los asistentes no necesitan
          cuenta: votan en papel.
        </p>
      )}
    </form>
  );
}
