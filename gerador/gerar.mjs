/**
 * Gera o feed VRSync dos portais e grava em disco.
 *
 * Uso:  VISTA_API_KEY=... node gerador/gerar.mjs site/vrsync.xml
 *
 * Variáveis:
 *   VISTA_API_KEY   chave da API do Vista (para conferir quem está ativo)
 *   VISTA_API_URL   padrão https://rafaelak-rest.vistahost.com.br
 *   VISTA_XML_URL   padrão: o XML de portais do Vista (ver vista.mjs)
 *   FEED_MINIMO     piso de anúncios para aceitar o arquivo (padrão 1000)
 *   FEED_MIN_FOTOS  mínimo de fotos por anúncio (padrão 7)
 *   FEED_MAXIMO     teto de anúncios (padrão 3000)
 *   GEOCODE_CACHE   cache de geocodificação da execução anterior (JSON);
 *                   o atualizado é gravado como geocode.json ao lado do XML
 *   GEO_LIMITE      endereços novos consultados por execução (padrão 200)
 *   GEO_INTERVALO_MS pausa entre consultas ao Nominatim (padrão 1100)
 *   VIDEOS_URL      lista "código → link do YouTube" publicada pelo
 *                   repositório de vídeos (padrão: imobjazz-eng/jazz-videos)
 *
 * Se qualquer trava disparar, sai com erro e NÃO grava nada: o arquivo
 * anterior continua no ar.
 */
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { gerarFeed } from "./vista.mjs";
import { enriquecerFeed, enderecosSemCoordenada, planilhaPendencias } from "./enriquecer.mjs";
import { geocodificar, consultaCache } from "./geocodificar.mjs";

const destino = process.argv[2] || "saida/vrsync.xml";
const VIDEOS_URL = "https://raw.githubusercontent.com/imobjazz-eng/jazz-videos/main/videos.json";

/**
 * Links de vídeo por código. Vêm de outro repositório (jazz-videos), que
 * gera os vídeos e cuida do YouTube; aqui só se lê a lista pronta.
 * Qualquer falha devolve lista vazia: vídeo nunca segura o feed.
 */
async function carregarVideos(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const lista = await r.json();
    if (!lista || typeof lista !== "object" || Array.isArray(lista)) throw new Error("formato inesperado");
    return new Map(Object.entries(lista).filter(([, v]) => typeof v === "string"));
  } catch (e) {
    console.log(`Lista de vídeos indisponível (${e.message}): feed segue sem vídeos novos.`);
    return new Map();
  }
}

const numero = (v, padrao) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : padrao);

try {
  const r = await gerarFeed({
    chave: process.env.VISTA_API_KEY,
    base: process.env.VISTA_API_URL,
    urlXml: process.env.VISTA_XML_URL || undefined,
    minimo: numero(process.env.FEED_MINIMO, 1000),
    minFotos: numero(process.env.FEED_MIN_FOTOS, 7),
    maximo: numero(process.env.FEED_MAXIMO, 3000),
  });
  console.log(`XML do Vista: ${r.noArquivo} anúncios. API do Vista: ${r.ativosNaApi ?? "indisponível"} códigos ativos.`);
  console.log(`Publicados: ${r.publicados}. Fora do feed:`, r.excluidos);
  for (const a of r.avisos) console.log(`::warning::${a}`);

  // Geocodificação: erro aqui nunca impede a publicação.
  let cache = {};
  if (process.env.GEOCODE_CACHE) {
    try {
      cache = JSON.parse(await readFile(process.env.GEOCODE_CACHE, "utf8"));
    } catch {
      console.log("Cache de geocodificação ausente ou ilegível: começando vazio.");
    }
  }
  const geo = await geocodificar(enderecosSemCoordenada(r.xml), cache, {
    limite: numero(process.env.GEO_LIMITE, 200),
    intervaloMs: numero(process.env.GEO_INTERVALO_MS, 1100),
  });
  console.log(`Geocodificação: ${geo.pendentes} endereços pendentes, ${geo.consultados} consultados, ${geo.achados} achados.`, geo.falhas);
  if (geo.erro) console.log(`::warning::Geocodificação interrompida: ${geo.erro}`);

  // Enriquecimento com defeito não derruba o feed: publica o XML sem ele.
  let e;
  try {
    const videos = await carregarVideos(process.env.VIDEOS_URL || VIDEOS_URL);
    if (videos.size) console.log(`Lista de vídeos: ${videos.size} links.`);
    e = enriquecerFeed(r.xml, { coordenadaDe: consultaCache(cache), videoDe: (c) => videos.get(c) ?? null });
    console.log("Enriquecimento (anúncios alterados):", e.resumo);
  } catch (err) {
    console.log(`::warning::Enriquecimento falhou, publicando sem ele: ${err.message}`);
    e = { xml: r.xml };
  }

  await mkdir(dirname(destino), { recursive: true });
  await writeFile(destino, e.xml);
  await writeFile(join(dirname(destino), "geocode.json"), JSON.stringify(cache));
  try {
    await writeFile(join(dirname(destino), "pendencias.csv"), planilhaPendencias(e.xml));
  } catch (err) {
    console.log(`::warning::Planilha de pendências não gerada: ${err.message}`);
  }
  console.log(`Gravado ${destino} (${(Buffer.byteLength(e.xml) / 1048576).toFixed(1)} MB).`);
} catch (e) {
  console.error(`ERRO: ${e.message}`);
  process.exit(1);
}
