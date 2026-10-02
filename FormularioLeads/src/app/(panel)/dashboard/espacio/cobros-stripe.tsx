"use client";

import {useEffect, useState} from "react";

const COMISION = process.env.NEXT_PUBLIC_COMISION_PORCENTAJE || "1";

type Estado = {conectada: boolean; activo: boolean};

// Cobros online con Stripe Connect. El desarrollador crea (o completa) su
// cuenta Express en Stripe; lo que le pagan sus clientes va a esa cuenta y la
// plataforma se queda con su comisión. La cuenta la crea n8n (vía /api/crm),
// nunca el navegador.
export default function CobrosStripe({inicial}: {inicial: Estado}) {
  const [estado, setEstado] = useState<Estado>(inicial);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [volvio, setVolvio] = useState<string | null>(null);

  // Stripe vuelve a /dashboard/espacio?stripe=volvio (o =reintentar si el
  // enlace venció): se consulta el estado real de la cuenta.
  useEffect(() => {
    const retorno = new URLSearchParams(window.location.search).get("stripe");

    if (!retorno) return;
    setVolvio(retorno);
    setCargando(true);
    fetch("/api/crm/stripe-estado", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: "{}",
    })
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok)
          setEstado({
            conectada: Boolean(d.conectada),
            activo: Boolean(d.activo),
          });
      })
      .catch(() => setError("No se pudo consultar el estado de tu cuenta de Stripe."))
      .finally(() => setCargando(false));
  }, []);

  async function conectar() {
    setError(null);
    setCargando(true);
    try {
      const r = await fetch("/api/crm/stripe-conectar", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: "{}",
      });
      const d = await r.json().catch(() => null);

      if (!r.ok || !d?.url) throw new Error();
      window.location.href = d.url;
    } catch {
      setError("No se pudo abrir Stripe. Probá de nuevo en un rato.");
      setCargando(false);
    }
  }

  const botonClass =
    "ease text-ochre hover:text-ochre-deep text-[13px] underline-offset-4 hover:underline disabled:opacity-40";

  return (
    <section aria-label="Cobros" className="border-rule mt-12 border-t pt-8">
      <p className="text-faint mb-2 block text-[10px] tracking-[0.16em] uppercase">Cobros online</p>
      {error && (
        <p className="text-brick mb-3 text-[13px]" role="alert">
          {error}
        </p>
      )}
      {estado.activo ? (
        <p className="text-ink-soft text-[14px] leading-relaxed">
          Activos: tus clientes pagan las facturas con tarjeta y la plata va a tu cuenta de Stripe.
          La plataforma se queda con el {COMISION}%.
        </p>
      ) : (
        <div className="text-muted text-[14px] leading-relaxed">
          <p>
            {estado.conectada
              ? "Tu cuenta de Stripe todavía no está habilitada para cobrar: falta completar el alta."
              : "Conectá una cuenta de Stripe para que tus clientes puedan pagar las facturas con tarjeta."}{" "}
            {volvio === "volvio" && !cargando && !estado.activo
              ? "Si recién la completaste, Stripe puede tardar unos minutos en habilitarla."
              : ""}
          </p>
          <button
            className={`${botonClass} mt-3`}
            disabled={cargando}
            type="button"
            onClick={conectar}
          >
            {cargando
              ? "Un momento..."
              : estado.conectada
                ? "Completar el alta en Stripe"
                : "Conectar Stripe"}
          </button>
        </div>
      )}
    </section>
  );
}
