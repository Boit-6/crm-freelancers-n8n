import {Cargando, Esqueleto} from "@/app/components/esqueleto";

export default function DesarrolladoresLoading() {
  return (
    <Cargando
      className="mx-auto w-full max-w-5xl px-6 pt-10 pb-20 sm:px-10"
      etiqueta="Cargando el directorio…"
    >
      <div className="border-rule mb-10 flex flex-col gap-4 border-b pb-8">
        <Esqueleto className="h-2.5 w-24" />
        <Esqueleto className="h-12 w-72 max-w-full" />
        <Esqueleto className="h-4 w-96 max-w-full" />
      </div>
      <Esqueleto className="mb-10 h-11 w-full" />
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({length: 4}, (_, i) => (
          <div key={i} className="border-rule-soft bg-card flex flex-col gap-3 border px-6 py-5">
            <Esqueleto className="h-6 w-44" />
            <Esqueleto className="h-4 w-32" />
            <Esqueleto className="h-4 w-full" />
            <Esqueleto className="h-4 w-4/5" />
            <div className="flex gap-1.5">
              <Esqueleto className="h-5 w-20" />
              <Esqueleto className="h-5 w-16" />
              <Esqueleto className="h-5 w-14" />
            </div>
          </div>
        ))}
      </div>
    </Cargando>
  );
}
