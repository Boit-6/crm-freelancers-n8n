import Link from "next/link";

// Portada de la plataforma. Desde que es compartida entre desarrolladores, la
// raíz ya no es el formulario de nadie: cada uno tiene el suyo en /f/<slug>.
const PASOS = [
  {
    titulo: "Tu formulario",
    texto: "Una dirección propia, con tu marca, para compartir con tus clientes.",
  },
  {
    titulo: "Consultas priorizadas",
    texto: "Cada pedido llega calificado según presupuesto, urgencia y servicio.",
  },
  {
    titulo: "Propuesta y cobro",
    texto: "Mandás la propuesta, el cliente la acepta en línea y paga en USD con Stripe.",
  },
];

export default function PortadaPage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-6 pt-10 pb-20 sm:px-10">
      <section className="border-rule max-w-2xl border-b pb-12">
        <p className="text-ochre mb-5 text-[10px] tracking-[0.22em] uppercase">
          Para desarrolladores freelance
        </p>
        <h1 className="text-ink font-serif text-[clamp(2.6rem,7vw,4rem)] leading-[1.02] tracking-tight text-pretty">
          De la consulta al cobro, <em>sin planillas</em>.
        </h1>
        <p className="text-muted mt-7 max-w-lg text-[16px] leading-relaxed">
          Recibí pedidos con tu propio formulario, respondé con propuestas y cobrá tus facturas
          desde un solo panel.
        </p>
        <div className="mt-9 flex flex-wrap items-center gap-4">
          <Link
            className="bg-ink text-paper hover:bg-ochre px-7 py-4 text-[11px] font-medium tracking-[0.2em] uppercase transition duration-200"
            href="/register"
          >
            Crear cuenta gratis
          </Link>
          <Link
            className="text-ink-soft hover:text-ochre text-[13px] underline underline-offset-4 transition duration-200"
            href="/login"
          >
            Ya tengo cuenta
          </Link>
        </div>
      </section>

      <ol className="grid gap-10 pt-12 sm:grid-cols-3 sm:gap-8">
        {PASOS.map((paso, i) => (
          <li key={paso.titulo}>
            <span className="text-ochre font-serif text-[22px]">{["I", "II", "III"][i]}</span>
            <h2 className="text-ink mt-2 font-serif text-[22px] leading-tight">{paso.titulo}</h2>
            <p className="text-muted mt-2 text-[14px] leading-relaxed">{paso.texto}</p>
          </li>
        ))}
      </ol>

      <p className="text-faint mt-16 text-[12.5px]">
        La plataforma cobra una comisión del 1% sobre lo que cobrás con Stripe.
      </p>

      {/* Para clientes: publican su proyecto y eligen entre las postulaciones
          (etapa 6). */}
      <section className="border-rule-soft bg-card mt-16 flex flex-col gap-5 border px-7 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-10">
        <div>
          <p className="text-ochre mb-2 text-[10px] tracking-[0.22em] uppercase">Para clientes</p>
          <h2 className="text-ink font-serif text-[28px] leading-tight">
            ¿Necesitás un desarrollador?
          </h2>
          <p className="text-muted mt-2 max-w-md text-[14.5px] leading-relaxed">
            Publicá tu proyecto gratis, recibí propuestas con precio y plazo, y elegí. Tus datos
            sólo le llegan a quien elijas.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-3">
          <Link
            className="bg-ink text-paper hover:bg-ochre px-6 py-4 text-[11px] font-medium tracking-[0.2em] uppercase transition duration-200"
            href="/publicar"
          >
            Publicar mi proyecto
          </Link>
          <Link
            className="text-ink-soft hover:text-ochre text-[13px] underline underline-offset-4 transition duration-200"
            href="/desarrolladores"
          >
            Buscar un desarrollador
          </Link>
          <Link
            className="text-ink-soft hover:text-ochre text-[13px] underline underline-offset-4 transition duration-200"
            href="/cliente"
          >
            Ver mis proyectos
          </Link>
        </div>
      </section>
    </main>
  );
}
