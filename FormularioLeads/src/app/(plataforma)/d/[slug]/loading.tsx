import {Cargando, Esqueleto} from "@/app/components/esqueleto";

export default function PerfilLoading() {
  return (
    <Cargando
      className="mx-auto w-full max-w-4xl px-6 pt-10 pb-20 sm:px-10"
      etiqueta="Cargando el perfil…"
    >
      <div className="border-rule mb-10 flex flex-col gap-4 border-b pb-8">
        <Esqueleto className="h-2.5 w-48" />
        <Esqueleto className="h-12 w-72 max-w-full" />
        <Esqueleto className="h-4 w-56" />
      </div>
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="flex flex-col gap-4">
          <Esqueleto className="h-4 w-full" />
          <Esqueleto className="h-4 w-11/12" />
          <Esqueleto className="h-4 w-2/3" />
          <Esqueleto className="mt-6 h-24 w-full" />
          <Esqueleto className="h-24 w-full" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {["w-16", "w-20", "w-24", "w-14"].map((a) => (
            <Esqueleto key={a} className={`h-7 ${a}`} />
          ))}
        </div>
      </div>
    </Cargando>
  );
}
