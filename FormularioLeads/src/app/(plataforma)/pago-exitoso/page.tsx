import type {Metadata} from "next";

import PagoResultado from "@/app/components/pago-resultado";

export const metadata: Metadata = {
  robots: {index: false, follow: false},
};

export default async function PagoExitosoPage({
  searchParams,
}: {
  // `factura`: la manda la success_url / cancel_url de la sesión de Stripe.
  searchParams: Promise<{factura?: string}>;
}) {
  const {factura} = await searchParams;

  return (
    <main className="mx-auto w-full max-w-2xl px-6 pt-10 pb-20 sm:px-10">
      <PagoResultado facturaId={factura} variante="exito" />
    </main>
  );
}
