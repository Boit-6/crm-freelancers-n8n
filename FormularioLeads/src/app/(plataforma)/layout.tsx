import type {ReactNode} from "react";

import Link from "next/link";

import {tipoDeCuenta} from "@/lib/auth";

// Encabezado de las páginas de la plataforma (portada, alta, panel, etc.). El
// formulario de cada desarrollador (/f/<slug>) queda afuera de este grupo: ahí
// el cliente ve la marca del espacio, no la de la plataforma.
export default async function PlataformaLayout({children}: {children: ReactNode}) {
  // null sin sesión. El cliente va a sus proyectos; el desarrollador, a su panel.
  const tipo = await tipoDeCuenta();

  return (
    <div className="flex flex-col">
      <header className="flex items-center justify-between gap-4 px-6 py-7 sm:px-10">
        <Link
          className="text-ink hover:text-ochre font-serif text-[19px] tracking-tight transition duration-200"
          href="/"
        >
          FormularioLeads
        </Link>
        <nav className="flex items-center gap-5 text-[11px] tracking-[0.16em] uppercase">
          <Link
            className="text-ink-soft hover:text-ochre transition duration-200 max-md:hidden"
            href="/desarrolladores"
          >
            Desarrolladores
          </Link>
          {tipo ? (
            <Link
              className="text-ink-soft hover:text-ochre transition duration-200"
              href={tipo === "cliente" ? "/cliente" : "/dashboard"}
            >
              {tipo === "cliente" ? "Mis proyectos" : "Panel"}
            </Link>
          ) : (
            <>
              <Link
                className="text-ink-soft hover:text-ochre transition duration-200 max-sm:hidden"
                href="/cliente/entrar"
              >
                Soy cliente
              </Link>
              <Link
                className="text-ink-soft hover:text-ochre transition duration-200"
                href="/login"
              >
                Entrar
              </Link>
              <Link
                className="border-ink text-ink hover:border-ochre hover:text-ochre border px-3 py-2 transition duration-200"
                href="/register"
              >
                Crear cuenta
              </Link>
            </>
          )}
        </nav>
      </header>
      <div className="flex-1" id="contenido">
        {children}
      </div>
    </div>
  );
}
