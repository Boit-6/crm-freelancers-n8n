// Modo demo de portfolio. Con NEXT_PUBLIC_DEMO=1 se muestra un aviso en todas
// las páginas y el login ofrece entrar con las cuentas públicas de prueba.
// Las claves son públicas a propósito: un cron de Supabase las restaura cada
// noche (ver docs/despliegue-demo.md).

export type CuentaDemo = {rol: string; email: string; clave: string};

export function modoDemo(): boolean {
  return process.env.NEXT_PUBLIC_DEMO === "1";
}

export function cuentasDemo(): CuentaDemo[] {
  if (!modoDemo()) return [];

  const cuentas: CuentaDemo[] = [
    {
      rol: "Desarrollador",
      email: process.env.NEXT_PUBLIC_DEMO_DESARROLLADOR_EMAIL ?? "",
      clave: process.env.NEXT_PUBLIC_DEMO_DESARROLLADOR_CLAVE ?? "",
    },
    {
      rol: "Cliente",
      email: process.env.NEXT_PUBLIC_DEMO_CLIENTE_EMAIL ?? "",
      clave: process.env.NEXT_PUBLIC_DEMO_CLIENTE_CLAVE ?? "",
    },
  ];

  return cuentas.filter((cuenta) => cuenta.email && cuenta.clave);
}
