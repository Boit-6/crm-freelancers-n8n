import type {Metadata} from "next";

import Link from "next/link";
import {notFound} from "next/navigation";
import {cache} from "react";

import Estrellas, {Reputacion} from "@/app/components/estrellas";
import {SLUG_REGEX} from "@/lib/espacios";
import {createClient} from "@/lib/supabase/server";

// Perfil público de un desarrollador. `anon` no lee las tablas: todo sale de
// perfil_publico() y resenas_publicas(), que devuelven sólo lo publicable.
const buscarPerfil = cache(async (slug: string) => {
  const normalizado = slug.toLowerCase();

  if (!SLUG_REGEX.test(normalizado)) return null;

  const supabase = await createClient();

  if (!supabase) return null;

  const [{data: perfil}, {data: resenas}] = await Promise.all([
    supabase.rpc("perfil_publico", {p_slug: normalizado}),
    supabase.rpc("resenas_publicas", {p_slug: normalizado}),
  ]);

  return perfil?.[0] ? {perfil: perfil[0], resenas: resenas ?? []} : null;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{slug: string}>;
}): Promise<Metadata> {
  const datos = await buscarPerfil((await params).slug);

  return datos ? {title: `${datos.perfil.nombre} · Perfil`} : {};
}

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString("es-AR", {month: "long", year: "numeric"});

export default async function PerfilPage({params}: {params: Promise<{slug: string}>}) {
  const datos = await buscarPerfil((await params).slug);

  if (!datos) notFound();

  const {perfil, resenas} = datos;

  return (
    <main className="mx-auto w-full max-w-4xl px-6 pt-10 pb-20 sm:px-10">
      <div className="border-rule mb-10 flex flex-wrap items-end justify-between gap-6 border-b pb-8">
        <div>
          <p className="text-ochre mb-4 text-[10px] tracking-[0.22em] uppercase">
            Desarrollador · desde {fecha(perfil.miembro_desde)}
          </p>
          <h1 className="text-ink font-serif text-[clamp(2.4rem,6vw,3.2rem)] leading-none tracking-tight">
            {perfil.nombre}
          </h1>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
            <Reputacion cantidad={perfil.calificaciones} promedio={perfil.promedio} />
            <span className="text-muted text-[13px]">
              {perfil.proyectos_terminados}{" "}
              {perfil.proyectos_terminados === 1 ? "proyecto terminado" : "proyectos terminados"}
            </span>
          </div>
        </div>
        <Link
          className="ease bg-ink text-paper hover:bg-ochre px-6 py-4 text-[11px] font-medium tracking-[0.2em] uppercase transition duration-200"
          href={`/f/${perfil.slug}`}
        >
          Pedile un presupuesto
        </Link>
      </div>

      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="flex flex-col gap-10">
          {perfil.presentacion && (
            <section>
              <h2 className="text-faint mb-3 text-[10px] tracking-[0.16em] uppercase">Sobre mí</h2>
              <p className="text-ink-soft text-[15.5px] leading-relaxed whitespace-pre-line">
                {perfil.presentacion}
              </p>
            </section>
          )}

          <section>
            <h2 className="text-faint mb-4 text-[10px] tracking-[0.16em] uppercase">
              Reseñas ({resenas.length})
            </h2>
            {resenas.length === 0 ? (
              <p className="text-muted text-[14px]">Todavía no tiene reseñas.</p>
            ) : (
              <ul className="flex flex-col gap-4">
                {resenas.map((r, i) => (
                  <li key={i} className="border-rule-soft bg-card border px-5 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <Estrellas promedio={r.estrellas} tamano={14} />
                      <span className="text-mist text-[12px]">{fecha(r.creado_en)}</span>
                    </div>
                    {r.comentario && (
                      <p className="text-ink-soft mt-3 text-[14.5px] leading-relaxed whitespace-pre-line">
                        «{r.comentario}»
                      </p>
                    )}
                    <p className="text-muted mt-3 text-[12.5px]">
                      {r.autor_nombre} ·{" "}
                      {r.origen === "plataforma" ? "cliente de la plataforma" : "cliente propio"}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="flex flex-col gap-8">
          {perfil.habilidades.length > 0 && (
            <section>
              <h2 className="text-faint mb-3 text-[10px] tracking-[0.16em] uppercase">
                Habilidades
              </h2>
              <ul className="flex flex-wrap gap-1.5">
                {perfil.habilidades.map((h) => (
                  <li
                    key={h}
                    className="border-rule text-ink-soft border px-2.5 py-1 text-[12.5px]"
                  >
                    {h}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {perfil.portfolio_urls.length > 0 && (
            <section>
              <h2 className="text-faint mb-3 text-[10px] tracking-[0.16em] uppercase">Portfolio</h2>
              <ul className="flex flex-col gap-2">
                {perfil.portfolio_urls.map((u) => (
                  <li key={u}>
                    {/* Enlaces que escribió el desarrollador: sin rastreo ni acceso
                        a esta pestaña. La base sólo acepta http(s). */}
                    <a
                      className="text-ochre hover:text-ochre-deep text-[13.5px] break-all underline underline-offset-2"
                      href={u}
                      rel="nofollow noopener noreferrer"
                      target="_blank"
                    >
                      {u.replace(/^https?:\/\//, "")}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}
