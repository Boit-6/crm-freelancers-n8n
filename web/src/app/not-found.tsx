import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 pt-10 pb-20 text-center sm:px-10">
      <p className="text-ochre mb-5 text-[10px] tracking-[0.22em] uppercase">Error 404</p>
      <h1 className="text-ink font-serif text-[clamp(2.6rem,6vw,3.2rem)] leading-none tracking-tight">
        Página no encontrada
      </h1>
      <p className="text-muted mt-5 text-[15px] leading-relaxed">
        La página que buscás no existe o se movió de lugar.
      </p>
      <Link
        className="text-ochre mt-8 inline-block text-[11px] tracking-[0.14em] uppercase transition duration-200 hover:underline"
        href="/"
      >
        ← Volver al inicio
      </Link>
    </main>
  );
}
