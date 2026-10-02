import {Cargando, Esqueleto} from "@/app/components/esqueleto";

// Misma grilla que pagina-formulario.tsx: franja, marca, columna de texto y
// la tarjeta del formulario con sus secciones.
export default function FormularioLoading() {
  return (
    <Cargando className="flex flex-col" etiqueta="Cargando el formulario…">
      <div className="border-rule-soft bg-card flex justify-center border-b px-6 py-3">
        <Esqueleto className="h-3 w-80 max-w-full" />
      </div>
      <div className="px-6 py-7 sm:px-10">
        <Esqueleto className="h-5 w-32" />
      </div>
      <div className="mx-auto grid w-full max-w-5xl gap-12 px-6 pt-6 pb-20 sm:px-10 lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-16">
        <div className="flex flex-col gap-4">
          <Esqueleto className="h-2.5 w-28" />
          <Esqueleto className="h-12 w-full" />
          <Esqueleto className="h-12 w-3/4" />
          <div className="bg-rule-soft my-3 h-px" />
          <Esqueleto className="h-4 w-full" />
          <Esqueleto className="h-4 w-2/3" />
        </div>
        <div className="border-rule-soft bg-card border">
          {Array.from({length: 4}, (_, i) => (
            <div
              key={i}
              className="border-rule-soft flex flex-col gap-5 border-b px-8 py-8 sm:px-10"
            >
              <div className="flex items-center gap-3">
                <Esqueleto className="h-4 w-4" />
                <Esqueleto className="h-2.5 w-24" />
                <div className="bg-rule-soft h-px flex-1" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Esqueleto className="h-10 w-full" />
                <Esqueleto className="h-10 w-full" />
              </div>
            </div>
          ))}
          <div className="px-8 py-8 sm:px-10">
            <Esqueleto className="h-14 w-full" />
          </div>
        </div>
      </div>
    </Cargando>
  );
}
