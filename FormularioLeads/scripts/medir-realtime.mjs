#!/usr/bin/env node
// E7 / RNF6: mide postgres_changes con una sesión autenticada del desarrollador,
// no con la clave anon sin sesión ni con service_role para la suscripción.
// Crea un lead ficticio en SU espacio con service_role y lo elimina al terminar.
// No ejecutar contra producción sin planificar el dato de prueba.
// Uso: node scripts/medir-realtime.mjs [--n 5] (también --muestras 5).
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rutaEnv = path.join(raiz, '.env.local');
if (existsSync(rutaEnv)) {
  for (const linea of readFileSync(rutaEnv, 'utf8').split('\n')) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

const arg = (nombre) => {
  const i = process.argv.indexOf(nombre);
  return i < 0 ? undefined : process.argv[i + 1];
};
const muestras = Number(arg('--n') ?? arg('--muestras') ?? 5);
if (!Number.isInteger(muestras) || muestras < 1) {
  console.error('--n/--muestras debe ser un entero positivo');
  process.exitCode = 2;
} else {
  await medir(muestras);
}

async function medir(n) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const email = process.env.REALTIME_TEST_EMAIL;
  const password = process.env.REALTIME_TEST_PASSWORD;
  if (![url, anon, service, email, password].every(Boolean)) {
    console.error('Faltan NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, REALTIME_TEST_EMAIL o REALTIME_TEST_PASSWORD.');
    process.exitCode = 2;
    return;
  }

  // Import diferido: validar argumentos no debe exigir node_modules (el CI del
  // artefacto no instala las dependencias del front).
  const {createClient} = await import('@supabase/supabase-js');
  const escritor = createClient(url, service, {auth: {persistSession: false}});
  const lector = createClient(url, anon, {auth: {persistSession: false, autoRefreshToken: false}});
  const id = `LD-RT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let canal;
  let intentoAlta = false;
  try {
    const {data: sesion, error: errorAuth} = await lector.auth.signInWithPassword({email, password});
    if (errorAuth || !sesion.session?.access_token || !sesion.user?.id) {
      throw new Error(`No se pudo autenticar al lector: ${errorAuth?.message ?? 'sin sesión'}`);
    }
    lector.realtime.setAuth(sesion.session.access_token);
    const {data: espacios, error: errorEspacios} = await lector.from('espacios').select('id').eq('dueno_id', sesion.user.id).limit(1);
    if (errorEspacios || !espacios?.length) throw new Error(`El usuario de prueba no tiene espacio legible: ${errorEspacios?.message ?? 'sin filas'}`);
    const espacioId = espacios[0].id;

    let recibir = null;
    canal = lector.channel(`e7-${id}`).on('postgres_changes', {event: 'UPDATE', schema: 'public', table: 'leads', filter: `lead_id=eq.${id}`}, (payload) => {
      if (payload.new?.lead_id === id) recibir?.(Date.now());
    });
    await new Promise((resolve, reject) => {
      const limite = setTimeout(() => reject(new Error('La suscripción no quedó activa en 15 s')), 15000);
      canal.subscribe((estado) => {
        if (estado === 'SUBSCRIBED') { clearTimeout(limite); resolve(); }
        if (estado === 'CHANNEL_ERROR' || estado === 'TIMED_OUT') { clearTimeout(limite); reject(new Error(`Canal: ${estado}`)); }
      });
    });

    intentoAlta = true;
    const {error: errorAlta} = await escritor.from('leads').insert({lead_id: id, espacio_id: espacioId, nombre: '[TEST realtime]', email: `rt.${Date.now()}@example.test`, presupuesto: 1000});
    if (errorAlta) throw new Error(`No se pudo crear el lead de prueba: ${errorAlta.message}`);

    const latencias = [];
    console.log(`E7 — sesión autenticada; espacio ${espacioId}; ${n} muestras; umbral 3000 ms`);
    for (let i = 1; i <= n; i++) {
      let cancelar;
      const llegada = new Promise((resolve) => { recibir = resolve; });
      const espera = new Promise((resolve) => { cancelar = setTimeout(() => resolve(null), 10000); });
      const inicio = Date.now();
      try {
        const {error} = await escritor.from('leads').update({score: i}).eq('lead_id', id);
        if (error) throw new Error(`No se pudo actualizar el lead: ${error.message}`);
        const fin = await Promise.race([llegada, espera]);
        if (fin === null) console.log(`  muestra ${i}: sin evento`);
        else { latencias.push(fin - inicio); console.log(`  muestra ${i}: ${fin - inicio} ms`); }
      } finally {
        clearTimeout(cancelar);
        recibir = null;
      }
    }
    const maximo = latencias.length ? Math.max(...latencias) : null;
    const orden = [...latencias].sort((a, b) => a - b);
    const p95 = orden.length ? orden[Math.ceil(0.95 * orden.length) - 1] : null;
    const cumple = latencias.length === n && maximo < 3000;
    console.log(`Eventos: ${latencias.length}/${n}; máximo: ${maximo ?? '-'} ms; p95: ${p95 ?? '-'} ms; ${cumple ? 'CUMPLE' : 'NO CUMPLE'}`);
    if (!cumple) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    if (intentoAlta) {
      const {error} = await escritor.from('leads').delete().eq('lead_id', id);
      if (error) { console.error(`No se pudo eliminar el lead de prueba ${id}: ${error.message}`); process.exitCode = 1; }
    }
    if (canal) await lector.removeChannel(canal);
    await lector.auth.signOut();
  }
}
