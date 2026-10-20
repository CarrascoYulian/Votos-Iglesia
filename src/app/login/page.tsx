import { Suspense } from "react";
import { Logo } from "@/components/ui";
import LoginForm from "./login-form";

export const metadata = { title: "Iniciar sesión · Votaciones Arca de Salvación" };

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-navy-900 to-navy-700 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center text-white">
          <Logo size={96} />
          <h1 className="font-display mt-4 text-2xl font-bold">Votaciones Arca de Salvación</h1>
          <p className="mt-1 text-sm text-navy-100">Acceso para personal autorizado</p>
        </div>
        <div className="card p-6 sm:p-8">
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
