import type { Metadata, Viewport } from "next";
import { Inter, Montserrat } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const montserrat = Montserrat({ variable: "--font-montserrat", subsets: ["latin"], weight: ["600", "700", "800"] });

export const metadata: Metadata = {
  title: "Votaciones Arca de Salvación",
  description:
    "Sistema oficial de registro, conteo y resultados de las elecciones internas — Iglesia Arca de Salvación Paz en la Tormenta (CEPAS).",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0b2e4f",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body className={`${inter.variable} ${montserrat.variable} min-h-dvh antialiased`}>{children}</body>
    </html>
  );
}
