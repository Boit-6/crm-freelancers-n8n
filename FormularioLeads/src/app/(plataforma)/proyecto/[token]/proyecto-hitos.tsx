"use client";

import type {Hito, Proyecto} from "@/types/supabase";

import {useCallback, useEffect, useState} from "react";

import {Cargando, Esqueleto} from "@/app/components/esqueleto";
import {N8N_BASE, tarjetaClass} from "@/app/components/postulaciones";
import {COLOR_HITO, ESTADO_HITO, EVENTO_HITO, usd} from "@/lib/hitos";
import {SERVICIO_LEGIBLE} from "@/lib/servicios";
import {createClient} from "@/lib/supabase/client";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Después de volver de Stripe, el webhook puede tardar unos segundos en
// marcar el hito como pagado: se vuelve a consultar cada 3 s, hasta 10 veces.
const ESPERA_MS = 3000;
const REINTENTOS = 10;

type Vista = {tipo: "cargando"} | {tipo: "invalido"} | {tipo: "proyecto"; proyecto: Proyecto};

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString("es-AR", {day: "numeric", month: "short"});

function EsqueletoProyecto() {
  return (
    <Cargando className="flex flex-col gap-6" etiqueta="Cargando el proyecto…">
      <div className={`${tarjetaClass} flex flex-col gap-3 px-6 py-5`}>
        <Esqueleto className="h-2.5 w-24" />
        <Esqueleto className="h-6 w-56" />
        <Esqueleto className="h-4 w-full" />
      </div>
      {Array.from({length: 3}, (_, i) => (
        <div key={i} className={`${tarjetaClass} flex flex-col gap-3 px-6 py-5`}>
          <div className="flex justify-between gap-4">
            <Esqueleto className="h-5 w-48" />
            <Esqueleto className="h-5 w-20" />
          </div>
          <Esqueleto className="h-3 w-28" />
        </div>
      ))}
    </Cargando>
  );
}

function Resumen({proyecto}: {proyecto: Proyecto}) {
  const vigentes = proyecto.hitos.filter((h) => h.estado !== "ANULADO");
  const total = vigentes.reduce((a, h) => a + h.monto, 0);
  const retenido = vigentes
    .filter((h) => ["FONDEADO", "ENTREGADO", "EN_DISPUTA"].includes(h.estado))
    .reduce((a, h) => a + h.monto, 0);
  const liberado = vigentes.reduce((a, h) => a + h.monto_liberado, 0);

  return (
    <div className={`${tarjetaClass} flex flex-col gap-5 px-6 py-6 sm:px-8`}>
      <div>
        <p className="text-faint mb-1 text-[10px] tracking-[0.16em] uppercase">
          {SERVICIO_LEGIBLE[proyecto.servicio]} · con {proyecto.espacio_nombre}
        </p>
        <h2 className="text-ink font-serif text-[26px] leading-tight tracking-tight">
          Hola, {proyecto.cliente_nombre}.
        </h2>
        {proyecto.alcance && (
          <p className="text-muted mt-2 text-[14px] leading-relaxed whitespace-pre-line">
            {proyecto.alcance}
          </p>
        )}
      </div>
      <dl className="border-rule-soft grid grid-cols-3 gap-4 border-t pt-4 text-[13px]">
        <div>
          <dt className="text-faint text-[10px] tracking-[0.14em] uppercase">Total</dt>
          <dd className="text-ink font-serif text-[22px]">{usd(total)}</dd>
        </div>
        <div>
          <dt className="text-faint text-[10px] tracking-[0.14em] uppercase">Retenido</dt>
          <dd className="text-ochre font-serif text-[22px]">{usd(retenido)}</dd>
        </div>
        <div>
          <dt className="text-faint text-[10px] tracking-[0.14em] uppercase">Liberado</dt>
          <dd className="text-moss font-serif text-[22px]">{usd(liberado)}</dd>
        </div>
      </dl>
      <p className="text-faint text-[12.5px] leading-relaxed">
        Pagás cada hito antes de que empiece. La plata queda retenida por la plataforma y le llega a{" "}
        {proyecto.espacio_nombre} recién cuando apruebes la entrega.
      </p>
    </div>
  );
}

// Aprobar o disputar un hito pagado. Aprobar libera la plata y no se
// deshace: pide confirmación en el mismo lugar.
function RevisarHito({hito, token, onCambio}: {hito: Hito; token: string; onCambio: () => void}) {
  const [supabase] = useState(() => createClient());
  const [abierta, setAbierta] = useState<"aprobar" | "disputar" | null>(null);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ejecutar() {
    if (!supabase || !abierta) return;
    setEnviando(true);
    setError(null);
    const {error: err} =
      abierta === "aprobar"
        ? await supabase.rpc("aprobar_hito", {
            p_hito: hito.id,
            p_token: token,
          })
        : await supabase.rpc("disputar_hito", {
            p_hito: hito.id,
            p_motivo: motivo,
            p_token: token,
          });

    setEnviando(false);
    if (err) {
      setError(err.message);

      return;
    }
    setAbierta(null);
    onCambio();
  }

  const botonClass =
    "ease px-5 py-3 text-[11px] tracking-[0.16em] uppercase transition duration-200 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="border-rule-soft mt-1 flex flex-col gap-3 border-t pt-4">
      {hito.estado === "ENTREGADO" && hito.libera_en && (
        <p className="text-ink-soft text-[13.5px] leading-relaxed">
          Revisá la entrega. Si está bien, aprobala para liberar el pago; si no respondés, se libera
          solo el <b>{fecha(hito.libera_en)}</b>.
        </p>
      )}
      {abierta === null && (
        <div className="flex flex-wrap items-center gap-4">
          <button
            className={`${botonClass} bg-ink text-paper hover:bg-moss`}
            type="button"
            onClick={() => setAbierta("aprobar")}
          >
            Aprobar y liberar {usd(hito.monto)}
          </button>
          <button
            className="text-muted hover:text-brick text-[11px] tracking-[0.14em] uppercase"
            type="button"
            onClick={() => setAbierta("disputar")}
          >
            Algo no está bien
          </button>
        </div>
      )}
      {abierta === "aprobar" && (
        <div className="flex flex-col gap-3">
          <p className="text-ink-soft text-[13.5px]">
            ¿Liberar {usd(hito.monto)}? La plata le llega al desarrollador y ya no se puede
            disputar.
          </p>
          <div className="flex gap-4">
            <button
              className={`${botonClass} bg-moss text-paper`}
              disabled={enviando}
              type="button"
              onClick={ejecutar}
            >
              {enviando ? "Liberando…" : "Sí, liberar"}
            </button>
            <button
              className="text-muted text-[11px] tracking-[0.14em] uppercase"
              type="button"
              onClick={() => setAbierta(null)}
            >
              Volver
            </button>
          </div>
        </div>
      )}
      {abierta === "disputar" && (
        <div className="flex flex-col gap-3">
          <p className="text-ink-soft text-[13.5px] leading-relaxed">
            Contanos qué pasó. La plata queda retenida hasta que la plataforma revise el caso con
            las dos partes.
          </p>
          <textarea
            aria-label="Qué pasó con este hito"
            className="ease border-rule bg-card text-ink placeholder-mist focus:border-ochre w-full resize-y border px-3 py-2.5 text-[14px] transition duration-200 outline-none"
            maxLength={2000}
            placeholder="Ej: el carrito no calcula los envíos"
            rows={3}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
          <div className="flex gap-4">
            <button
              className={`${botonClass} bg-brick text-paper`}
              disabled={enviando || motivo.trim().length < 10}
              type="button"
              onClick={ejecutar}
            >
              {enviando ? "Enviando…" : "Abrir disputa"}
            </button>
            <button
              className="text-muted text-[11px] tracking-[0.14em] uppercase"
              type="button"
              onClick={() => setAbierta(null)}
            >
              Volver
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="text-brick text-[13px]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function TarjetaHito({hito, token, onCambio}: {hito: Hito; token: string; onCambio: () => void}) {
  const pagar = `${N8N_BASE}/webhook/hito-pagar?h=${encodeURIComponent(hito.id)}&t=${encodeURIComponent(token)}`;

  return (
    <li className={`${tarjetaClass} flex flex-col gap-3 px-6 py-5`}>
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="text-ink font-serif text-[20px] leading-tight">
          <span className="text-mist mr-2 text-[14px] tabular-nums">{hito.orden}.</span>
          {hito.titulo}
        </h3>
        <span className="text-ink font-serif text-[20px] whitespace-nowrap tabular-nums">
          {usd(hito.monto)}
        </span>
      </div>
      <p className={`text-[11px] tracking-[0.14em] uppercase ${COLOR_HITO[hito.estado]}`}>
        {ESTADO_HITO[hito.estado]}
      </p>
      {hito.descripcion && (
        <p className="text-muted text-[14px] leading-relaxed">{hito.descripcion}</p>
      )}
      {hito.entrega_nota && (
        <p className="border-rule-soft text-ink-soft border-l-2 pl-3 text-[14px] leading-relaxed">
          {hito.entrega_nota}
        </p>
      )}
      {hito.eventos.length > 0 && (
        <ol className="text-faint flex flex-col gap-1 text-[12.5px]">
          {hito.eventos.map((e) => (
            <li key={`${e.tipo}-${e.creado_en}`}>
              <span className="tabular-nums">{fecha(e.creado_en)}</span> · {EVENTO_HITO[e.tipo]}
            </li>
          ))}
        </ol>
      )}
      {hito.puede_pagar && N8N_BASE && (
        <a
          className="ease bg-ink text-paper hover:bg-ochre mt-1 self-start px-6 py-3.5 text-[11px] tracking-[0.16em] uppercase transition duration-200"
          href={pagar}
        >
          Pagar {usd(hito.monto)}
        </a>
      )}
      {(hito.estado === "FONDEADO" || hito.estado === "ENTREGADO") && (
        <RevisarHito hito={hito} token={token} onCambio={onCambio} />
      )}
      {hito.estado === "EN_DISPUTA" && (
        <p className="text-brick text-[13.5px] leading-relaxed">
          Abriste una disputa: la plataforma la está revisando. La plata sigue retenida.
        </p>
      )}
    </li>
  );
}

export default function ProyectoHitos({
  token,
  recienPagado,
}: {
  token: string;
  recienPagado: boolean;
}) {
  const tokenValido = UUID.test(token);
  const [supabase] = useState(() => createClient());
  const [vista, setVista] = useState<Vista>(
    tokenValido && supabase ? {tipo: "cargando"} : {tipo: "invalido"},
  );
  const [esperando, setEsperando] = useState(recienPagado);

  const cargar = useCallback(async (): Promise<Proyecto | null> => {
    if (!supabase || !tokenValido) return null;
    const {data, error} = await supabase.rpc("ver_proyecto", {
      p_lead: null,
      p_token: token,
    });

    if (error || !data) {
      setVista({tipo: "invalido"});

      return null;
    }
    setVista({tipo: "proyecto", proyecto: data});

    return data;
  }, [supabase, token, tokenValido]);

  useEffect(() => {
    let vigente = true;
    let intentos = 0;
    // Hitos pagados al abrir: al volver de Stripe, se espera a que aparezca uno más.
    let pagadosAlAbrir: number | null = null;

    async function consultar() {
      const proyecto = await cargar();

      if (!vigente || !proyecto) return;
      const pagados = proyecto.hitos.filter((h) => h.fondeado_en).length;

      pagadosAlAbrir ??= pagados;
      const reciente = proyecto.hitos.some(
        (h) => h.fondeado_en && Date.now() - new Date(h.fondeado_en).getTime() < 5 * 60_000,
      );

      if (!recienPagado || reciente || pagados > pagadosAlAbrir || ++intentos >= REINTENTOS) {
        setEsperando(false);

        return;
      }
      setTimeout(() => vigente && consultar(), ESPERA_MS);
    }

    consultar();

    return () => {
      vigente = false;
    };
  }, [cargar, recienPagado]);

  if (vista.tipo === "cargando") return <EsqueletoProyecto />;

  if (vista.tipo === "invalido") {
    return (
      <div className={`${tarjetaClass} flex flex-col gap-4 px-8 py-12 sm:px-11`}>
        <h2 className="text-ink font-serif text-[30px] leading-tight tracking-tight">
          Enlace no válido
        </h2>
        <p className="text-muted max-w-md text-[14.5px] leading-relaxed">
          Usá el enlace del correo que te mandamos al aceptar la propuesta.
        </p>
      </div>
    );
  }

  const {proyecto} = vista;

  return (
    <div className="flex flex-col gap-6">
      {recienPagado && (
        <p
          className="border-ochre bg-card text-ink-soft border-l-2 px-5 py-4 text-[14px]"
          role="status"
        >
          {esperando
            ? "Recibimos tu pago. Estamos confirmándolo con el procesador…"
            : "¡Listo! El pago quedó registrado y la plata, retenida hasta que apruebes la entrega."}
        </p>
      )}
      <Resumen proyecto={proyecto} />
      <ol className="flex flex-col gap-4">
        {proyecto.hitos.map((h) => (
          <TarjetaHito key={h.id} hito={h} token={token} onCambio={cargar} />
        ))}
      </ol>
    </div>
  );
}
