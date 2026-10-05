import {EsqueletoMisProyectos} from "./mis-proyectos";

import {Esqueleto} from "@/app/components/esqueleto";

export default function ClienteLoading() {
  return (
    <main className="mx-auto w-full max-w-4xl px-6 pt-10 pb-20 sm:px-10">
      <div className="border-rule mb-10 flex flex-col gap-4 border-b pb-8">
        <Esqueleto className="h-2.5 w-48" />
        <Esqueleto className="h-11 w-64" />
      </div>
      <Esqueleto className="mb-10 h-12 w-52" />
      <EsqueletoMisProyectos />
    </main>
  );
}
