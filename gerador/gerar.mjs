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
 *   ARREDORES_CACHE pontos de interesse da execução anterior (JSON); o
 *                   atualizado é gravado como arredores.json ao lado do XML
 *   ARREDORES_LIMITE quadras novas consultadas no Overpass por execução
 *                   (padrão 20; "0" não consulta, só usa o cache)
 *   VIDEOS_URL      lista "código → link do YouTube" publicada pelo
 *                   repositório de vídeos (padrão: imobjazz-eng/jazz-videos)
 *   ANTIGO_CACHE    dados do XML anterior (antigo.json do gh-pages); sem ele,
 *                   baixa ANTIGO_URL (padrão: Worker congelado) e extrai.
 *                   O resultado é gravado como antigo.json ao lado do XML
 *   VIDEO_PADRAO    vídeo do YouTube que entra em todo anúncio sem vídeo
 *                   próprio (do Vista ou da lista); "desligado" tira
 *   TOURS360_DIR    pasta das fotos 360 enviadas pelo GitHub
 *                   (padrão tours360/ do repositório; ver tour360.mjs)
 *   TOURS360_API    banco das fotos 360 enviadas pelo celular
 *                   (tour360/enviar.html); "desligado" não consulta
 *   TOURS360_CACHE  tour360/ da publicação anterior (fotos já baixadas)
 *
 * Se qualquer trava disparar, sai com erro e NÃO grava nada: o arquivo
 * anterior continua no ar.
 */
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gerarFeed } from "./vista.mjs";
import { enriquecerFeed, enderecosSemCoordenada, planilhaPendencias, linkYoutubeValido, notaEstimada, errosObrigatorios } from "./enriquecer.mjs";
import { TOUR_BASE, TOUR_MIN_FOTOS, codigoDoTour, dadosDoTour, linkDoTour } from "./tour.mjs";
import { TOUR360_BASE, lerTours360, linkDoTour360, publicarTours360, carregarToursRemotos } from "./tour360.mjs";
import { geocodificar, consultaCache } from "./geocodificar.mjs";
import { buscarArredores, arredoresDoCache } from "./arredores.mjs";
import { ANTIGO_URL, extrairAntigo } from "./antigo.mjs";
import { paraChavesNaMao } from "./chavesnamao.mjs";
import { paraImovelWeb } from "./imovelweb.mjs";
import { montarSaude } from "./saude.mjs";

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
    prioridade: (codigo, bloco, enderecos) => {
      const extra = { ...antigo[codigo], ...enderecos.get(codigo) };
      return errosObrigatorios(bloco, extra).length ? -1 : notaEstimada(bloco, { numero: !!extra.numero });
    },
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
  // Painel de saúde (saude.json → saude.html): avisos desta execução.
  const avisos = [...r.avisos];
  const aviso = (a) => { avisos.push(a); console.log(`::warning::${a}`); };
  let enriquecimentoOk = true, tours360Ok = true, totalChavesNaMao = null, imovelWeb = null;

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
  if (geo.erro) aviso(`Geocodificação interrompida: ${geo.erro}`);

  let arredores = {};
  if (process.env.ARREDORES_CACHE) {
    try {
      arredores = JSON.parse(await readFile(process.env.ARREDORES_CACHE, "utf8"));
    } catch {
      console.log("Cache de arredores ausente ou ilegível: começando vazio.");
    }
  }

  // Enriquecimento com defeito não derruba o feed: publica o XML sem ele.
  let e;
  const tours = new Map();
  // Tours 360 enviados pelos corretores (tours360/<código>/): têm preferência
  // sobre o tour de fotos comuns. Falha aqui nunca segura o feed.
  let tours360 = new Map();
  try {
    const lidos = await lerTours360(process.env.TOURS360_DIR || fileURLToPath(new URL("../tours360", import.meta.url)));
    tours360 = lidos.tours;
    for (const a of lidos.avisos) aviso(a);
    // Enviados pelo celular têm preferência sobre a pasta do repositório.
    if (process.env.TOURS360_API !== "desligado") {
      try {
        const remotos = await carregarToursRemotos(process.env.TOURS360_API || undefined);
        for (const [c, t] of remotos) tours360.set(c, t);
        console.log(`Tour 360 enviados pelo celular: ${remotos.size} imóveis.`);
      } catch (err) {
        tours360Ok = false;
        aviso(`Lista de tours 360 do celular indisponível: ${err.message}`);
      }
    }
    if (tours360.size) console.log(`Tour 360: ${tours360.size} imóveis com fotos 360.`);
  } catch (err) {
    console.log(`::warning::Tours 360 não lidos: ${err.message}`);
  }
  const usados360 = new Map();
  try {
    const videos = await carregarVideos(process.env.VIDEOS_URL || VIDEOS_URL);
    if (videos.size) console.log(`Lista de vídeos: ${videos.size} links.`);
    // Tour virtual (TOUR_BASE=desligado tira): os dados de cada tour são
    // gravados abaixo, na mesma publicação, então todo link aponta para
    // um arquivo que existe.
    const baseTour = process.env.TOUR_BASE || TOUR_BASE;
    const minFotosTour = numero(process.env.TOUR_MIN_FOTOS, TOUR_MIN_FOTOS);
    const base360 = process.env.TOUR360_BASE || TOUR360_BASE;
    const tourDe = baseTour === "desligado" ? () => null : (codigo, bloco) => {
      const c = codigoDoTour(codigo);
      if (c && tours360.has(c)) {
        usados360.set(c, tours360.get(c));
        return linkDoTour360(c, base360);
      }
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
    // Dados da API do Vista (número, complemento, área, banheiros, ano, IPTU,
    // bairro, CEP, coordenada) primeiro; o XML anterior completa o resto.
    console.log(`Dados pela API do Vista: ${r.enderecos?.size ?? 0} imóveis.`);
    const antigoDe = (c) => {
      const api = r.enderecos?.get(c);
      return antigo[c] || api ? { ...antigo[c], ...api } : null;
    };
    const opcoes = { coordenadaDe: consultaCache(cache), videoDe, tourDe, antigoDe };
    e = enriquecerFeed(r.xml, opcoes);
    // Pontos de interesse perto do imóvel (arredores.mjs): precisam da
    // coordenada final de cada anúncio, que só existe depois da primeira
    // passada; com eles, a descrição é refeita. Falha aqui fica no aviso.
    try {
      const coordenadas = new Map();
      for (const [, bloco] of e.xml.matchAll(/<Listing>([\s\S]*?)<\/Listing>/g)) {
        const codigo = (bloco.match(/<ListingID>([^<]+)<\/ListingID>/) || [])[1];
        const lat = Number((bloco.match(/<Latitude>([^<]+)<\/Latitude>/) || [])[1]);
        const lon = Number((bloco.match(/<Longitude>([^<]+)<\/Longitude>/) || [])[1]);
        if (codigo && Number.isFinite(lat) && Number.isFinite(lon) && lat && lon) coordenadas.set(codigo.trim(), { lat, lon });
      }
      const ar = await buscarArredores([...coordenadas.values()], arredores, {
        limite: numero(process.env.ARREDORES_LIMITE, 20),
        intervaloMs: numero(process.env.ARREDORES_INTERVALO_MS, 4000),
      });
      console.log(`Arredores: ${ar.pendentes} quadras pendentes, ${ar.consultados} consultadas, ${ar.comLugares} com lugares.`);
      if (ar.erro) aviso(`Arredores interrompidos: ${ar.erro}`);
      const doCache = arredoresDoCache(arredores);
      const arredoresDe = (c) => {
        const p = coordenadas.get(c);
        return p ? doCache(p.lat, p.lon) : null;
      };
      e = enriquecerFeed(r.xml, { ...opcoes, arredoresDe });
    } catch (err) {
      aviso(`Arredores não aplicados: ${err.message}`);
    }
    console.log("Enriquecimento (anúncios alterados):", e.resumo);
  } catch (err) {
    enriquecimentoOk = false;
    aviso(`Enriquecimento falhou, publicando sem ele: ${err.message}`);
    e = { xml: r.xml };
    tours.clear();
    usados360.clear();
  }

  await mkdir(dirname(destino), { recursive: true });
  await writeFile(destino, e.xml);
  await writeFile(join(dirname(destino), "geocode.json"), JSON.stringify(cache));
  await writeFile(join(dirname(destino), "arredores.json"), JSON.stringify(arredores));
  if (Object.keys(antigo).length) await writeFile(join(dirname(destino), "antigo.json"), JSON.stringify(antigo));
  if (tours.size) {
    const pasta = join(dirname(destino), "tour", "d");
    await mkdir(pasta, { recursive: true });
    for (const [c, d] of tours) await writeFile(join(pasta, `${c}.json`), JSON.stringify(d));
    console.log(`Tour virtual: ${tours.size} anúncios com dados gravados.`);
  }
  if (usados360.size) {
    try {
      const falhas = await publicarTours360(usados360, dirname(destino), { cache: process.env.TOURS360_CACHE || null });
      for (const f of falhas) aviso(`Tour 360 não publicado: ${f}`);
    } catch (err) {
      console.log(`::warning::Fotos do tour 360 não publicadas: ${err.message}`);
    }
    console.log(`Tour 360: ${usados360.size} anúncios com tour 360 publicado.`);
  }
  // Chaves na Mão: mesmo XML enriquecido, no formato do portal. Falha aqui
  // não segura o XML do Grupo ZAP.
  try {
    const cnm = paraChavesNaMao(e.xml);
    await writeFile(join(dirname(destino), "chavesnamao.xml"), cnm.xml);
    totalChavesNaMao = cnm.total;
    console.log(`Chaves na Mão: ${cnm.total} imóveis em chavesnamao.xml.`);
  } catch (err) {
    aviso(`XML do Chaves na Mão não gerado: ${err.message}`);
  }
  // ImovelWeb (OpenNavent): idem. Sem o código da imobiliária no portal
  // (IMOVELWEB_CODIGO), o arquivo sai, mas o portal não aceita a carga.
  try {
    const codigo = process.env.IMOVELWEB_CODIGO || "";
    const iw = paraImovelWeb(e.xml, { codigoImobiliaria: codigo });
    await writeFile(join(dirname(destino), "imovelweb.xml"), iw.xml);
    imovelWeb = { total: iw.total, fora: iw.fora, temCodigo: !!codigo };
    console.log(`ImovelWeb: ${iw.total} imóveis em imovelweb.xml (${iw.fora} sem campo obrigatório do portal).`);
    if (!codigo) console.log("ImovelWeb: falta IMOVELWEB_CODIGO (código da Jazz no portal).");
  } catch (err) {
    aviso(`XML do ImovelWeb não gerado: ${err.message}`);
  }
  try {
    await writeFile(join(dirname(destino), "pendencias.csv"), planilhaPendencias(e.xml));
  } catch (err) {
    console.log(`::warning::Planilha de pendências não gerada: ${err.message}`);
  }
  try {
    const saude = montarSaude(e.xml, {
      noArquivo: r.noArquivo, ativosNaApi: r.ativosNaApi, excluidos: r.excluidos, avisos, geoErro: geo.erro || "",
      enriquecimentoOk, tours360Ok, chavesNaMao: totalChavesNaMao, imovelWeb, commit: (process.env.GITHUB_SHA || "").slice(0, 7),
      minimo: numero(process.env.FEED_MINIMO, 1000), maximo: numero(process.env.FEED_MAXIMO, 3000),
    });
    await writeFile(join(dirname(destino), "saude.json"), JSON.stringify(saude, null, 1));
    console.log(`Saúde: ${saude.geral} (${saude.etapas.map((x) => `${x.id}=${x.status}`).join(", ")}).`);
  } catch (err) {
    console.log(`::warning::saude.json não gerado: ${err.message}`);
  }
  console.log(`Gravado ${destino} (${(Buffer.byteLength(e.xml) / 1048576).toFixed(1)} MB).`);
} catch (e) {
  console.error(`ERRO: ${e.message}`);
  process.exit(1);
}
