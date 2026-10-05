import Link from "next/link";

import LeadForm from "./lead-form";

// La página del formulario de un desarrollador (/f/<slug>). El cliente ve la
// marca del espacio en el encabezado; la plataforma aparece sólo en la franja
// de arriba, que invita a otros desarrolladores a registrarse.
export default function PaginaFormulario({espacio}: {espacio: {slug: string; nombre: string}}) {
  return (
    <div className="flex flex-col">
      <aside className="border-rule-soft bg-card border-b px-6 py-2.5 text-center text-[12.5px] sm:px-10">
        <span className="text-muted">
          ¿Sos desarrollador? Recibí consultas como esta con tu propio formulario.{" "}
        </span>
        <Link
          className="text-ochre hover:text-ochre-deep underline underline-offset-2 transition duration-200"
          href="/register"
        >
          Registrate gratis
        </Link>
      </aside>

      <header className="px-6 py-7 sm:px-10">
        <span className="text-ink font-serif text-[19px] tracking-tight">{espacio.nombre}</span>
      </header>

      <main
        className="mx-auto grid w-full max-w-5xl gap-12 px-6 pt-6 pb-20 sm:px-10 lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-16"
        id="contenido"
      >
        <div className="lg:sticky lg:top-10 lg:self-start">
          <p className="text-ochre mb-5 text-[10px] tracking-[0.22em] uppercase">Nueva consulta</p>
          <h1 className="text-ink font-serif text-[clamp(2.6rem,6vw,3.2rem)] leading-[1.03] tracking-tight text-pretty">
            Hablemos de tu <em>próximo</em> proyecto.
          </h1>
          <div className="bg-rule-soft my-7 h-px" />
          <p className="text-muted text-[15px] leading-relaxed">
            Contale a {espacio.nombre} qué necesitás. Son cuatro pasos y lleva un par de minutos.
          </p>
          <div className="text-ochre mt-6 flex items-center gap-2">
            <svg
              aria-hidden="true"
              fill="none"
              height={15}
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.4}
              viewBox="0 0 24 24"
              width={15}
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7.5V12l3 1.8" />
            </svg>
            <span className="text-[13px]">Respuesta en menos de 24 horas</span>
          </div>
        </div>

        <LeadForm espacio={espacio.slug} />
      </main>
    </div>
  );
}
