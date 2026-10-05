import type {ServicioTipo} from "@/types/supabase";
import type {Metadata} from "next";

import Link from "next/link";

import {Reputacion} from "@/app/components/estrellas";
import {SERVICIO_LEGIBLE} from "@/lib/servicios";
import {createClient} from "@/lib/supabase/server";

export const metadata: Metadata = {title: "Desarrolladores"};

const SERVICIOS = Object.keys(SERVICIO_LEGIBLE) as ServicioTipo[];

const campoClass =
  "border-rule bg-card text-ink focus:border-ochre min-h-11 w-full border px-3 text-[14px] outline-none";

// Directorio público: los desarrolladores que declararon qué servicios
// ofrecen, ordenados por estrellas. Los filtros van por la URL (formulario
// GET): andan sin JavaScript y el enlace filtrado se puede compartir.
export default async function DesarrolladoresPage({
  searchParams,
}: {
  searchParams: Promise<{servicio?: string; habilidad?: string}>;
}) {
  const params = await searchParams;
  const servicio = SERVICIOS.includes(params.servicio as ServicioTipo)
    ? (params.servicio as ServicioTipo)
    : null;
  const habilidad = (params.habilidad ?? "").trim().slice(0, 40);
  const supabase = await createClient();
  const {data} = supabase
    ? await supabase.rpc("directorio_publico", {
        p_servicio: servicio,
        p_habilidad: habilidad || null,
      })
    : {data: null};
  const lista = data ?? [];

  return (
    <main className="mx-auto w-full max-w-5xl px-6 pt-10 pb-20 sm:px-10">
      <div className="border-rule mb-10 flex flex-wrap items-end justify-between gap-6 border-b pb-8">
        <div>
          <p className="text-ochre mb-4 text-[10px] tracking-[0.22em] uppercase">Directorio</p>
          <h1 className="text-ink font-serif text-[clamp(2.4rem,6vw,3.2rem)] leading-none tracking-tight">
            Desarrolladores<span className="text-ochre">.</span>
          </h1>
          <p className="text-muted mt-4 max-w-md text-[14.5px] leading-relaxed">
            Mirá sus perfiles y sus estrellas, y pedile un presupuesto a quien quieras. O publicá tu
            proyecto y que se postulen.
          </p>
        </div>
        <Link
          className="ease bg-ink text-paper hover:bg-ochre px-6 py-4 text-[11px] font-medium tracking-[0.2em] uppercase transition duration-200"
          href="/publicar"
        >
          Publicar mi proyecto
        </Link>
      </div>

      <form className="mb-10 grid gap-3 sm:grid-cols-[1fr_1fr_auto]" role="search">
        <select
          aria-label="Tipo de trabajo"
          className={`${campoClass} cursor-pointer`}
          defaultValue={servicio ?? ""}
          name="servicio"
        >
          <option value="">Todos los tipos de trabajo</option>
          {SERVICIOS.map((s) => (
            <option key={s} value={s}>
              {SERVICIO_LEGIBLE[s]}
            </option>
          ))}
        </select>
        <input
          aria-label="Habilidad"
          className={campoClass}
          defaultValue={habilidad}
          maxLength={40}
          name="habilidad"
          placeholder="Habilidad: React, Shopify, WordPress…"
          type="search"
        />
        <button
          className="ease border-ink text-ink hover:border-ochre hover:text-ochre min-h-11 border px-6 text-[11px] tracking-[0.16em] uppercase transition duration-200"
          type="submit"
        >
          Buscar
        </button>
      </form>

      {lista.length === 0 ? (
        <p className="text-muted text-[14.5px]">
          No encontramos desarrolladores con esos filtros.{" "}
          <Link className="text-ochre underline underline-offset-2" href="/desarrolladores">
            Ver todos
          </Link>
        </p>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {lista.map((d) => (
            <li
              key={d.slug}
              className="border-rule-soft bg-card flex flex-col gap-3 border px-6 py-5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 className="text-ink font-serif text-[23px] leading-tight">
                  <Link className="hover:text-ochre" href={`/d/${d.slug}`}>
                    {d.nombre}
                  </Link>
                </h2>
                <span className="text-muted text-[12.5px]">
                  {d.proyectos_terminados}{" "}
                  {d.proyectos_terminados === 1 ? "proyecto terminado" : "proyectos terminados"}
                </span>
              </div>
              <Reputacion cantidad={d.calificaciones} promedio={d.promedio} />
              {d.presentacion && (
                <p className="text-ink-soft line-clamp-3 text-[14px] leading-relaxed">
                  {d.presentacion}
                </p>
              )}
              <ul aria-label="Servicios" className="flex flex-wrap gap-1.5">
                {d.servicios.map((s) => (
                  <li key={s} className="bg-ochre/5 text-ochre-deep px-2 py-0.5 text-[12px]">
                    {SERVICIO_LEGIBLE[s]}
                  </li>
                ))}
                {d.habilidades.slice(0, 6).map((h) => (
                  <li key={h} className="border-rule text-ink-soft border px-2 py-0.5 text-[12px]">
                    {h}
                  </li>
                ))}
              </ul>
              <div className="mt-auto flex flex-wrap gap-4 pt-2 text-[12.5px]">
                <Link className="text-ochre underline underline-offset-2" href={`/d/${d.slug}`}>
                  Ver perfil
                </Link>
                <Link className="text-ink-soft underline underline-offset-2" href={`/f/${d.slug}`}>
                  Pedile un presupuesto
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
