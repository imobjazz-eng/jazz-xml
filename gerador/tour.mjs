/**
 * Tour virtual feito com as fotos do próprio anúncio, publicado no mesmo
 * GitHub Pages do XML (tour/index.html + tour/d/<código>.json).
 *
 * Regras do Grupo ZAP para o <VirtualTourLink>: a página tem só o tour,
 * o link não é encurtado e é HTTPS com certificado válido. Anúncio que já
 * tem tour (vindo do Vista) fica com o dele; o nosso só entra onde não há.
 */

export const TOUR_BASE = "https://imobjazz-eng.github.io/jazz-xml/tour/";
export const TOUR_MIN_FOTOS = 7;

const ESCAPES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };
const desescapar = (t) => t.replace(/&(amp|lt|gt|quot|apos);/g, (e) => ESCAPES[e]);

/** Código seguro para virar nome de arquivo e parâmetro de URL. */
export function codigoDoTour(codigo) {
  const c = String(codigo ?? "").trim();
  return /^[A-Za-z0-9_-]{1,40}$/.test(c) ? c : null;
}

/** Fotos do anúncio na ordem do XML, com a principal primeiro. */
export function fotosDoAnuncio(bloco) {
  const fotos = [];
  for (const m of bloco.matchAll(/<Item\b([^>]*)>([^<]+)<\/Item>/g)) {
    const attrs = m[1];
    if (!/medium="image"/.test(attrs)) continue;
    const url = desescapar(m[2].trim());
    if (!/^https:\/\//.test(url)) continue;
    const legenda = desescapar((attrs.match(/caption="([^"]*)"/) || [, ""])[1]).trim();
    const foto = { u: url };
    if (legenda) foto.l = legenda.slice(0, 80);
    if (/primary="true"/.test(attrs)) fotos.unshift(foto);
    else fotos.push(foto);
  }
  // Sem repetição (o Vista às vezes repete a capa no meio).
  const vistas = new Set();
  return fotos.filter((f) => !vistas.has(f.u) && vistas.add(f.u));
}

export function linkDoTour(codigo, base = TOUR_BASE) {
  return `${base}?c=${encodeURIComponent(codigo)}`;
}

/** Põe o <VirtualTourLink> logo depois do <Title>, como o Vista faz. */
export function inserirTour(bloco, url) {
  if (/<VirtualTourLink>/.test(bloco)) return bloco;
  const comTitulo = bloco.replace(/(\n([ \t]*)<Title>[\s\S]*?<\/Title>)/, (m, _t, ind) => `${m}\n${ind}<VirtualTourLink><![CDATA[${url}]]></VirtualTourLink>`);
  if (comTitulo !== bloco) return comTitulo;
  return bloco.replace(/(\n([ \t]*))<Media>/, (m, quebra) => `${quebra}<VirtualTourLink><![CDATA[${url}]]></VirtualTourLink>${quebra}<Media>`);
}

/** Dados que a página do tour lê: só fotos e legenda, nada de contato. */
export function dadosDoTour(bloco, minFotos = TOUR_MIN_FOTOS) {
  const fotos = fotosDoAnuncio(bloco);
  if (fotos.length < minFotos) return null;
  return { v: 1, fotos };
}
