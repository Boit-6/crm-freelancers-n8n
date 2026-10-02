import type {Metadata} from "next";
import type {ReactNode} from "react";

import {Instrument_Sans, Instrument_Serif} from "next/font/google";

import {modoDemo} from "@/lib/demo";

import "./globals.css";

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-instrument-sans",
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-instrument-serif",
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "FormularioLeads",
  description: "Captá nuevos clientes.",
  openGraph: {
    title: "FormularioLeads",
    description: "Captá nuevos clientes.",
    url: SITE_URL,
    siteName: "FormularioLeads",
    locale: "es_AR",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "FormularioLeads",
    description: "Captá nuevos clientes.",
  },
};

export default async function RootLayout({children}: {children: ReactNode}) {
  return (
    <html className={`${instrumentSans.variable} ${instrumentSerif.variable}`} lang="es">
      <body className="bg-paper text-ink grid min-h-screen grid-cols-[minmax(0,1fr)] grid-rows-[1fr_auto] font-sans antialiased">
        <a
          className="focus:bg-ink focus:text-paper sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2 focus:text-[12px] focus:tracking-[0.1em] focus:uppercase"
          href="#contenido"
        >
          Saltar al contenido
        </a>
        {modoDemo() ? (
          // El body es una grilla de dos filas (contenido y pie): el aviso va
          // junto al contenido para no ocupar la fila que se estira.
          <div className="grid grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr]">
            <p className="border-rule bg-ochre/10 text-ink border-b px-4 py-2 text-center text-[12px]">
              Demo de portfolio: no ingreses datos reales. Los correos no llegan a sus destinatarios
              y los datos pueden borrarse sin aviso.
            </p>
            {children}
          </div>
        ) : (
          children
        )}
        <footer className="px-6 py-10 text-center sm:px-10">
          <p className="text-mist text-[10px] tracking-[0.2em] uppercase">© 2026</p>
        </footer>
      </body>
    </html>
  );
}
