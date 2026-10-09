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
 *
 * Se qualquer trava disparar, sai com erro e NÃO grava nada: o arquivo
 * anterior continua no ar.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { gerarFeed } from "./vista.mjs";

const destino = process.argv[2] || "saida/vrsync.xml";
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
  await mkdir(dirname(destino), { recursive: true });
  await writeFile(destino, r.xml);
  console.log(`Gravado ${destino} (${(Buffer.byteLength(r.xml) / 1048576).toFixed(1)} MB).`);
} catch (e) {
  console.error(`ERRO: ${e.message}`);
  process.exit(1);
}
