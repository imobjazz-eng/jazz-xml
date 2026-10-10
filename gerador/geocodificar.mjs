/**
 * Geocodificação dos anúncios sem coordenada (Nominatim / OpenStreetMap),
 * com cache — mesma fonte e mesmas conferências do feed antigo:
 *
 *  - a cidade devolvida tem de ser a cidade do anúncio ("cidade_divergente");
 *  - o nome da rua devolvida tem de conter o da rua pedida ("via_divergente");
 *  - a coordenada tem de cair no estado (ver `coordenadaPlausivel`).
 *
 * Sem número da casa: o Vista não exporta o número, então o ponto é o da rua,
 * coerente com o displayAddress="Neighborhood" do anúncio.
 *
 * USO JUSTO DO NOMINATIM: 1 pedido por segundo, User-Agent identificado e
 * cache. Cada endereço é pedido uma vez; o que falha só é tentado de novo
 * depois de `RETENTAR_DIAS`. O cache fica publicado ao lado do XML
 * (geocode.json) e volta a cada execução.
 */
import { coordenadaPlausivel } from "./enriquecer.mjs";

export const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "jazz-xml-feed/1.0 (+https://github.com/imobjazz-eng/jazz-xml)";
const RETENTAR_DIAS = 30;

const normalizar = (s) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const TIPOS_VIA = new Set(["rua", "r", "avenida", "av", "alameda", "al", "estrada", "est", "travessa", "tv", "rodovia", "rod", "praca", "pca", "largo", "viela", "servidao", "via", "acesso", "marginal", "beco", "passagem", "ladeira"]);
const IGNORAR = new Set(["de", "da", "do", "das", "dos", "e", "doutor", "dr", "professor", "prof", "profa", "engenheiro", "eng", "padre", "pe", "coronel", "cel", "general", "gen", "capitao", "cap", "prefeito", "vereador", "senador", "deputado", "presidente", "dona", "dom", "frei", "irma", "monsenhor", "comendador", "sargento", "tenente", "major", "marechal", "almirante"]);

const palavrasDaVia = (s) => normalizar(s).split(" ").filter((p) => p && !TIPOS_VIA.has(p) && !IGNORAR.has(p));

/** A rua devolvida é a rua pedida? Todas as palavras do nome pedido têm de estar lá. */
export function mesmaVia(pedida, devolvida) {
  const p = palavrasDaVia(pedida);
  const d = new Set(palavrasDaVia(devolvida));
  return p.length > 0 && p.every((x) => d.has(x));
}

export function mesmaCidade(pedida, endereco = {}) {
  const alvo = normalizar(pedida);
  return [endereco.city, endereco.town, endereco.municipality, endereco.village].some((c) => c && normalizar(c) === alvo);
}

/** Escolhe o primeiro resultado que passa nas três conferências. */
export function escolherResultado(e, resultados) {
  let motivo = "sem_resultado";
  for (const r of resultados || []) {
    const lat = Number(r.lat);
    const lon = Number(r.lon);
    const end = r.address || {};
    if (!mesmaCidade(e.cidade, end)) { motivo = "cidade_divergente"; continue; }
    const via = end.road || end.pedestrian || end.footway || end.residential || r.name || "";
    if (!mesmaVia(e.rua, via)) { motivo = "via_divergente"; continue; }
    if (!coordenadaPlausivel(lat, lon, e.uf)) { motivo = "fora_do_estado"; continue; }
    return { ok: true, lat, lon };
  }
  return { ok: false, motivo };
}

const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
const hoje = (agora) => agora.toISOString().slice(0, 10);

/** Precisa consultar? Não está no cache, ou falhou há mais de RETENTAR_DIAS. */
export function precisaConsultar(entrada, agora = new Date()) {
  if (!entrada) return true;
  if (entrada.s === "ok") return false;
  const dias = (agora - new Date(entrada.t)) / 86_400_000;
  return !(dias < RETENTAR_DIAS);
}

/**
 * Consulta até `limite` endereços pendentes e grava no `cache` (objeto
 * chave → {s, lat, lon, t}). Erro de rede não derruba o feed: para de
 * consultar e segue com o que já tem.
 */
export async function geocodificar(enderecos, cache, { limite = 200, intervaloMs = 1100, agora = new Date(), url = NOMINATIM } = {}) {
  const pendentes = enderecos.filter((e) => precisaConsultar(cache[e.chave], agora));
  const resumo = { pendentes: pendentes.length, consultados: 0, achados: 0, falhas: {}, erro: null };
  for (const e of pendentes.slice(0, Math.max(0, limite))) {
    const q = new URLSearchParams({
      street: e.rua,
      city: e.cidade,
      state: e.estado || e.uf || "",
      country: "Brasil",
      countrycodes: "br",
      format: "jsonv2",
      addressdetails: "1",
      limit: "3",
    });
    try {
      if (resumo.consultados > 0) await espera(intervaloMs);
      resumo.consultados++;
      const r = await fetch(`${url}?${q}`, { headers: { "User-Agent": USER_AGENT, "Accept-Language": "pt-BR" } });
      if (!r.ok) throw new Error(`Nominatim HTTP ${r.status}`);
      const escolha = escolherResultado(e, await r.json());
      if (escolha.ok) {
        cache[e.chave] = { s: "ok", lat: Number(escolha.lat.toFixed(7)), lon: Number(escolha.lon.toFixed(7)), t: hoje(agora) };
        resumo.achados++;
      } else {
        cache[e.chave] = { s: escolha.motivo, t: hoje(agora) };
        resumo.falhas[escolha.motivo] = (resumo.falhas[escolha.motivo] || 0) + 1;
      }
    } catch (err) {
      resumo.erro = err.message;
      break;
    }
  }
  return resumo;
}

/** Função de consulta ao cache no formato que `enriquecerFeed` espera. */
export const consultaCache = (cache) => (chave) => {
  const e = cache[chave];
  return e && e.s === "ok" ? { lat: e.lat, lon: e.lon } : null;
};
