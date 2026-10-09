/**
 * Baixa TODO o acervo da API do Vista e grava o VRSync em disco.
 *
 * Uso:  VISTA_API_KEY=... node gerador/gerar.mjs saida/vrsync.xml
 *
 * Variáveis:
 *   VISTA_API_KEY        obrigatória
 *   VISTA_API_URL        padrão https://rafaelak-rest.vistahost.com.br
 *   PUBLIC_FEED_CONTACT_NAME / PUBLIC_FEED_CONTACT_PHONE   opcionais
 *   FEED_MINIMO          piso de anúncios para aceitar o arquivo (padrão 1000)
 *
 * As travas contra feed truncado estão em `vista.mjs`: se elas dispararem,
 * o script sai com erro e NÃO grava nada.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { gerarXml } from "./vista.mjs";

const destino = process.argv[2] || "saida/vrsync.xml";

if (!process.env.VISTA_API_KEY) {
  console.error("ERRO: VISTA_API_KEY não informada. Cadastre em Settings → Secrets and variables → Actions.");
  process.exit(1);
}

try {
  const r = await gerarXml({
    chave: process.env.VISTA_API_KEY,
    base: process.env.VISTA_API_URL,
    minimo: Number(process.env.FEED_MINIMO || 1000),
    contato: {
      nome: process.env.PUBLIC_FEED_CONTACT_NAME,
      telefone: process.env.PUBLIC_FEED_CONTACT_PHONE,
    },
  });
  console.log(`Vista: ${r.total} imóveis declarados, ${r.recebidos} recebidos em ${r.paginas} páginas.`);
  console.log(`Publicados: ${r.publicados}. Fora do feed:`, r.excluidos);
  await mkdir(dirname(destino), { recursive: true });
  await writeFile(destino, r.xml);
  console.log(`Gravado ${destino} (${(Buffer.byteLength(r.xml) / 1048576).toFixed(1)} MB).`);
} catch (e) {
  console.error(`ERRO: ${e.message}`);
  process.exit(1);
}
