/**
 * Pontos de interesse perto do imóvel (OpenStreetMap / Overpass), com cache.
 *
 * A ajuda do Canal Pro ("Como aumentar o LQS do anúncio?") pede que a
 * descrição cite pontos de interesse próximos, como mercados, escolas e
 * academias. Terreno e sala comercial quase não têm ficha (sem quartos,
 * banheiros ou vagas) e são a maioria das descrições que o portal marca como
 * incompletas: a vizinhança é dado real do anúncio que pode entrar no texto.
 *
 * Só dado do mapa: nome e tipo do lugar e distância em linha reta a partir da
 * coordenada do anúncio, arredondada. Nada é inventado; sem coordenada ou sem
 * lugar com nome por perto, a descrição fica como está.
 *
 * USO JUSTO DO OVERPASS: poucos pedidos por execução, com pausa, User-Agent
 * identificado e cache por quadra (~110 m). O cache fica publicado ao lado do
 * XML (arredores.json) e volta a cada execução, como o geocode.json.
 */
export const OVERPASS = "https://overpass-api.de/api/interpreter";
const USER_AGENT = "jazz-xml-feed/1.0 (+https://github.com/imobjazz-eng/jazz-xml)";
export const RAIO_M = 1500;
const RETENTAR_DIAS = 7;
const RENOVAR_DIAS = 180;
const MAX_ITENS = 5;

/** Tipo do lugar → como aparece na descrição. A ordem desempata a distância. */
export const TIPOS = [
  { chave: "shop", valor: "supermarket", nome: "supermercado" },
  { chave: "amenity", valor: "school", nome: "escola" },
  { chave: "amenity", valor: "pharmacy", nome: "farmácia" },
  { chave: "shop", valor: "mall", nome: "shopping" },
  { chave: "amenity", valor: "hospital", nome: "hospital" },
  { chave: "amenity", valor: "university", nome: "faculdade" },
  { chave: "amenity", valor: "college", nome: "faculdade" },
  { chave: "leisure", valor: "park", nome: "parque" },
  { chave: "amenity", valor: "bank", nome: "banco" },
];

const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
const hoje = (agora) => agora.toISOString().slice(0, 10);

/** Chave do cache: a quadra (3 casas decimais, ~110 m). */
export const chaveArredores = (lat, lon) =>
  Number.isFinite(lat) && Number.isFinite(lon) ? `${lat.toFixed(3)},${lon.toFixed(3)}` : null;

export function distanciaM(lat1, lon1, lat2, lon2) {
  const r = 6_371_000;
  const rad = (g) => (g * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

export function consultaOverpass(lat, lon, raio = RAIO_M) {
  const grupos = new Map();
  for (const t of TIPOS) grupos.set(t.chave, [...(grupos.get(t.chave) || []), t.valor]);
  const linhas = [...grupos].map(([k, vs]) => `  nwr(around:${raio},${lat},${lon})["${k}"~"^(${vs.join("|")})$"]["name"];`);
  return `[out:json][timeout:25];\n(\n${linhas.join("\n")}\n);\nout center tags;`;
}

/** Nome que pode ir para a descrição: curto, sem contato nem marcação. */
function nomeLimpo(n) {
  const t = String(n ?? "").replace(/\s+/g, " ").trim();
  if (t.length < 3 || t.length > 60) return null;
  if (/[<>[\]{}@]|https?:|www\.|\d{4}[-\s]?\d{4}/i.test(t)) return null;
  if (!/\p{L}{3}/u.test(t)) return null;
  return t;
}

/**
 * Resposta do Overpass → até MAX_ITENS lugares [tipo, nome, metros]: o mais
 * perto de cada tipo, do mais perto para o mais longe.
 */
export function escolherArredores(lat, lon, elementos, { max = MAX_ITENS } = {}) {
  const melhor = new Map();
  for (const el of elementos || []) {
    const tags = el.tags || {};
    const tipo = TIPOS.find((t) => tags[t.chave] === t.valor);
    const nome = nomeLimpo(tags.name);
    const plat = el.lat ?? el.center?.lat;
    const plon = el.lon ?? el.center?.lon;
    if (!tipo || !nome || !Number.isFinite(plat) || !Number.isFinite(plon)) continue;
    const d = distanciaM(lat, lon, plat, plon);
    const atual = melhor.get(tipo.nome);
    if (!atual || d < atual[2]) melhor.set(tipo.nome, [tipo.nome, nome, d]);
  }
  const ordem = (n) => TIPOS.findIndex((t) => t.nome === n);
  return [...melhor.values()]
    .sort((a, b) => a[2] - b[2] || ordem(a[0]) - ordem(b[0]))
    .slice(0, max)
    .map(([t, n, d]) => [t, n, Math.max(100, Math.round(d / 100) * 100)]);
}

const sem = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** "supermercado Dia (300 m)"; o tipo só entra se o nome não o disser. */
export function textoDoLugar([tipo, nome, metros]) {
  const raiz = sem(tipo).slice(0, 5);
  const diz = sem(nome).includes(raiz) || (tipo === "farmácia" && /drog/i.test(nome)) || (tipo === "escola" && /col[eé]gio|e\.?\s?e\.?\b|emef|creche/i.test(nome)) || (tipo === "faculdade" && /universidade|fatec|instituto|unesp|unicamp|usp\b|ita\b|unifesp|univap|unip\b/i.test(nome));
  const dist = metros >= 1000 ? `${(metros / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km` : `${metros} m`;
  return `${diz ? nome : `${tipo} ${nome}`} (${dist})`;
}

/** Linha da descrição; vazia sem lugares. */
export function linhaArredores(itens) {
  if (!Array.isArray(itens) || !itens.length) return "";
  const partes = itens.map(textoDoLugar);
  const lista = partes.length > 1 ? `${partes.slice(0, -1).join(", ")} e ${partes.at(-1)}` : partes[0];
  return `Perto do imóvel (distância em linha reta): ${lista}.`;
}

export function precisaConsultar(entrada, agora = new Date()) {
  if (!entrada) return true;
  const dias = (agora - new Date(entrada.t)) / 86_400_000;
  return entrada.s === "ok" ? !(dias < RENOVAR_DIAS) : !(dias < RETENTAR_DIAS);
}

/**
 * Consulta até `limite` quadras pendentes (e no máximo `tempoMs` no total) e
 * grava no `cache` (chave → {s, i, t}). Erro de rede não derruba o feed: para
 * e segue com o que já tem.
 */
export async function buscarArredores(coordenadas, cache, { limite = 40, intervaloMs = 1500, tempoMs = 120_000, agora = new Date(), url = OVERPASS, baixar = fetch } = {}) {
  const vistas = new Set();
  const pendentes = [];
  for (const { lat, lon } of coordenadas) {
    const chave = chaveArredores(lat, lon);
    if (!chave || vistas.has(chave)) continue;
    vistas.add(chave);
    if (precisaConsultar(cache[chave], agora)) pendentes.push({ chave, lat: Number(lat.toFixed(3)), lon: Number(lon.toFixed(3)) });
  }
  const resumo = { pendentes: pendentes.length, consultados: 0, comLugares: 0, erro: null };
  const inicio = Date.now();
  for (const p of pendentes.slice(0, Math.max(0, limite))) {
    if (Date.now() - inicio > tempoMs) break;
    try {
      if (resumo.consultados > 0) await espera(intervaloMs);
      resumo.consultados++;
      const r = await baixar(url, {
        method: "POST",
        headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ data: consultaOverpass(p.lat, p.lon) }).toString(),
        signal: AbortSignal.timeout(40_000),
      });
      if (!r.ok) throw new Error(`Overpass HTTP ${r.status}`);
      const itens = escolherArredores(p.lat, p.lon, (await r.json()).elements);
      cache[p.chave] = { s: "ok", i: itens, t: hoje(agora) };
      if (itens.length) resumo.comLugares++;
    } catch (err) {
      resumo.erro = err.message;
      break;
    }
  }
  return resumo;
}

/** (lat, lon) → lista do cache, ou null. */
export const arredoresDoCache = (cache) => (lat, lon) => {
  const e = cache[chaveArredores(lat, lon)];
  return e && e.s === "ok" && e.i?.length ? e.i : null;
};
