import type {Metadata} from "next";

import ElegirPostulacion from "./elegir-postulacion";

export const metadata: Metadata = {
  title: "Elegí quién hace tu proyecto",
  robots: {index: false, follow: false},
};

// Página a la que llega el cliente desde el correo de la bolsa de proyectos.
export default async function ElegirPage({params}: {params: Promise<{token: string}>}) {
  const {token} = await params;

  return (
    <main className="mx-auto w-full max-w-3xl px-6 pt-10 pb-20 sm:px-10">
      <div className="border-rule mb-10 border-b pb-8">
        <p className="text-ochre mb-4 text-[10px] tracking-[0.22em] uppercase">
          Bolsa de proyectos
        </p>
        <h1 className="text-ink font-serif text-[clamp(2.4rem,6vw,3rem)] leading-[1.03] tracking-tight">
          Elegí quién hace tu proyecto.
        </h1>
      </div>

      <ElegirPostulacion token={token} />
    </main>
  );
}
