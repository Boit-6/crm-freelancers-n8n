// Reacomoda el lienzo de un workflow de n8n para que nada quede encimado.
// Cada rama (componente conexo) se dibuja de izquierda a derecha por capas
// —la capa es el camino más largo desde su disparador— y las ramas se apilan
// en filas, en el orden en que ya estaban y con una proporción cercana a la de
// una pantalla ancha, para que la vista completa se lea. La nota de cada rama pasa a ser un marco con
// el texto arriba y los nodos debajo, sin texto detrás de ningún nodo.
// Sólo cambia posiciones y tamaños de notas: ni nodos, ni parámetros, ni
// conexiones.
//
//   node scripts/ordenar-workflow.mjs workflow/crm_postgres.json            # muestra el resumen
//   node scripts/ordenar-workflow.mjs workflow/crm_postgres.json --escribir # además lo guarda
import {readFileSync, writeFileSync} from "node:fs";

const NOTA = "n8n-nodes-base.stickyNote";
const PASO_X = 280;    // entre capas: el nodo mide 100 y la etiqueta, unos 200
const PASO_Y = 200;    // entre nodos de una capa: nodo + etiqueta de dos líneas
const ALTO_NODO = 170; // nodo + etiqueta
const MARGEN = 80;     // del marco de la nota a los nodos
const SEPARACION = 200;
const ORIGEN_X = 200;
const PROPORCION = 2;

const redondear = (v) => Math.round(v / 20) * 20;

/** Alto aproximado del texto de una nota de n8n con ese ancho. */
function altoTexto(contenido, ancho) {
  const porLinea = Math.max(20, Math.floor((ancho - 40) / 7));
  let alto = 24;
  for (const linea of String(contenido ?? "").split("\n")) {
    if (/^#{1,3} /.test(linea)) alto += 34;
    else if (!linea.trim()) alto += 10;
    else alto += Math.ceil(linea.replace(/[*_`]/g, "").length / porLinea) * 21;
  }
  return alto;
}

export function ordenar(workflow) {
  const nodos = workflow.nodes.filter((n) => n.type !== NOTA);
  const notas = workflow.nodes.filter((n) => n.type === NOTA);
  const porNombre = new Map(nodos.map((n) => [n.name, n]));

  const hijos = new Map(nodos.map((n) => [n.name, []]));
  const padres = new Map(nodos.map((n) => [n.name, []]));
  for (const [origen, tipos] of Object.entries(workflow.connections)) {
    if (!porNombre.has(origen)) continue;
    for (const salidas of Object.values(tipos)) {
      salidas.forEach((destinos, salida) => {
        for (const d of destinos ?? []) {
          if (!porNombre.has(d.node)) continue;
          hijos.get(origen).push({nombre: d.node, salida});
          padres.get(d.node).push(origen);
        }
      });
    }
  }

  // Componentes conexos (ramas).
  const grupo = new Map();
  const raiz = (x) => (grupo.get(x) === x ? x : (grupo.set(x, raiz(grupo.get(x))), grupo.get(x)));
  for (const n of nodos) grupo.set(n.name, n.name);
  for (const [a, hs] of hijos) for (const h of hs) grupo.set(raiz(a), raiz(h.nombre));
  const ramas = new Map();
  for (const n of nodos) {
    const r = raiz(n.name);
    if (!ramas.has(r)) ramas.set(r, []);
    ramas.get(r).push(n);
  }

  const ordenOriginal = [...ramas.values()];

  // Cada nota se asigna a la rama con más nodos dentro de su marco original.
  const notasDe = new Map();
  const notasSueltas = [];
  for (const nota of notas) {
    const [x, y] = nota.position;
    const {width: w = 240, height: h = 160} = nota.parameters;
    let mejor = null, cuenta = 0;
    for (const rama of ordenOriginal) {
      const c = rama.filter(({position: [nx, ny]}) => nx >= x && nx <= x + w && ny >= y && ny <= y + h).length;
      if (c > cuenta) { mejor = rama; cuenta = c; }
    }
    // Sin nodos adentro (por ejemplo, un encabezado al costado del marco):
    // va con la rama más cercana, así volver a ordenar no la desarma.
    if (!mejor) {
      let distancia = Infinity;
      for (const rama of ordenOriginal) {
        for (const {position: [nx, ny]} of rama) {
          const d = Math.hypot(Math.max(x - nx, 0, nx - (x + w)), Math.max(y - ny, 0, ny - (y + h)));
          if (d < distancia) { distancia = d; mejor = rama; }
        }
      }
    }
    if (!mejor) { notasSueltas.push(nota); continue; }
    if (!notasDe.has(mejor)) notasDe.set(mejor, []);
    notasDe.get(mejor).push(nota);
  }

  // Orden de lectura: por la esquina superior izquierda de cada rama con sus
  // notas, que es lo que se conserva al volver a ordenar.
  const esquina = (rama) => {
    const piezas = [...rama, ...(notasDe.get(rama) ?? [])];
    return [Math.min(...piezas.map((p) => p.position[1])), Math.min(...piezas.map((p) => p.position[0]))];
  };
  ordenOriginal.sort((a, b) => {
    const [ya, xa] = esquina(a), [yb, xb] = esquina(b);
    return ya - yb || xa - xb;
  });

  let cursorY = 0;
  const bloques = [];

  // Notas sin rama: en fila, arriba de todo.
  if (notasSueltas.length) {
    let x = ORIGEN_X - MARGEN, alto = 0;
    for (const nota of notasSueltas) {
      const ancho = Math.max(nota.parameters.width ?? 400, 400);
      const h = redondear(altoTexto(nota.parameters.content, ancho) + 20);
      Object.assign(nota.parameters, {width: ancho, height: h});
      nota.position = [x, cursorY];
      x += ancho + 60;
      alto = Math.max(alto, h);
    }
    cursorY += alto + SEPARACION;
  }

  const inicioRamas = cursorY;
  for (const rama of ordenOriginal) {
    cursorY = 0;
    const nombres = new Set(rama.map((n) => n.name));
    const raices = rama.filter((n) => padres.get(n.name).every((p) => !nombres.has(p)));
    const inicio = raices.length ? raices : [rama[0]];

    // Capa = camino más largo desde un disparador, ignorando los ciclos.
    const capa = new Map();
    const enCurso = new Set();
    const visitar = (nombre, c) => {
      if (enCurso.has(nombre) || (capa.get(nombre) ?? -1) >= c) return;
      capa.set(nombre, c);
      enCurso.add(nombre);
      for (const h of hijos.get(nombre)) visitar(h.nombre, c + 1);
      enCurso.delete(nombre);
    };
    inicio.forEach((r) => visitar(r.name, 0));
    for (const n of rama) if (!capa.has(n.name)) capa.set(n.name, 0);

    // Y deseada: el promedio de lo que cada padre le reserva a ese hijo,
    // repartiendo sus hijos en orden de salida (true arriba, false abajo).
    const y = new Map();
    const capas = [];
    for (const n of rama) (capas[capa.get(n.name)] ??= []).push(n.name);
    capas.forEach((miembros = [], c) => {
      const deseada = (nombre) => {
        if (c === 0) return inicio.findIndex((r) => r.name === nombre) * PASO_Y;
        const aportes = padres.get(nombre).filter((p) => y.has(p)).map((p) => {
          const hs = [...hijos.get(p)].sort((a, b) => a.salida - b.salida);
          const i = hs.findIndex((h) => h.nombre === nombre);
          return y.get(p) + (i - (hs.length - 1) / 2) * PASO_Y;
        });
        return aportes.length ? aportes.reduce((a, b) => a + b, 0) / aportes.length : 0;
      };
      const ordenados = miembros.map((m) => ({m, d: deseada(m)})).sort((a, b) => a.d - b.d);
      let previo = -Infinity;
      for (const o of ordenados) { o.y = Math.max(o.d, previo + PASO_Y); previo = o.y; }
      const corrimiento = ordenados.reduce((s, o) => s + (o.d - o.y), 0) / (ordenados.length || 1);
      for (const o of ordenados) y.set(o.m, o.y + corrimiento);
    });

    const ys = rama.map((n) => y.get(n.name));
    const yMin = Math.min(...ys);
    const altoRama = Math.max(...ys) - yMin + ALTO_NODO;
    const anchoRama = Math.max(...rama.map((n) => capa.get(n.name))) * PASO_X + 100;

    // Notas de la rama: la primera es el marco; las demás, encabezados al lado.
    const propias = notasDe.get(rama) ?? [];
    const anchoMarco = Math.max(anchoRama + 2 * MARGEN, 700);
    const encabezado = propias.length
      ? Math.max(...propias.map((nota, i) => altoTexto(nota.parameters.content, i === 0 ? anchoMarco : 600)))
      : 0;
    const arribaNodos = cursorY + (propias.length ? encabezado + MARGEN : 0);

    for (const n of rama) {
      n.position = [redondear(ORIGEN_X + capa.get(n.name) * PASO_X), redondear(arribaNodos + y.get(n.name) - yMin)];
    }
    propias.forEach((nota, i) => {
      if (i === 0) {
        nota.position = [ORIGEN_X - MARGEN, cursorY];
        Object.assign(nota.parameters, {width: redondear(anchoMarco), height: redondear(encabezado + MARGEN + altoRama + MARGEN)});
      } else {
        nota.position = [redondear(ORIGEN_X - MARGEN + anchoMarco + 60 + (i - 1) * 660), cursorY];
        Object.assign(nota.parameters, {width: 600, height: redondear(altoTexto(nota.parameters.content, 600) + 20)});
      }
    });

    const anchoNotas = propias.length > 1 ? anchoMarco + 60 + (propias.length - 1) * 660 : propias.length ? anchoMarco : anchoRama;
    bloques.push({
      piezas: [...rama, ...propias],
      ancho: anchoNotas,
      alto: redondear(arribaNodos + altoRama + (propias.length ? MARGEN : 0)),
    });
  }

  // Bloques en filas: el ancho de fila sale del área total y la proporción.
  const area = bloques.reduce((s, b) => s + (b.ancho + SEPARACION) * (b.alto + SEPARACION), 0);
  const anchoFila = Math.max(Math.sqrt(area * PROPORCION), ...bloques.map((b) => b.ancho));
  let x = 0, y = inicioRamas, altoFila = 0;
  for (const b of bloques) {
    if (x > 0 && x + b.ancho > anchoFila) { x = 0; y += altoFila + SEPARACION; altoFila = 0; }
    for (const pieza of b.piezas) pieza.position = [redondear(pieza.position[0] + x), redondear(pieza.position[1] + y)];
    x += b.ancho + SEPARACION;
    altoFila = Math.max(altoFila, b.alto);
  }

  return {ramas: ramas.size, nodos: nodos.length, notas: notas.length, notasSueltas: notasSueltas.length};
}

/** Pares de nodos cuyas cajas (con etiqueta) se pisan. */
export function encimados(workflow) {
  const ns = workflow.nodes.filter((n) => n.type !== NOTA);
  const pares = [];
  for (let i = 0; i < ns.length; i++) {
    for (let j = i + 1; j < ns.length; j++) {
      const [a, b] = [ns[i].position, ns[j].position];
      if (Math.abs(a[0] - b[0]) < PASO_X - 20 && Math.abs(a[1] - b[1]) < PASO_Y - 20) pares.push([ns[i].name, ns[j].name]);
    }
  }
  return pares;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ruta = process.argv[2];
  const workflow = JSON.parse(readFileSync(ruta, "utf8"));
  const antes = encimados(workflow).length;
  const resumen = ordenar(workflow);
  const despues = encimados(workflow).length;
  console.log({...resumen, encimadosAntes: antes, encimadosDespues: despues});
  if (process.argv.includes("--escribir")) writeFileSync(ruta, JSON.stringify(workflow, null, 2) + "\n");
}
