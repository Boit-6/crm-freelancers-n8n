type Variante = "exito" | "pendiente" | "fallido";

const COPIA: Record<
  Variante,
  {
    eyebrow: string;
    titulo: string;
    cuerpo: string;
    icono: string;
    accent: string;
  }
> = {
  // Esta página es la `success_url` / `cancel_url` de Stripe: la abre el
  // navegador del cliente cuando Stripe lo devuelve, no el sistema al
  // registrar el cobro. La factura se marca COBRADO recién cuando llega el
  // evento firmado de Stripe al webhook de n8n, que puede tardar o no llegar. Por eso el texto no afirma que el pago quedó registrado: decirlo
  // acá sería afirmar algo que en ese momento todavía no se comprobó.
  exito: {
    eyebrow: "Pago aprobado",
    titulo: "¡Listo, gracias!",
    cuerpo:
      "Stripe nos informó que el pago se aprobó. En unos minutos queda registrado en la factura.",
    icono: "✅",
    accent: "text-ochre",
  },
  pendiente: {
    eyebrow: "Pago en revisión",
    titulo: "Lo estamos procesando.",
    cuerpo:
      "El medio de pago todavía está confirmando el cobro (algunos tardan un poco). Queda registrado en cuanto se acredite.",
    icono: "⏳",
    accent: "text-mist",
  },
  fallido: {
    eyebrow: "Pago no procesado",
    titulo: "Algo no salió bien.",
    cuerpo:
      "El pago no se pudo completar. Podés volver a intentarlo desde el link de la factura que te llegó por email.",
    icono: "⚠️",
    accent: "text-brick",
  },
};

export default function PagoResultado({
  variante,
  facturaId,
}: {
  variante: Variante;
  facturaId?: string;
}) {
  const {eyebrow, titulo, cuerpo, icono, accent} = COPIA[variante];

  return (
    <div className="border-rule-soft bg-card flex flex-col items-center gap-5 border px-8 py-16 text-center shadow-[0_1px_2px_rgba(25,23,19,0.04),0_12px_32px_-18px_rgba(25,23,19,0.18)] sm:px-11">
      <p className={`text-[10px] tracking-[0.22em] uppercase ${accent}`}>{eyebrow}</p>
      <div className="text-5xl">{icono}</div>
      <h1 className="text-ink font-serif text-[clamp(2.4rem,6vw,3.2rem)] leading-none tracking-tight">
        {titulo}
      </h1>
      <p className="text-muted mx-auto max-w-sm text-[14.5px] leading-relaxed">{cuerpo}</p>
      {facturaId ? (
        <p className="text-mist mt-2 text-[11px] tracking-[0.2em] uppercase">Factura {facturaId}</p>
      ) : null}
    </div>
  );
}
