import type {Metadata} from "next";

import {notFound} from "next/navigation";
import {cache} from "react";

import PaginaFormulario from "@/app/components/pagina-formulario";
import {SLUG_REGEX} from "@/lib/espacios";
import {createClient} from "@/lib/supabase/server";

// El formulario de un desarrollador. `anon` no lee la tabla de espacios: el
// nombre sale de espacio_publico(), que por la dirección devuelve sólo eso.
// `cache`: generateMetadata y la página lo piden en el mismo render.
const buscarEspacio = cache(async (slug: string) => {
  const normalizado = slug.toLowerCase();

  if (!SLUG_REGEX.test(normalizado)) return null;

  const supabase = await createClient();

  if (!supabase) return null;

  const {data} = await supabase.rpc("espacio_publico", {
    p_slug: normalizado,
  });

  return data?.[0] ?? null;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{slug: string}>;
}): Promise<Metadata> {
  const espacio = await buscarEspacio((await params).slug);

  if (!espacio) return {};

  return {
    title: `${espacio.nombre} · Contanos tu proyecto`,
    openGraph: {title: `${espacio.nombre} · Contanos tu proyecto`},
  };
}

export default async function FormularioDeEspacioPage({params}: {params: Promise<{slug: string}>}) {
  const espacio = await buscarEspacio((await params).slug);

  if (!espacio) notFound();

  return <PaginaFormulario espacio={espacio} />;
}
