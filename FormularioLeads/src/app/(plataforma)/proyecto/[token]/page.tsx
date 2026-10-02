import type {Metadata} from "next";

import ProyectoHitos from "./proyecto-hitos";

export const metadata: Metadata = {
  title: "Tu proyecto",
  robots: {index: false, follow: false},
};

// Página del proyecto que se cobra por hitos (etapa 11). El cliente llega con
// el enlace del correo que recibe al aceptar la propuesta, o desde «Mis
// proyectos»: ve cada hito, paga el que le toca y sigue lo que pasó con cada uno.
export default async function ProyectoPage({
  params,
  searchParams,
}: {
  params: Promise<{token: string}>;
  searchParams: Promise<{pago?: string}>;
}) {
  const {token} = await params;
  const {pago} = await searchParams;

  return (
    <main className="mx-auto w-full max-w-3xl px-6 pt-10 pb-20 sm:px-10">
      <div className="border-rule mb-10 border-b pb-8">
        <p className="text-ochre mb-4 text-[10px] tracking-[0.22em] uppercase">
          Pago protegido por hitos
        </p>
        <h1 className="text-ink font-serif text-[clamp(2.4rem,6vw,3rem)] leading-[1.03] tracking-tight">
          Tu proyecto.
        </h1>
      </div>

      <ProyectoHitos recienPagado={pago === "ok"} token={token} />
    </main>
  );
}
