"use client";

import {useCallback, useRef, useState} from "react";

interface OpcionesConfirm {
  titulo?: string;
  descripcion: string;
  textoConfirmar?: string;
  textoCancelar?: string;
  peligroso?: boolean;
}

// Reemplaza window.confirm(): bloqueaba el hilo principal, es inaccesible en
// lectores de pantalla y tiene mala UX en mobile. <dialog> nativo, sin
// dependencias. Uso: const [confirmar, ConfirmDialog] = useConfirm(); ...
// if (!(await confirmar({descripcion: "..."}))) return; ...  <ConfirmDialog />
// en algún punto fijo del árbol (una sola vez).
export function useConfirm(): [
  (opciones: OpcionesConfirm) => Promise<boolean>,
  () => React.JSX.Element | null,
] {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelarRef = useRef<HTMLButtonElement>(null);
  const resolverRef = useRef<((valor: boolean) => void) | null>(null);
  const [opciones, setOpciones] = useState<OpcionesConfirm | null>(null);

  const confirmar = useCallback((opts: OpcionesConfirm) => {
    setOpciones(opts);

    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      // El <dialog> recién existe en el DOM después de este render (opciones
      // pasa de null a un valor), por eso showModal() espera al próximo frame.
      // El foco inicial va a "Cancelar" (la acción menos destructiva), a
      // propósito: showModal() ya mueve el foco al <dialog>, esto solo lo
      // afina sin depender del prop autoFocus (jsx-a11y/no-autofocus).
      requestAnimationFrame(() => {
        dialogRef.current?.showModal();
        cancelarRef.current?.focus();
      });
    });
  }, []);

  const cerrar = useCallback((resultado: boolean) => {
    dialogRef.current?.close();
    resolverRef.current?.(resultado);
    resolverRef.current = null;
  }, []);

  function ConfirmDialog() {
    if (!opciones) return null;

    const {
      titulo,
      descripcion,
      textoConfirmar = "Confirmar",
      textoCancelar = "Cancelar",
      peligroso = false,
    } = opciones;

    return (
      <dialog
        ref={dialogRef}
        className="border-rule bg-card text-ink backdrop:bg-ink/40 w-full max-w-md border p-0 shadow-[0_8px_24px_rgba(25,23,19,0.12)]"
        onCancel={(e) => {
          e.preventDefault();
          cerrar(false);
        }}
        onClose={() => setOpciones(null)}
      >
        <div className="flex flex-col gap-4 p-7">
          {titulo && <h2 className="text-ink font-serif text-[20px]">{titulo}</h2>}
          <p className="text-ink-soft text-[14px] leading-relaxed">{descripcion}</p>
          <div className="mt-2 flex justify-end gap-3">
            <button
              ref={cancelarRef}
              className="ease border-rule text-muted hover:border-ochre hover:text-ochre border px-4 py-2 text-[11px] tracking-[0.12em] uppercase transition duration-200"
              type="button"
              onClick={() => cerrar(false)}
            >
              {textoCancelar}
            </button>
            <button
              className={`ease px-4 py-2 text-[11px] tracking-[0.14em] uppercase transition duration-200 ${
                peligroso
                  ? "bg-brick text-paper hover:opacity-90"
                  : "bg-ink text-paper hover:bg-ochre"
              }`}
              type="button"
              onClick={() => cerrar(true)}
            >
              {textoConfirmar}
            </button>
          </div>
        </div>
      </dialog>
    );
  }

  return [confirmar, ConfirmDialog];
}
