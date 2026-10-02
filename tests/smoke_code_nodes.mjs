// Smoke test de los Code nodes de los workflows de workflow/*.json.
// Ejecuta el JavaScript de cada nodo "Code" con datos de ejemplo y mocks de las
// variables de n8n ($input, $, $json, $env), para detectar errores de runtime sin
// necesidad de levantar n8n. Uso: node tests/smoke_code_nodes.mjs
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));

// Los dos flujos del artefacto, nombrados uno por uno a propósito. Antes esto
// era un `readdirSync` de `*.json`, que barría también las copias de respaldo
// que quedan en el directorio (crm_postgres.backup-*.json): el test corría
// sobre código viejo y el recuento de nodos dejaba de decir nada sobre el
// artefacto que la tesis describe.
const wfDir = path.join(aqui, '..', 'workflow');
const wfFiles = ['crm_postgres.json', 'tickets.json'];

// Variables de entorno que los nodos leen con $env. Los valores son de mentira:
// alcanzan para que la config resuelva y el código corra.
const envMock = {
  TELEGRAM_CHAT_ID: '-1001234567890',
  TICKETS_PROYECTO: 'CRM Freelance',
};

const sample = {
  lead_id: 'LD-1718000000000-ABCD',
  nombre: 'Juan Pérez', email: 'juan@test.com', telefono: '+54 11 5555 5555',
  presupuesto: 6000, urgencia: 'alta', servicio: 'ecommerce',
  descripcion: 'Una tienda online completa con stock, pagos y panel de administracion.',
  fuente: 'webhook', seguimientos: 1, score: 100, tier: 'HOT',
  accept_token: '550e8400-e29b-41d4-a716-446655440000',
  estado_pago: 'PENDIENTE', factura_id: 'FAC-2026-1234', monto: 6000, cliente: 'Juan Pérez',
  dias_al_vencimiento: 3, fecha_vencimiento: '2026-07-01', dias_ciclo_completo: 12,
  body: {
    // CRM
    lead_id: 'LD-1718000000000-ABCD',
    token: '550e8400-e29b-41d4-a716-446655440000',
    estado: 'EN_PROGRESO',
    mensaje: 'Quiero sumar una pasarela de pagos.',
    // Términos que fija el profesional al enviar la propuesta.
    precio: 7200,
    plazo: '3 semanas',
    alcance: 'Sitio de 5 secciones y puesta en produccion.',
    nombre: 'Juan Pérez', email: 'JUAN@test.com', presupuesto: '6000', urgencia: 'ALTA',
    servicio: 'ecommerce', telefono: '+541155555555',
    descripcion: 'Necesito una tienda online completa con varias funcionalidades.',
    // Panel → n8n: el espacio de la sesión (cobros con Stripe).
    espacio_id: '6e6466dc-a839-442b-9278-6b84b9e31ff8',
    // Rechazo de un pedido desde el panel (bolsa de proyectos).
    destino: 'bolsa',
    resumen: 'Tienda online con stock y pagos, para una pyme de indumentaria.',
    // Tickets
    titulo: 'Arreglar el PDF de la factura',
    prioridad: 'ALTA',
    etiquetas: ['facturacion', 'bug'],
    ticket_id: '0f0e0d0c-0b0a-4090-8080-707060605050',
    ref: 'LD-1718000000000-ABCD',
    notas: 'El logo se corta en la segunda página.',
  },
  query: {
    lead_id: 'LD-1718000000000-ABCD',
    token: '550e8400-e29b-41d4-a716-446655440000',
    factura_id: 'FAC-2026-1234',
    pago_token: '660f9511-f3ad-52e5-b827-557766551111',
    limite: '50',
  },
  headers: {'content-type': 'application/json'},
  // Resultado del UPDATE de envejecimiento (workflow de tickets).
  abiertos: 3,
  escaladas: [{titulo: 'Arreglar el PDF <b>de</b> la factura', prioridad: 'ALTA'}],
  criticos: [{titulo: 'Cobrar la factura', dias: 5}],
  execution: {error: {message: 'boom'}, lastNodeExecuted: 'Nodo X'},
  workflow: {name: 'CRM'},
};

function makeMocks(s) {
  const item = {json: s};
  const $input = {first: () => item, all: () => [item, item], last: () => item};
  const $ = () => ({first: () => item, all: () => [item], item: item});
  return {$input, $, $json: s};
}

let ok = 0, fail = 0;
for (const file of wfFiles) {
  const wf = JSON.parse(readFileSync(path.join(wfDir, file), 'utf8'));
  const codeNodes = wf.nodes.filter(n => n.type === 'n8n-nodes-base.code');
  console.log('\n── ' + file + '  (' + codeNodes.length + ' nodos Code)');
  for (const n of codeNodes) {
    try {
      const {$input, $, $json} = makeMocks(sample);
      // Los nodos que leen binario (el cuerpo crudo del webhook de Stripe) usan
      // await y this.helpers, como lo permite el nodo Code de n8n.
      const Ctor = /\bawait\b/.test(n.parameters.jsCode) ? Object.getPrototypeOf(async () => {}).constructor : Function;
      const fn = new Ctor('$input', '$', '$json', '$env', 'Buffer', n.parameters.jsCode);
      const helpers = {getBinaryDataBuffer: async () => Buffer.from('{}')};
      const res = await fn.call({helpers}, $input, $, $json, envMock, Buffer);
      if (!Array.isArray(res)) throw new Error('no devolvio un array');
      for (const r of res) if (!r || typeof r.json !== 'object') throw new Error('item sin .json valido');
      console.log('OK    ' + n.name + '  ->  ' + res.length + ' item(s)');
      ok++;
    } catch (e) {
      console.log('FAIL  ' + n.name + '  ->  ' + e.message);
      fail++;
    }
  }
}
console.log('\nResultado: ' + ok + ' OK, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
