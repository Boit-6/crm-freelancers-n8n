import type {MetadataRoute} from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Enlaces de un solo uso (token de propuesta) y transaccionales de pago:
      // no aportan nada indexados y exponen que existe un flujo de facturación.
      disallow: ["/aceptar/", "/pago-exitoso", "/pago-fallido", "/pago-pendiente"],
    },
    sitemap: `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/sitemap.xml`,
  };
}
