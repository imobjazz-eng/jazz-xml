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
 *   ANTIGO_CACHE    dados do XML anterior (antigo.json do gh-pages); sem ele,
 *                   baixa ANTIGO_URL (padrão: Worker congelado) e extrai.
 *                   O resultado é gravado como antigo.json ao lado do XML
 *   VIDEO_PADRAO    vídeo do YouTube que entra em todo anúncio sem vídeo
 *                   próprio (do Vista ou da lista); "desligado" tira
 *
 * Se qualquer trava disparar, sai com erro e NÃO grava nada: o arquivo
 * anterior continua no ar.
 */
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { gerarFeed } from "./vista.mjs";
import { enriquecerFeed, enderecosSemCoordenada, planilhaPendencias, linkYoutubeValido, notaEstimada, errosObrigatorios } from "./enriquecer.mjs";
import { TOUR_BASE, TOUR_MIN_FOTOS, codigoDoTour, dadosDoTour, linkDoTour } from "./tour.mjs";
import { geocodificar, consultaCache } from "./geocodificar.mjs";
import { ANTIGO_URL, extrairAntigo } from "./antigo.mjs";

const destino = process.argv[2] || "saida/vrsync.xml";
const VIDEOS_URL = "https://raw.githubusercontent.com/imobjazz-eng/jazz-videos/main/videos.json";
// Vídeo institucional da Jazz: todo anúncio, atual ou novo, sai com vídeo.
// Vídeo do próprio imóvel (Vista ou jazz-videos) tem preferência.
const VIDEO_PADRAO = "https://www.youtube.com/watch?v=DlYDTuoHf3k";

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

/**
 * Dados do XML anterior: a cópia guardada no gh-pages ou, na primeira vez,
 * extraídos do Worker congelado. Falha devolve vazio: nunca segura o feed.
 */
async function carregarAntigo(arquivo, url) {
  let guardado = {};
  if (arquivo) {
    try {
      const d = JSON.parse(await readFile(arquivo, "utf8"));
      // Cópia de antes de o bairro entrar na extração: extrai de novo se der.
      const temBairro = Object.values(d).some((e) => e && e.bairro);
      if (d && typeof d === "object" && Object.keys(d).length && temBairro) return d;
      if (d && typeof d === "object" && Object.keys(d).length) guardado = d;
    } catch {}
  }
  if (url === "desligado") return guardado;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = extrairAntigo(await r.text());
    return Object.keys(d).length ? d : guardado;
  } catch (e) {
    console.log(`XML anterior indisponível (${e.message}): segue com a cópia guardada.`);
    return guardado;
  }
}

const numero = (v, padrao) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : padrao);

try {
  // Dados do XML anterior antes da seleção: o número do endereço entra na
  // nota estimada que escolhe os 3000 anúncios.
  const antigo = await carregarAntigo(process.env.ANTIGO_CACHE, process.env.ANTIGO_URL || ANTIGO_URL);
  console.log(`XML anterior: ${Object.keys(antigo).length} anúncios com dados.`);
  const r = await gerarFeed({
    // Anúncio que o portal recusaria (obrigatório faltando) vai para o fim
    // da fila: no teto de 3000, entra no lugar dele um que o portal aceita.
    prioridade: (codigo, bloco, enderecos) =>
      errosObrigatorios(bloco, antigo[codigo] || {}).length ? -1 : notaEstimada(bloco, { numero: !!(enderecos.get(codigo)?.numero || antigo[codigo]?.numero) }),
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
  const tours = new Map();
  try {
    const videos = await carregarVideos(process.env.VIDEOS_URL || VIDEOS_URL);
    if (videos.size) console.log(`Lista de vídeos: ${videos.size} links.`);
    // Tour virtual (TOUR_BASE=desligado tira): os dados de cada tour são
    // gravados abaixo, na mesma publicação, então todo link aponta para
    // um arquivo que existe.
    const baseTour = process.env.TOUR_BASE || TOUR_BASE;
    const minFotosTour = numero(process.env.TOUR_MIN_FOTOS, TOUR_MIN_FOTOS);
    const tourDe = baseTour === "desligado" ? () => null : (codigo, bloco) => {
      const c = codigoDoTour(codigo);
      const d = c && dadosDoTour(bloco, minFotosTour);
      if (!d) return null;
      tours.set(c, d);
      return linkDoTour(c, baseTour);
    };
    const padrao = process.env.VIDEO_PADRAO || VIDEO_PADRAO;
    const videoPadrao = padrao === "desligado" ? null : padrao;
    if (videoPadrao) console.log(`Vídeo padrão para anúncio sem vídeo: ${videoPadrao}`);
    const videoDe = (c) => {
      const v = videos.get(c);
      return v && linkYoutubeValido(v) ? v : videoPadrao;
    };
    // Número e complemento: a API do Vista primeiro, o XML anterior depois.
    console.log(`Endereços pela API do Vista: ${r.enderecos?.size ?? 0} com número ou complemento.`);
    const antigoDe = (c) => {
      const api = r.enderecos?.get(c);
      return antigo[c] || api ? { ...antigo[c], ...api } : null;
    };
    e = enriquecerFeed(r.xml, { coordenadaDe: consultaCache(cache), videoDe, tourDe, antigoDe });
    console.log("Enriquecimento (anúncios alterados):", e.resumo);
  } catch (err) {
    console.log(`::warning::Enriquecimento falhou, publicando sem ele: ${err.message}`);
    e = { xml: r.xml };
    tours.clear();
  }

  await mkdir(dirname(destino), { recursive: true });
  await writeFile(destino, e.xml);
  await writeFile(join(dirname(destino), "geocode.json"), JSON.stringify(cache));
  if (Object.keys(antigo).length) await writeFile(join(dirname(destino), "antigo.json"), JSON.stringify(antigo));
  if (tours.size) {
    const pasta = join(dirname(destino), "tour", "d");
    await mkdir(pasta, { recursive: true });
    for (const [c, d] of tours) await writeFile(join(pasta, `${c}.json`), JSON.stringify(d));
    console.log(`Tour virtual: ${tours.size} anúncios com dados gravados.`);
  }
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
