/**
 * Dados do XML anterior (o "Jazz Smart Feed Engine", congelado em 22/09/2026
 * no Worker da Cloudflare) que o XML do Vista não traz: número do endereço,
 * ano de construção, IPTU, área útil, coordenada e características.
 *
 * A extração é feita uma vez e guardada como antigo.json no gh-pages, ao lado
 * do XML (mesmo esquema do geocode.json): o Worker pode sumir, a cópia não.
 *
 * Valores padrão do XML anterior, mantidos a pedido do Pablo (11/10/2026):
 * ano de construção 2001 e IPTU 201 para quem não tem esses dados no Vista.
 */

export const ANTIGO_URL = "https://jazz-feed-vrsync.pablo-jazzimob.workers.dev/vrsync.xml";
export const ANO_PADRAO = 2001;
export const IPTU_PADRAO = 201;

function valor(bloco, tag) {
  const m = bloco.match(new RegExp(`<${tag}(?:\\s[^>]*)?>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*</${tag}>`));
  return m ? m[1].trim() : "";
}
const positivo = (s) => {
  const n = Number(s);
  return Number.isFinite(n) && n >= 1 ? n : null;
};

/** {código: {numero, ano, iptu, area_util, lat, lon, caracteristicas}} do XML anterior. */
export function extrairAntigo(xml) {
  const dados = {};
  for (const [bloco] of xml.matchAll(/<Listing>[\s\S]*?<\/Listing>/g)) {
    const codigo = valor(bloco, "ListingID");
    if (!codigo) continue;
    const d = {};
    const numero = valor(bloco, "StreetNumber");
    if (/^\d{1,6}[A-Za-z]?$/.test(numero) && Number.parseInt(numero, 10) > 0) d.numero = numero;
    const ano = Number(valor(bloco, "YearBuilt"));
    if (Number.isInteger(ano) && ano >= 1800 && ano <= 2100) d.ano = ano;
    const iptu = positivo(valor(bloco, "YearlyTax"));
    if (iptu) d.iptu = Math.round(iptu);
    const area = positivo(valor(bloco, "LivingArea"));
    if (area) d.area_util = Math.round(area);
    const lat = Number(valor(bloco, "Latitude"));
    const lon = Number(valor(bloco, "Longitude"));
    if (lat && lon && Number.isFinite(lat) && Number.isFinite(lon)) { d.lat = lat; d.lon = lon; }
    const caracteristicas = [...bloco.matchAll(/<Feature>([^<]+)<\/Feature>/g)].map((m) => m[1].trim());
    if (caracteristicas.length) d.caracteristicas = caracteristicas;
    if (Object.keys(d).length) dados[codigo] = d;
  }
  return dados;
}
