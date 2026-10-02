import Link from "next/link";

import MisProyectos from "./mis-proyectos";

import {getClienteUser} from "@/lib/auth";

// El gate usa la sesión en cada request.
export const dynamic = "force-dynamic";

// Panel del cliente: sus proyectos, las postulaciones y la elección.
export default async function ClientePage({
  searchParams,
}: {
  searchParams: Promise<{publicado?: string}>;
}) {
  const user = await getClienteUser();
  const {publicado} = await searchParams;

  return (
    <main className="mx-auto w-full max-w-4xl px-6 pt-10 pb-20 sm:px-10">
      <div className="border-rule mb-10 flex flex-wrap items-end justify-between gap-5 border-b pb-8">
        <div>
          <p className="text-ochre mb-4 text-[10px] tracking-[0.22em] uppercase">{user.email}</p>
          <h1 className="text-ink font-serif text-[clamp(2.4rem,6vw,3rem)] leading-none tracking-tight">
            Mis proyectos<span className="text-ochre">.</span>
          </h1>
        </div>
        <form action="/auth/signout?next=/cliente/entrar" method="post">
          <button
            className="ease text-muted hover:text-ochre text-[11px] tracking-[0.14em] uppercase transition duration-200"
            type="submit"
          >
            Salir
          </button>
        </form>
      </div>

      {publicado && (
        <p
          className="border-l-moss bg-moss/5 text-ink-soft mb-8 border-l-2 px-5 py-3.5 text-[13.5px]"
          role="status"
        >
          Publicamos tu proyecto. Cuando se postulen desarrolladores, los vas a ver acá.
        </p>
      )}

      <Link
        className="ease bg-ink text-paper hover:bg-ochre mb-10 inline-block px-6 py-4 text-[11px] font-medium tracking-[0.2em] uppercase transition duration-200"
        href="/publicar"
      >
        Publicar un proyecto
      </Link>

      <MisProyectos />
    </main>
  );
}
