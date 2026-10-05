"use client";

import {useEffect} from "react";

import "./globals.css";

// Reemplaza el root layout entero cuando ESE layout es el que falla, así que
// necesita su propio <html>/<body> — no puede depender de layout.tsx.
export default function GlobalError({error, reset}: {error: Error; reset: () => void}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="es">
      <body className="bg-paper text-ink grid min-h-screen place-items-center px-6 font-sans antialiased">
        <div className="max-w-md text-center">
          <p className="text-ochre mb-5 text-[10px] tracking-[0.22em] uppercase">Error</p>
          <h1 className="text-ink font-serif text-[2.4rem] leading-none tracking-tight">
            Algo salió mal
          </h1>
          <p className="text-muted mt-5 text-[15px] leading-relaxed">
            Ocurrió un error inesperado. Podés intentar de nuevo.
          </p>
          <button
            className="ease border-rule hover:border-ochre hover:text-ochre mt-8 border px-3.5 py-2 text-[11px] tracking-[0.12em] uppercase transition duration-200"
            type="button"
            onClick={() => reset()}
          >
            Reintentar
          </button>
        </div>
      </body>
    </html>
  );
}
