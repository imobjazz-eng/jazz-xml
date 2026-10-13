/**
 * Tour 360° de verdade, montado sozinho a partir das fotos 360 que o
 * corretor sobe em tours360/<código do imóvel>/ (ver tours360/README.md).
 *
 * A cada geração do XML: as fotos válidas (JPEG equirretangular, 2:1) são
 * reduzidas para no máximo 4096 px de largura (limite seguro de textura no
 * celular), publicadas em tour360/f/<código>/ e listadas em
 * tour360/d/<código>.json; a página tour360/index.html (Pannellum) mostra os
 * cômodos em sequência. O anúncio ganha o <VirtualTourLink> sozinho.
 *
 * Tour 360 tem preferência sobre o tour de fotos comuns (tour.mjs), que o
 * portal não conta. Tour que já vem do Vista continua com preferência.
 */
import { readdir, readFile, mkdir, copyFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { codigoDoTour } from "./tour.mjs";

export const TOUR360_BASE = "https://imobjazz-eng.github.io/jazz-xml/tour360/";
export const TOUR360_LARGURA = 4096;
const roda = promisify(execFile);

/** Largura e altura de um JPEG (lê o cabeçalho SOF); null se não for JPEG. */
export function tamanhoJpeg(buf) {
  if (!buf || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m === 0xff) { i++; continue; }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    const tam = buf.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { altura: buf.readUInt16BE(i + 5), largura: buf.readUInt16BE(i + 7) };
    }
    i += 2 + tam;
  }
  return null;
}

/** Foto 360 completa: proporção 2:1 (tolerância de 3%). */
export const eh360 = (t) => !!t && t.altura > 0 && Math.abs(t.largura / t.altura - 2) <= 0.06;

/** "2-sala_de_estar.jpg" → "Sala de estar". */
export function nomeDoComodo(arquivo, n) {
  const base = arquivo.replace(/\.[^.]+$/, "").replace(/^\d+\s*[-_. ]*\s*/, "").replace(/[-_]+/g, " ").trim();
  return base ? (base[0].toUpperCase() + base.slice(1)).slice(0, 40) : `Ambiente ${n}`;
}

const ordem = (a, b) => a.localeCompare(b, "pt-BR", { numeric: true, sensitivity: "base" });

/**
 * Lê tours360/: Map código → {cenas: [{origem, arquivo, nome}]} só com fotos
 * 360 válidas, e a lista de avisos (foto que não é 360, código inválido).
 */
export async function lerTours360(pasta) {
  const tours = new Map();
  const avisos = [];
  let codigos = [];
  try {
    codigos = (await readdir(pasta, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return { tours, avisos };
  }
  for (const nome of codigos.sort(ordem)) {
    const c = codigoDoTour(nome);
    if (!c) { avisos.push(`tours360/${nome}: nome de pasta não é um código de imóvel`); continue; }
    const arquivos = (await readdir(join(pasta, nome))).filter((a) => /\.jpe?g$/i.test(a)).sort(ordem);
    const cenas = [];
    for (const a of arquivos) {
      const t = tamanhoJpeg(await readFile(join(pasta, nome, a)));
      if (!eh360(t)) {
        avisos.push(`tours360/${nome}/${a}: não é foto 360 (precisa ser 2:1; veio ${t ? `${t.largura}x${t.altura}` : "ilegível"})`);
        continue;
      }
      cenas.push({ origem: join(pasta, nome, a), arquivo: `${cenas.length + 1}.jpg`, nome: nomeDoComodo(a, cenas.length + 1) });
    }
    if (cenas.length) tours.set(c, { cenas });
  }
  return { tours, avisos };
}

export const linkDoTour360 = (codigo, base = TOUR360_BASE) => `${base}${encodeURIComponent(codigo)}/`;

/** Dados que a página lê: arquivo, nome e, se marcada, a porta do próximo ambiente. */
export const dadosDoTour360 = (tour) => ({
  v: 2,
  cenas: tour.cenas.map((c) => ({ f: c.arquivo, n: c.nome, ...(c.porta ? { p: c.porta } : {}), ...(c.chave ? { o: c.chave } : {}) })),
});

// Envio pelo celular (tour360/enviar.html → função tour360 da Supabase): a
// lista pública de tours vem da tours360_lista(); a chave é a publicável
// (anon), a mesma que as páginas usam.
export const TOURS360_API = "https://wqxcevqphhkjfcnkeiwp.supabase.co";
export const TOURS360_CHAVE =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndxeGNldnFwaGhramZjbmtlaXdwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1NTcxNTcsImV4cCI6MjEwNzEzMzE1N30.03YuuE29Z4H_izzYY8HlObmITULVGvdXmlDQG0PvTrI";

/** Tours enviados pelo celular: Map código → {cenas: [{url, chave, arquivo, nome, porta}]}. */
export function toursDaLista(lista, api = TOURS360_API) {
  const tours = new Map();
  for (const [imovel, t] of Object.entries(lista || {})) {
    const c = codigoDoTour(imovel);
    const cenas = Array.isArray(t?.cenas) ? t.cenas : [];
    const validas = cenas.filter((x) => typeof x?.caminho === "string" && x.caminho.startsWith(`${imovel}/`) && /^[\w/.-]+\.jpg$/.test(x.caminho));
    if (!c || !validas.length) continue;
    tours.set(c, {
      cenas: validas.map((x, i) => ({
        url: `${api}/storage/v1/object/public/tours360/${x.caminho}`,
        chave: x.caminho,
        arquivo: `${i + 1}.jpg`,
        nome: String(x.nome || `Ambiente ${i + 1}`).slice(0, 40),
        ...(Number.isFinite(x.porta?.yaw) ? { porta: { yaw: x.porta.yaw, pitch: Number.isFinite(x.porta.pitch) ? x.porta.pitch : 0 } } : {}),
      })),
    });
  }
  return tours;
}

export async function carregarToursRemotos(api = TOURS360_API, chave = TOURS360_CHAVE) {
  const r = await fetch(`${api}/rest/v1/rpc/tours360_lista`, {
    method: "POST",
    headers: { apikey: chave, Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return toursDaLista(await r.json(), api);
}

/**
 * Publica as fotos em <site>/tour360/f/<código>/ (reduzidas pelo ffmpeg; sem
 * ffmpeg, copiadas como vieram) e os dados em <site>/tour360/d/<código>.json.
 * Foto enviada pelo celular que já estava publicada (mesma chave, no cache
 * recuperado do gh-pages) é copiada do cache, sem baixar de novo.
 */
export async function publicarTours360(tours, site, { largura = TOUR360_LARGURA, cache = null, baixar = fetch } = {}) {
  const { writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const falhas = [];
  for (const [c, t] of tours) {
    try {
      await publicarUm(c, t);
    } catch (err) {
      falhas.push(`${c}: ${err.message}`);
    }
  }
  return falhas;

  async function publicarUm(c, t) {
    const fotos = join(site, "tour360", "f", c);
    await mkdir(fotos, { recursive: true });
    let anterior = [];
    if (cache) {
      try { anterior = JSON.parse(await readFile(join(cache, "d", `${c}.json`), "utf8")).cenas || []; } catch {}
    }
    for (const cena of t.cenas) {
      const destino = join(fotos, cena.arquivo);
      const velha = cena.chave && anterior.find((a) => a.o === cena.chave);
      if (velha) {
        try { await copyFile(join(cache, "f", c, velha.f), destino); continue; } catch {}
      }
      let origem = cena.origem;
      if (!origem) {
        const r = await baixar(cena.url, { signal: AbortSignal.timeout(60_000) });
        if (!r.ok) throw new Error(`foto ${cena.chave}: HTTP ${r.status}`);
        origem = join(tmpdir(), `t360-${process.pid}-${c}-${cena.arquivo}`);
        await writeFile(origem, Buffer.from(await r.arrayBuffer()));
      }
      try {
        await roda("ffmpeg", ["-v", "error", "-y", "-i", origem, "-vf", `scale='min(${largura},iw)':-2`, "-q:v", "3", destino]);
      } catch {
        await copyFile(origem, destino);
      }
    }
    await mkdir(join(site, "tour360", "d"), { recursive: true });
    await writeFile(join(site, "tour360", "d", `${c}.json`), JSON.stringify(dadosDoTour360(t)));
  }
}
