import {existsSync, readFileSync} from 'node:fs';

export function cargarEnv(ruta) {
  if (!existsSync(ruta)) return;
  for (const linea of readFileSync(ruta, 'utf8').split('\n')) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

export function crearRest(base, key, fetchImpl = fetch) {
  return async (ruta, opciones = {}) => {
    const res = await fetchImpl(`${base}/rest/v1/${ruta}`, {
      ...opciones,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...(opciones.headers ?? {}),
      },
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
    const texto = await res.text();
    return texto ? JSON.parse(texto) : [];
  };
}

export function crearWebhook(base, fetchImpl = fetch, cabeceras = {}) {
  return async (ruta, {metodo = 'POST', cuerpo, headers = {}} = {}) => {
    const res = await fetchImpl(`${base}/webhook/${ruta}`, {
      method: metodo,
      headers: {'Content-Type': 'application/json', ...cabeceras, ...headers},
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    const texto = await res.text();
    let json = null;
    try { json = texto ? JSON.parse(texto) : null; } catch { /* respuesta no JSON */ }
    return {status: res.status, texto, json};
  };
}
