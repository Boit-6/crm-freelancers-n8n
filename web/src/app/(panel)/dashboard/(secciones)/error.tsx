"use client";

import {useEffect} from "react";

export default function DashboardError({error, reset}: {error: Error; reset: () => void}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div>
      <div
        className="border-brick bg-brick/5 text-brick border-l-2 px-5 py-3.5 text-[13px]"
        role="alert"
      >
        No pudimos cargar el panel.
      </div>
      <button
        className="ease border-rule hover:border-ochre hover:text-ochre mt-6 border px-3.5 py-2 text-[11px] tracking-[0.12em] uppercase transition duration-200"
        type="button"
        onClick={() => reset()}
      >
        Reintentar
      </button>
    </div>
  );
}
