import type {Metadata} from "next";

import CalificarForm from "./calificar-form";

import {createClient} from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Calificá el trabajo",
  robots: {index: false, follow: false},
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// El cliente llega desde el correo que sale al cerrarse el proyecto.
// calificacion_pendiente() devuelve a quién califica y si ya lo hizo, sólo
// para proyectos cerrados.
export default async function CalificarPage({params}: {params: Promise<{token: string}>}) {
  const {token} = await params;
  const supabase = UUID.test(token) ? await createClient() : null;
  const {data} = supabase
    ? await supabase.rpc("calificacion_pendiente", {p_token: token})
    : {data: null};
  const pendiente = data?.[0] ?? null;

  return (
    <main className="mx-auto w-full max-w-xl px-6 pt-10 pb-20 sm:px-10">
      <div className="border-rule mb-10 border-b pb-8">
        <p className="text-ochre mb-4 text-[10px] tracking-[0.22em] uppercase">
          Proyecto terminado
        </p>
        <h1 className="text-ink font-serif text-[clamp(2.4rem,6vw,3rem)] leading-[1.03] tracking-tight">
          {pendiente ? `¿Cómo trabajó ${pendiente.espacio_nombre}?` : "Calificá el trabajo."}
        </h1>
      </div>

      <CalificarForm pendiente={pendiente} token={token} />
    </main>
  );
}
