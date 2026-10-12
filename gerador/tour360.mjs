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

export const linkDoTour360 = (codigo, base = TOUR360_BASE) => `${base}?c=${encodeURIComponent(codigo)}`;

/** Dados que a página lê: só nome e arquivo de cada cômodo. */
export const dadosDoTour360 = (tour) => ({ v: 1, cenas: tour.cenas.map((c) => ({ f: c.arquivo, n: c.nome })) });

/**
 * Publica as fotos em <site>/tour360/f/<código>/ (reduzidas pelo ffmpeg; sem
 * ffmpeg, copiadas como vieram) e os dados em <site>/tour360/d/<código>.json.
 */
export async function publicarTours360(tours, site, { largura = TOUR360_LARGURA } = {}) {
  const { writeFile } = await import("node:fs/promises");
  for (const [c, t] of tours) {
    const fotos = join(site, "tour360", "f", c);
    await mkdir(fotos, { recursive: true });
    for (const cena of t.cenas) {
      const destino = join(fotos, cena.arquivo);
      try {
        await roda("ffmpeg", ["-v", "error", "-y", "-i", cena.origem, "-vf", `scale='min(${largura},iw)':-2`, "-q:v", "3", destino]);
      } catch {
        await copyFile(cena.origem, destino);
      }
    }
    await mkdir(join(site, "tour360", "d"), { recursive: true });
    await writeFile(join(site, "tour360", "d", `${c}.json`), JSON.stringify(dadosDoTour360(t)));
  }
}
