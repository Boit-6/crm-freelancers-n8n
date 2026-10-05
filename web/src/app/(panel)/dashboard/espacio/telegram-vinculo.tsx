"use client";

import {useState} from "react";

import {createClient} from "@/lib/supabase/client";

const BOT = process.env.NEXT_PUBLIC_TELEGRAM_BOT;

// Telegram es opcional: los avisos igual están en el panel y, los que piden
// una acción, llegan por correo. Para vincularlo, el panel pide un código de un
// solo uso y el desarrollador se lo manda al bot; n8n lo canjea por su chat.
export default function TelegramVinculo({vinculado}: {vinculado: boolean}) {
  const [conectado, setConectado] = useState(vinculado);
  const [codigo, setCodigo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function pedirCodigo() {
    const supabase = createClient();

    if (!supabase) return;
    setError(null);
    setCargando(true);
    try {
      const {data, error: dbError} = await supabase.rpc("generar_codigo_telegram");

      if (dbError || !data) setError("No se pudo generar el código. Probá de nuevo.");
      else setCodigo(data);
    } finally {
      setCargando(false);
    }
  }

  async function desvincular() {
    const supabase = createClient();

    if (!supabase) return;
    setCargando(true);
    try {
      const {error: dbError} = await supabase.rpc("desvincular_telegram");

      if (dbError) setError("No se pudo desvincular. Probá de nuevo.");
      else {
        setConectado(false);
        setCodigo(null);
      }
    } finally {
      setCargando(false);
    }
  }

  const botonClass =
    "ease text-ochre hover:text-ochre-deep text-[13px] underline-offset-4 hover:underline disabled:opacity-40";

  return (
    <section aria-label="Telegram" className="border-rule mt-12 border-t pt-8">
      <p className="text-faint mb-2 block text-[10px] tracking-[0.16em] uppercase">Telegram</p>
      {error && (
        <p className="text-brick mb-3 text-[13px]" role="alert">
          {error}
        </p>
      )}
      {conectado ? (
        <div className="flex flex-wrap items-baseline gap-4">
          <p className="text-ink-soft text-[14px]">
            Vinculado: los avisos también te llegan por Telegram.
          </p>
          <button className={botonClass} disabled={cargando} type="button" onClick={desvincular}>
            Desvincular
          </button>
        </div>
      ) : codigo ? (
        <div className="text-ink-soft text-[14px] leading-relaxed">
          {BOT ? (
            <p>
              Abrí{" "}
              <a
                className="text-ochre underline underline-offset-4"
                href={`https://t.me/${BOT}?start=${codigo}`}
                rel="noreferrer"
                target="_blank"
              >
                @{BOT}
              </a>{" "}
              y tocá “Iniciar”. Si no se abre, mandale este código:
            </p>
          ) : (
            <p>Mandale este código al bot de la plataforma:</p>
          )}
          <p className="text-ink mt-3 font-mono text-[22px] tracking-[0.2em]">{codigo}</p>
          <p className="text-faint mt-2 text-[12.5px]">
            Vale 30 minutos. Cuando lo vincules, recargá esta página.
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap items-baseline gap-4">
          <p className="text-muted text-[14px]">
            Opcional: recibí los avisos también por Telegram.
          </p>
          <button className={botonClass} disabled={cargando} type="button" onClick={pedirCodigo}>
            Vincular Telegram
          </button>
        </div>
      )}
    </section>
  );
}
