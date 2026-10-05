import type {Metadata} from "next";

import Link from "next/link";

import AvisoPrivacidad from "@/app/components/AvisoPrivacidad";

export const metadata: Metadata = {
  title: "Política de Privacidad — FormularioLeads",
  description: "Aviso de privacidad y tratamiento de datos personales (Ley 25.326).",
};

export default function PrivacidadPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 pt-10 pb-20 sm:px-10">
      <div className="border-rule mb-10 border-b pb-8">
        <p className="text-ochre mb-4 text-[10px] tracking-[0.22em] uppercase">
          Protección de datos personales
        </p>
        <h1 className="text-ink font-serif text-[clamp(2.4rem,6vw,3rem)] leading-[1.03] tracking-tight">
          Política de Privacidad.
        </h1>
        <p className="text-muted mt-4 text-[14.5px] leading-relaxed">
          Aviso conforme al art. 6 de la Ley 25.326 de Protección de los Datos Personales
          (Argentina), aplicable a los datos que usted proporciona en nuestro formulario de
          contacto.
        </p>
      </div>

      <AvisoPrivacidad />

      <div className="border-rule-soft mt-12 border-t pt-6">
        <Link className="text-ochre text-[13px] hover:underline" href="/">
          ← Volver al formulario
        </Link>
      </div>
    </main>
  );
}
