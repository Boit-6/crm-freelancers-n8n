import type {Metadata} from "next";

import AceptarPropuesta from "./aceptar-propuesta";

export const metadata: Metadata = {
  robots: {index: false, follow: false},
};

export default async function AceptarPage({
  params,
  searchParams,
}: {
  params: Promise<{leadId: string}>;
  searchParams: Promise<{token?: string}>;
}) {
  const {leadId} = await params;
  const {token} = await searchParams;

  return (
    <main className="mx-auto w-full max-w-2xl px-6 pt-10 pb-20 sm:px-10">
      <div className="border-rule mb-10 border-b pb-8">
        <p className="text-ochre mb-4 text-[10px] tracking-[0.22em] uppercase">Aceptar propuesta</p>
        <h1 className="text-ink font-serif text-[clamp(2.4rem,6vw,3rem)] leading-[1.03] tracking-tight">
          Confirmá tu propuesta.
        </h1>
      </div>

      <AceptarPropuesta leadId={leadId} token={token ?? ""} />
    </main>
  );
}
