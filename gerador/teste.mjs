/**
 * Testes do gerador do VRSync — sem rede.
 *
 * A amostra é a resposta REAL do /imoveis/listar em 09/10/2026 (descrições
 * encurtadas). O que estes testes protegem é o que tira anúncio do ar ou
 * publica errado: XML mal escapado, preço na finalidade errada, anúncio sem
 * preço, e feed truncado sendo gravado.
 *
 * Rodar: node gerador/teste.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { montarFeed, motivoExclusao } from "./vrsync.mjs";

const aqui = dirname(fileURLToPath(import.meta.url));
let falhas = 0, total = 0;
const ok = (nome, cond, det = "") => {
  total++;
  console.log((cond ? "  ok  " : " FALHA") + "  " + nome + (cond ? "" : "  -> " + det));
  if (!cond) falhas++;
};

const amostra = [
  { Codigo: "47940", Status: "Venda", Categoria: "Casa em Condomínio", Bairro: "Altos da Bela Vista", Cidade: "Indaiatuba",
    Endereco: "João Ceccon", Numero: "1081", ValorVenda: "1920000", ValorLocacao: "0", AreaTotal: "1111", AreaPrivativa: "360",
    Dormitorios: "4", Suites: "4", Vagas: "4", BanheiroSocialQtd: "5", Latitude: "-23.0746567", Longitude: "-47.2344067",
    FotoDestaque: "https://cdn.vistahost.com.br/rafaelak/vista.imobi/fotos/48033/ib4An5Z4l2Z3mG72ME4kO_480336ac7a8dbe8d39.jpg",
    DescricaoWeb: "Excelência, sofisticação & espaço <alto padrão>." },
  // Empreendimento: vem com preço 0 — tem de ficar de fora.
  { Codigo: "47941", Status: "Venda", Categoria: "Empreendimento", Bairro: "Altos da Bela Vista", Cidade: "Indaiatuba",
    ValorVenda: "0", ValorLocacao: "0", Latitude: "-23.0746567", Longitude: "-47.2344067", DescricaoWeb: "" },
  // Sem coordenada: o Vista manda "" e não pode virar <Latitude>0</Latitude>.
  { Codigo: "47943", Status: "Venda", Categoria: "Apartamento", Bairro: "Aviação", Cidade: "Praia Grande",
    Endereco: "Martin Afonso de Souza", Numero: "345", ValorVenda: "980000", ValorLocacao: "0", AreaTotal: "145",
    AreaPrivativa: "122", Dormitorios: "3", Suites: "3", Vagas: "2", BanheiroSocialQtd: "1", Latitude: "", Longitude: "",
    FotoDestaque: "https://cdn.vistahost.com.br/rafaelak/vista.imobi/fotos/48036/i7Ms7Cfe881fGy7_480366ac7f19837809.jpg",
    DescricaoWeb: "A menos de 200 metros da praia!" },
  // Aluguel com ValorVenda preenchido por engano: só o aluguel pode sair.
  { Codigo: "47236", Status: "Aluguel", Categoria: "Apartamento", Bairro: "Areão", Cidade: "Taubaté",
    ValorVenda: "300000", ValorLocacao: "1800", AreaPrivativa: "68", Dormitorios: "2", FotoDestaque: "" },
  { Codigo: "46725", Status: "Venda e Aluguel", Categoria: "Apartamento", Bairro: "Taquaral", Cidade: "Campinas",
    ValorVenda: "650000", ValorLocacao: "3500" },
  { Codigo: "99999", Status: "Permuta", Categoria: "Terreno", Cidade: "Jacareí", ValorVenda: "100000" },
  { Codigo: "47940", Status: "Venda", Categoria: "Casa", Cidade: "Indaiatuba", ValorVenda: "1" }, // duplicado
];

console.log("montarFeed");
const { xml, publicados, excluidos } = montarFeed(amostra, { agora: new Date("2026-10-09T12:00:00Z") });
const anuncio = (cod) => (xml.match(new RegExp(`<Listing>\\s*<ListingID>${cod}</ListingID>[\\s\\S]*?</Listing>`)) ?? [""])[0];

ok("publica só os 4 válidos", publicados === 4, `publicados=${publicados}`);
ok("ListingCount bate", xml.includes("<ListingCount>4</ListingCount>"));
ok("conta motivos de exclusão", excluidos.sem_preco === 1 && excluidos.finalidade_invalida === 1 && excluidos.duplicado === 1,
  JSON.stringify(excluidos));
ok("empreendimento sem preço fica fora", !anuncio("47941"));
ok("escapa & e < > na descrição", anuncio("47940").includes("sofisticação &amp; espaço &lt;alto padrão&gt;."));
ok("endereço junta rua e número", anuncio("47940").includes("<Address>João Ceccon, 1081</Address>"));
ok("usa área privativa como útil", anuncio("47940").includes("<LivingArea>360</LivingArea>"));
ok("coordenada vazia não vira 0", !anuncio("47943").includes("<Latitude>"));
ok("aluguel não publica preço de venda", !anuncio("47236").includes("ListPrice") && anuncio("47236").includes('<RentalPrice currency="BRL">1800</RentalPrice>'));
ok("aluguel é For Rent", anuncio("47236").includes("<TransactionType>For Rent</TransactionType>"));
ok("sem foto vira <Media />", anuncio("47236").includes("<Media />"));
ok("venda e aluguel leva os dois preços", anuncio("46725").includes("ListPrice") && anuncio("46725").includes("RentalPrice"));
ok("motivo sem_codigo", motivoExclusao({ Codigo: " ", Status: "Venda", ValorVenda: "1" }) === "sem_codigo");

// gerar.mjs de ponta a ponta, com o Vista simulado por um fetch falso.
console.log("gerar.mjs");
const dir = mkdtempSync(join(tmpdir(), "vrsync-"));
const falso = join(dir, "fetch-falso.mjs");
writeFileSync(falso, `
const itens = JSON.parse(process.env.ITENS_FALSOS);
const declarado = Number(process.env.TOTAL_DECLARADO || itens.length);
globalThis.fetch = async (url) => {
  const p = JSON.parse(new URL(url).searchParams.get("pesquisa")).paginacao;
  const fatia = itens.slice((p.pagina - 1) * p.quantidade, p.pagina * p.quantidade);
  const corpo = { total: String(declarado), paginas: String(Math.ceil(declarado / p.quantidade)) };
  for (const i of fatia) corpo[i.Codigo] = i;
  return { ok: true, status: 200, json: async () => corpo };
};`);

const muitos = Array.from({ length: 120 }, (_, i) => ({
  Codigo: String(10000 + i), Status: i % 2 ? "Venda" : "Aluguel", Categoria: "Casa", Cidade: "Atibaia",
  ValorVenda: "500000", ValorLocacao: "2500",
}));
const rodar = (env, saida) => {
  try {
    execFileSync(process.execPath, ["--import", falso, join(aqui, "gerar.mjs"), saida], {
      env: { ...process.env, VISTA_API_KEY: "teste", FEED_MINIMO: "100", ...env }, stdio: "pipe",
    });
    return 0;
  } catch (e) { return e.status ?? 1; }
};

const saida1 = join(dir, "a", "vrsync.xml");
ok("percorre as 3 páginas e grava", rodar({ ITENS_FALSOS: JSON.stringify(muitos) }, saida1) === 0 && existsSync(saida1));
ok("gravou os 120", existsSync(saida1) && readFileSync(saida1, "utf8").includes("<ListingCount>120</ListingCount>"));

const saida2 = join(dir, "b", "vrsync.xml");
ok("Vista truncado: sai com erro e não grava",
  rodar({ ITENS_FALSOS: JSON.stringify(muitos.slice(0, 80)), TOTAL_DECLARADO: "120" }, saida2) !== 0 && !existsSync(saida2));

const saida3 = join(dir, "c", "vrsync.xml");
ok("abaixo do piso: sai com erro e não grava",
  rodar({ ITENS_FALSOS: JSON.stringify(muitos.slice(0, 50)) }, saida3) !== 0 && !existsSync(saida3));

ok("sem chave: sai com erro", rodar({ VISTA_API_KEY: "", ITENS_FALSOS: "[]" }, join(dir, "d.xml")) !== 0);

console.log(`\n${total - falhas}/${total} ok`);
process.exit(falhas ? 1 : 0);
