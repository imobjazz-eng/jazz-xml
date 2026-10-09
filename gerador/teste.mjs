/**
 * Testes do gerador — sem rede. O formato do XML de exemplo copia o que o
 * Vista exporta (conferido no arquivo real em 09/10/2026).
 *
 * Rodar: node gerador/teste.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ajustar, separar } from "./espelho.mjs";

const aqui = dirname(fileURLToPath(import.meta.url));
let falhas = 0, total = 0;
const ok = (nome, cond, det = "") => {
  total++;
  console.log((cond ? "  ok  " : " FALHA") + "  " + nome + (cond ? "" : "  -> " + det));
  if (!cond) falhas++;
};

function listing(codigo, fotos) {
  const itens = Array.from({ length: fotos }, (_, i) =>
    `        <Item medium="image" caption="">https://cdn.vistahost.com.br/f/${codigo}_${i}.jpg</Item>`).join("\n");
  return `<Listing>
      <ListingID>${codigo}</ListingID>
      <Details>
        <Description><![CDATA[Casa & quintal <ótima>]]></Description>
        <ListPrice currency="BRL">500000</ListPrice>
      </Details>
      <Location displayAddress="Neighborhood"><City><![CDATA[Atibaia]]></City></Location>
      <Media>
${itens}
      </Media>
      <TransactionType>For Sale</TransactionType>
    </Listing>`;
}

function feed(lista) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ListingDataFeed xmlns="http://www.vivareal.com/schemas/1.0/VRSync">
  <Listings>
    <Header>
      <Provider>Vista</Provider>
      <PublishDate>2026-10-09T07:32:14</PublishDate>
    </Header>
    ${lista.map(([c, f]) => listing(c, f)).join("\n    ")}
  </Listings>
</ListingDataFeed>
`;
}

const ids = (xml) => [...xml.matchAll(/<ListingID>(\d+)<\/ListingID>/g)].map((m) => m[1]);

console.log("espelho.mjs");
const base = feed([["100", 10], ["200", 3], ["300", 20], ["47236", 12], ["500", 8]]);
ok("separa 5 anúncios", separar(base).blocos.length === 5);

let r = ajustar(base, { ativos: new Set(["100", "200", "300", "500"]), minFotos: 7, maximo: 3000, limiteRemocao: 0.5, agora: new Date("2026-10-09T18:00:00Z") });
ok("desativado no Vista sai (47236)", !ids(r.xml).includes("47236") && r.excluidos.inativo_no_vista === 1);
ok("menos de 7 fotos sai (200)", !ids(r.xml).includes("200") && r.excluidos.poucas_fotos === 1);
ok("ficam 100, 300, 500 na ordem original", ids(r.xml).join() === "100,300,500", ids(r.xml).join());
ok("PublishDate atualizado", r.xml.includes("<PublishDate>2026-10-09T18:00:00</PublishDate>"));
ok("cabeçalho e rodapé preservados", r.xml.startsWith('<?xml version="1.0"') && r.xml.trimEnd().endsWith("</ListingDataFeed>"));
ok("conteúdo do anúncio intacto (CDATA, fotos)", r.xml.includes("<![CDATA[Casa & quintal <ótima>]]>") && (r.xml.match(/medium="image"/g) || []).length === 38);

r = ajustar(base, { ativos: null, minFotos: 0, maximo: 3000 });
ok("API fora: não filtra e avisa", ids(r.xml).length === 5 && r.avisos.some((a) => a.includes("indisponível")));

r = ajustar(base, { ativos: new Set(["100"]), minFotos: 0, maximo: 3000, limiteRemocao: 0.1 });
ok("filtro de ativos que removeria demais é ignorado", ids(r.xml).length === 5 && r.avisos.some((a) => a.includes("ignorado")));

r = ajustar(base, { ativos: null, minFotos: 0, maximo: 2 });
ok("teto: ficam os 2 com mais fotos (300 e 47236)", ids(r.xml).sort().join() === "300,47236" && r.excluidos.acima_do_limite === 3, ids(r.xml).join());

// Ponta a ponta: gerar.mjs com o Vista simulado.
console.log("gerar.mjs");
const dir = mkdtempSync(join(tmpdir(), "feed-"));
const falso = join(dir, "fetch-falso.mjs");
writeFileSync(falso, `
import { readFileSync } from "node:fs";
const xml = readFileSync(process.env.XML_FALSO, "utf8");
const codigos = JSON.parse(process.env.CODIGOS_FALSOS || "null");
globalThis.fetch = async (url) => {
  url = String(url);
  if (url.includes("/imoveis/listar")) {
    if (!codigos) return { ok: false, status: 500, json: async () => ({}) };
    const p = JSON.parse(new URL(url).searchParams.get("pesquisa")).paginacao;
    const fatia = codigos.slice((p.pagina - 1) * p.quantidade, p.pagina * p.quantidade);
    const corpo = { total: String(codigos.length), paginas: String(Math.ceil(codigos.length / p.quantidade)) };
    for (const c of fatia) corpo[c] = { Codigo: c };
    return { ok: true, status: 200, json: async () => corpo };
  }
  return { ok: true, status: 200, text: async () => xml };
};`);

const muitos = Array.from({ length: 120 }, (_, i) => [String(10000 + i), 8]);
// Em arquivo, não em variável de ambiente: o Linux limita cada variável a 128 KB.
let nArq = 0;
const arquivo = (conteudo) => { const p = join(dir, `vista-${nArq++}.xml`); writeFileSync(p, conteudo); return p; };
const rodar = (env, saida) => {
  try {
    execFileSync(process.execPath, ["--import", falso, join(aqui, "gerar.mjs"), saida], {
      env: { ...process.env, VISTA_API_KEY: "teste", FEED_MINIMO: "100", ...env }, stdio: "pipe",
    });
    return 0;
  } catch (e) { return e.status ?? 1; }
};
const codigos = muitos.map(([c]) => c);

const s1 = join(dir, "a", "vrsync.xml");
ok("gera e grava", rodar({ XML_FALSO: arquivo(feed(muitos)), CODIGOS_FALSOS: JSON.stringify(codigos) }, s1) === 0 && existsSync(s1));
ok("gravou os 120", existsSync(s1) && ids(readFileSync(s1, "utf8")).length === 120);

const s2 = join(dir, "b", "vrsync.xml");
ok("XML do Vista truncado: erro e nada gravado",
  rodar({ XML_FALSO: arquivo(feed(muitos).slice(0, 5000)), CODIGOS_FALSOS: JSON.stringify(codigos) }, s2) !== 0 && !existsSync(s2));

const s3 = join(dir, "c", "vrsync.xml");
ok("API fora: publica o XML do Vista mesmo assim",
  rodar({ XML_FALSO: arquivo(feed(muitos)) }, s3) === 0 && ids(readFileSync(s3, "utf8")).length === 120);

const s4 = join(dir, "d", "vrsync.xml");
ok("abaixo do piso: erro e nada gravado",
  rodar({ XML_FALSO: arquivo(feed(muitos.slice(0, 50))), CODIGOS_FALSOS: JSON.stringify(codigos) }, s4) !== 0 && !existsSync(s4));

console.log(`\n${total - falhas}/${total} ok`);
process.exit(falhas ? 1 : 0);
