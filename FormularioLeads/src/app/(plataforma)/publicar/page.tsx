import type {Metadata} from "next";

import PublicarForm from "./publicar-form";

import {tipoDeCuenta} from "@/lib/auth";

export const metadata: Metadata = {title: "Publicá tu proyecto"};

// La sesión (y el tipo de cuenta) se leen en cada request.
export const dynamic = "force-dynamic";

// Un cliente publica su proyecto para que se postulen desarrolladores de la
// plataforma. Si no tiene sesión, el formulario le pide el correo y guarda el
// borrador mientras abre el enlace mágico.
export default async function PublicarPage() {
  const tipo = await tipoDeCuenta();

  return (
    <main className="mx-auto grid w-full max-w-5xl gap-12 px-6 pt-10 pb-20 sm:px-10 lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-16">
      <div className="lg:sticky lg:top-10 lg:self-start">
        <p className="text-ochre mb-5 text-[10px] tracking-[0.22em] uppercase">Nuevo proyecto</p>
        <h1 className="text-ink font-serif text-[clamp(2.6rem,6vw,3.2rem)] leading-[1.03] tracking-tight text-pretty">
          Publicá tu <em>proyecto</em>.
        </h1>
        <div className="bg-rule-soft my-7 h-px" />
        <ol className="text-muted flex flex-col gap-3 text-[14.5px] leading-relaxed">
          <li>1. Contás qué necesitás. Tus datos de contacto no se publican.</li>
          <li>2. Los desarrolladores se postulan con precio y plazo.</li>
          <li>3. Elegís uno, y recién ahí le pasamos tus datos.</li>
        </ol>
      </div>

      <PublicarForm tipo={tipo} />
    </main>
  );
}
