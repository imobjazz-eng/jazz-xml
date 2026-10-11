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
import { enriquecerTitulo, enriquecerDescricao, enriquecerAnuncio, enriquecerFeed, enderecosSemCoordenada, chaveEndereco, lerAnuncio, usoDe, linkYoutubeValido, pendencias, planilhaPendencias } from "./enriquecer.mjs";
import { escolherResultado, geocodificar, precisaConsultar, mesmaVia } from "./geocodificar.mjs";
import { extrairAntigo } from "./antigo.mjs";
import { ajustarPadrao } from "./enriquecer.mjs";
import { TOUR_BASE, codigoDoTour, fotosDoAnuncio, dadosDoTour, inserirTour, linkDoTour } from "./tour.mjs";

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

const comPreco = (codigo, preco, tipo = "For Sale") =>
  listing(codigo, 8).replace(/<ListPrice[^<]*<\/ListPrice>/, `<ListPrice currency="BRL">${preco}</ListPrice>`).replace("For Sale", tipo);
const precos = feed([]).replace("\n    \n", `\n    ${[comPreco("1", 40000000000), comPreco("2", 745), comPreco("3", 500000), comPreco("4", 745, "For Rent")].join("\n    ")}\n`);
r = ajustar(precos, { ativos: null, minFotos: 0, maximo: 3000 });
ok("preço de venda absurdo sai e vai para o aviso (1 e 2)", ids(r.xml).join() === "3,4" && r.excluidos.preco_fora_do_padrao === 2 && r.avisos.some((a) => a.includes("1, 2")), ids(r.xml).join());

console.log("enriquecer.mjs — título");
const venda = { transacao: "For Sale", tipo: "Casa", cidade: "Campinas", bairro: "Centro" };
const casosTitulo = [
  ["CASA À VENDA - JARDIM TAMOIO | CAMPINAS/SP", "Casa à Venda - Jardim Tamoio | Campinas/SP"],
  ["Sobrado Triplex com 3 Dormitórios, Quintal", "Sobrado Triplex à venda com 3 Dormitórios, Quintal"],
  ["Excelente oportunidade de apartamento à venda no Bosque, em Campinas!  95,00m², 1 suíte.", "Apartamento à venda no Bosque, em Campinas! 95,00m², 1 suíte"],
  ["Prédio Comercial à Venda no Jardim Miranda | Excelente Oportunidade para Investimento", "Prédio Comercial à Venda no Jardim Miranda"],
  ["APTO À VENDA NO PORTAL DAS OLIVEIRAS | 2 DORM COM SUÍTE", "Apartamento à Venda no Portal das Oliveiras | 2 Dormitórios com Suíte"],
  ["Casa  à venda totalmente reformada- 200 metros da praia-Aviação", "Casa à venda totalmente reformada - 200 metros da praia - Aviação"],
  ["Casa à Venda no Bandeira Branca II ? Jacareí", "Casa à Venda no Bandeira Branca II - Jacareí"],
  ["Swiss Park - Condomínio Glarus", "Swiss Park - Condomínio Glarus, à venda"],
  ["Ok", "Casa à venda em Centro, Campinas"],
];
for (const [de, para] of casosTitulo) {
  const t = enriquecerTitulo(de, venda);
  ok(`título: ${de.slice(0, 45)}`, t === para, t);
}
const longo = enriquecerTitulo("Casa térrea à venda no Condomínio Residencial Evidências, em Indaiatuba, com 3 suítes, piscina, espaço gourmet, escritório e 4 vagas", venda);
ok("título longo cortado em até 100 sem palavra pela metade", longo.length <= 100 && /Indaiatuba|suítes|piscina|gourmet$/.test(longo), longo);
ok("aluguel: 'para alugar'", enriquecerTitulo("Galpão no Distrito Industrial", { transacao: "For Rent" }) === "Galpão para alugar no Distrito Industrial");

console.log("enriquecer.mjs — descrição");
const anuncio = { ...venda, uf: "SP", areaUtil: 135, areaTotal: 207, quartos: 3, suites: 1, banheiros: 2, vagas: 2, ano: 2015, diferenciais: ["Piscina", "Churrasqueira"] };
let d = enriquecerDescricao("Cozinha &amp; área de serviço. Ligue (19) 99798-4383 e agende. Linda casa.\nVeja www.site.com.br\n\n\n\nÓtima localização", anuncio);
ok("&amp; vira &", d.texto.includes("Cozinha & área"), d.texto);
ok("frase com telefone e site sai inteira", !/99798|site\.com|Ligue/.test(d.texto) && d.texto.includes("Linda casa."), d.texto);
ok("descrição curta ganha a ficha só com dados do anúncio",
  d.ficha && d.texto.includes("- Área útil: 135 m²") && d.texto.includes("- 3 quartos, sendo 1 suíte") && d.texto.includes("Diferenciais: Piscina, Churrasqueira.") && d.texto.includes("Localização: Centro, Campinas/SP."), d.texto);
ok("sem linhas em branco em excesso", !/\n{3,}/.test(d.texto));
d = enriquecerDescricao("CASA COM PISCINA E CHURRASQUEIRA NO CENTRO DE SÃO JOSÉ DOS CAMPOS. ACEITA FINANCIAMENTO PELO FGTS.", anuncio, { curta: 0, restaurarNomes: (t) => t.replace(/são josé dos campos/gi, "São José dos Campos") });
ok("linha em maiúsculas vira frase, preservando sigla e nome", d.texto === "Casa com piscina e churrasqueira no centro de São José dos Campos. Aceita financiamento pelo FGTS.", d.texto);
d = enriquecerDescricao("Frase completa. ".repeat(250), anuncio);
ok("descrição longa cortada em frase inteira (até 3000)", d.texto.length <= 3000 && d.texto.endsWith("completa."), d.texto.length);
ok("descrição longa não ganha ficha", !d.ficha);

console.log("enriquecer.mjs — anúncio e coordenadas");
const comLocal = (lat, lon) => listing("900", 8).replace(
  /<Location[\s\S]*?<\/Location>/,
  `<Location displayAddress="Neighborhood">
        <Address>Rua Barão de Jaguara</Address>
        <City><![CDATA[Campinas]]></City>${lat !== undefined ? `
        <Latitude>${lat}</Latitude>
        <Longitude>${lon}</Longitude>` : ""}
        <Neighborhood><![CDATA[Centro]]></Neighborhood>
        <State abbreviation="SP">São Paulo</State>
      </Location>`).replace("<Description><![CDATA[Casa & quintal <ótima>]]></Description>", "<Description><![CDATA[Texto &#93;]&gt; que vira fim de CDATA ao decodificar.]]></Description>");
const chave = chaveEndereco(lerAnuncio(comLocal()));
const cache = { [chave]: { lat: -22.9056, lon: -47.0608 } };
let e = enriquecerAnuncio(comLocal(), { coordenadaDe: (k) => cache[k] ?? null });
ok("sem coordenada: recebe a do cache, depois da cidade", e.mudou.coordenada_adicionada && /<\/City>\n {8}<Latitude>-22.9056000<\/Latitude>\n {8}<Longitude>-47.0608000<\/Longitude>\n {8}<Neighborhood>/.test(e.bloco), e.bloco);
e = enriquecerAnuncio(comLocal(-13.90108184065817, -50.713421874999995));
ok("centro do Brasil (pino padrão do Vista) é descartado", e.mudou.coordenada_descartada && !/<Latitude>/.test(e.bloco));
e = enriquecerAnuncio(comLocal(-22.97, -47.02));
ok("coordenada boa do Vista fica como está", !e.mudou.coordenada_adicionada && !e.mudou.coordenada_descartada && e.bloco.includes("<Latitude>-22.97</Latitude>"));
ok("endereço sem coordenada vai para a geocodificação", enderecosSemCoordenada(feed([]).replace("\n    \n", `\n    ${comLocal()}\n`)).length === 1);
let f = enriquecerFeed(feed([["100", 8], ["200", 9]]));
ok("feed enriquecido continua XML válido e na mesma ordem", ids(f.xml).join() === "100,200" && f.xml.trimEnd().endsWith("</ListingDataFeed>"));
{ const b = enriquecerAnuncio(comLocal()).bloco; ok("']]>' vindo de entidade não fecha o CDATA antes da hora", b.includes("Texto ]] >") && (b.match(/\]\]>/g) || []).length === (b.match(/<!\[CDATA\[/g) || []).length, b); }

console.log("enriquecer.mjs — UsageType, vídeo e pendências");
const comTipo = (tipo) => listing("700", 8).replace("<Description>", `<PropertyType>${tipo}</PropertyType>\n        <Description>`);
e = enriquecerAnuncio(comTipo("Commercial / Office"));
ok("UsageType vem do PropertyType, logo antes dele", e.mudou.uso && /<UsageType>Commercial<\/UsageType>\n {8}<PropertyType>Commercial \/ Office/.test(e.bloco), e.bloco);
ok("UsageType não duplica", (enriquecerAnuncio(e.bloco).bloco.match(/<UsageType>/g) || []).length === 1);
ok("tipo desconhecido não ganha UsageType", usoDe("Outro") === null && !enriquecerAnuncio(comTipo("Outro")).mudou.uso);
const yt = "https://www.youtube.com/watch?v=vFa7524TNbk";
e = enriquecerAnuncio(listing("700", 8), { videoDe: (c) => (c === "700" ? yt : null) });
ok("vídeo da lista entra no fim de Media, como o Vista faz", e.mudou.video && e.bloco.includes(`<Item medium="video">${yt}</Item>\n      </Media>`), e.bloco);
ok("anúncio que já tem vídeo fica com o dele", (enriquecerAnuncio(e.bloco, { videoDe: () => "https://youtu.be/AAAAAAAAAAA" }).bloco.match(/medium="video"/g) || []).length === 1);
ok("só link do YouTube entra (portal ignora o resto)",
  linkYoutubeValido(yt) && linkYoutubeValido("https://youtu.be/vFa7524TNbk") && !linkYoutubeValido("https://vimeo.com/123") && !linkYoutubeValido("https://www.youtube.com/shorts/vFa7524TNbk") && !linkYoutubeValido("http://www.youtube.com/watch?v=vFa7524TNbk"));
const faltas = pendencias(comTipo("Residential / Home"));
ok("pendências apontam o que só o Vista resolve", ["ano de construção", "área útil", "características", "IPTU", "quartos", "vídeo", "localização no mapa"].every((f) => faltas.includes(f)) && faltas.includes("mais fotos (tem 8)"), faltas.join(", "));
const planilha = planilhaPendencias(feed([["100", 8]]));
ok("planilha de pendências abre no Excel (BOM, ';')", planilha.startsWith("\uFEFFcodigo;titulo;pendencias;quantidade") && planilha.includes('"100";'));

console.log("tour.mjs — tour virtual com as fotos do anúncio");
{
  const com = listing("800", 8).replace('caption="">https://cdn.vistahost.com.br/f/800_3.jpg', 'caption="Sala &amp; cozinha" primary="true">https://cdn.vistahost.com.br/f/800_3.jpg');
  const f = fotosDoAnuncio(com);
  ok("fotos na ordem, principal primeiro, legenda desescapada", f.length === 8 && f[0].u.endsWith("800_3.jpg") && f[0].l === "Sala & cozinha" && f[1].u.endsWith("800_0.jpg"), JSON.stringify(f.slice(0, 2)));
  ok("foto repetida entra uma vez só", fotosDoAnuncio(listing("801", 3) + listing("801", 3)).length === 3);
  ok("menos fotos que o mínimo: sem tour", dadosDoTour(listing("802", 6)) === null && dadosDoTour(listing("803", 7)).fotos.length === 7);
  ok("código vira arquivo só se for seguro", codigoDoTour("12345") === "12345" && codigoDoTour("../x") === null && codigoDoTour("") === null);
  const link = linkDoTour("12345");
  ok("link completo em HTTPS, sem encurtador", link === TOUR_BASE + "?c=12345" && link.startsWith("https://imobjazz-eng.github.io/"));
  const comTitulo = listing("804", 8).replace("<Media>", "<Title><![CDATA[Casa]]></Title>\n      <Media>");
  const t1 = inserirTour(comTitulo, link);
  ok("VirtualTourLink entra logo depois do Title", /<\/Title>\n {6}<VirtualTourLink><!\[CDATA\[https:\/\/imobjazz-eng\.github\.io\/jazz-xml\/tour\/\?c=12345\]\]><\/VirtualTourLink>\n {6}<Media>/.test(t1), t1);
  ok("sem Title: entra antes de Media", inserirTour(listing("805", 8), link).includes("<VirtualTourLink><![CDATA[" + link + "]]></VirtualTourLink>\n      <Media>"));
  ok("tour do Vista fica (não duplica)", (inserirTour(t1, "https://outro/").match(/<VirtualTourLink>/g) || []).length === 1);
  let pedidos = [];
  const r = enriquecerAnuncio(comTitulo, { tourDe: (c, b) => { pedidos.push(c); return linkDoTour(c); } });
  ok("enriquecer pede o tour e marca", r.mudou.tour && pedidos[0] === "804" && r.bloco.includes("?c=804"));
  pedidos = [];
  const r2 = enriquecerAnuncio(t1, { tourDe: (c) => { pedidos.push(c); return linkDoTour(c); } });
  ok("quem já tem tour nem pede dados", !r2.mudou.tour && pedidos.length === 0);
  const vf = enriquecerFeed(feed([["900", 8], ["901", 3]]), { tourDe: (c, b) => (dadosDoTour(b) ? linkDoTour(c) : null) });
  ok("feed: tour só em quem tem fotos suficientes", vf.resumo.tour === 1 && vf.xml.includes("?c=900") && !vf.xml.includes("?c=901"));
}

console.log("antigo.mjs e padrão VRSync (documentação do Grupo ZAP)");
{
  const antigoXml = `<Listings><Listing><ListingID>900</ListingID><Location displayAddress="All"><Address>Rua A</Address><StreetNumber>230</StreetNumber><Latitude>-22.9</Latitude><Longitude>-47.0</Longitude></Location>
    <Details><LivingArea unit="square metres">417.6</LivingArea><YearBuilt>2001</YearBuilt><YearlyTax currency="BRL">201</YearlyTax><Features><Feature>Pool</Feature><Feature>Maids Quarters</Feature></Features></Details></Listing>
    <Listing><ListingID>901</ListingID><Location><StreetNumber>0</StreetNumber></Location><Details><YearBuilt>abc</YearBuilt><YearlyTax>0.01</YearlyTax></Details></Listing></Listings>`;
  const ant = extrairAntigo(antigoXml);
  ok("extrai número, ano, IPTU, área, coordenada e características", ant["900"].numero === "230" && ant["900"].ano === 2001 && ant["900"].iptu === 201 && ant["900"].area_util === 418 && ant["900"].lat === -22.9 && ant["900"].caracteristicas.length === 2, JSON.stringify(ant["900"]));
  ok("lixo do XML anterior não entra", !ant["901"], JSON.stringify(ant["901"]));

  const base = `<Listing>
      <ListingID>800</ListingID>
      <Details>
        <LivingArea>0</LivingArea>
        <LotArea>120.6</LotArea>
        <PropertyAdministrationFee>0.01</PropertyAdministrationFee>
        <PropertyType>Residential / Apartment</PropertyType>
        <YearlyTax>0.1</YearlyTax>
        <Features>
          <Feature>BarbecueBalcony</Feature>
          <Feature>Maids Quarters</Feature>
        </Features>
        <ListPrice currency="BRL">500000.40</ListPrice>
      </Details>
      <Location displayAddress="Neighborhood">
        <Address>Rua A</Address>
        <City><![CDATA[Atibaia]]></City>
      </Location>
    </Listing>`;
  const r = ajustarPadrao(base, ant["900"]);
  const x = r.bloco;
  ok("só bairro passa a endereço completo (All)", x.includes('<Location displayAddress="All">') && r.mudou.rua_visivel);
  ok("sem rua: continua só bairro", ajustarPadrao(base.replace("<Address>Rua A</Address>", "")).bloco.includes('displayAddress="Neighborhood"'));
  ok("rua sem número (Street) fica como está", ajustarPadrao(base.replace('"Neighborhood"', '"Street"')).bloco.includes('displayAddress="Street"'));
  ok("Country entra no início de Location", x.includes('<Location displayAddress="All">\n        <Country abbreviation="BR">Brasil</Country>\n        <Address>'), x);
  ok("número do XML anterior logo depois do Address", x.includes("<Address>Rua A</Address>\n        <StreetNumber>230</StreetNumber>"));
  ok("área útil do XML anterior, inteira e com unit", x.includes('<LivingArea unit="square metres">418</LivingArea>') && x.includes('<LotArea unit="square metres">121</LotArea>'));
  ok("condomínio 0.01 sai (0 seria isento)", !x.includes("PropertyAdministrationFee"));
  ok("preço inteiro com currency", x.includes('<ListPrice currency="BRL">500000</ListPrice>'));
  ok("IPTU do XML anterior no YearlyTax e no Iptu novo", x.includes('<YearlyTax currency="BRL">201</YearlyTax>\n        <Iptu currency="BRL" period="Yearly">201</Iptu>'), x);
  ok("ano do XML anterior", x.includes("<YearBuilt>2001</YearBuilt>"));
  ok("características com o nome da lista oficial", x.includes("<Feature>Barbecue Balcony</Feature>") && x.includes("<Feature>Maid's Quarters</Feature>") && !x.includes("BarbecueBalcony"));
  ok("contadores", r.mudou.pais && r.mudou.numero && r.mudou.ano && r.mudou.iptu && r.mudou.area_util && r.mudou.formato);

  const semAntigo = ajustarPadrao(base.replace("<YearlyTax>0.1</YearlyTax>", "<YearlyTax>395.7</YearlyTax>")).bloco;
  ok("sem XML anterior: ano 2001; IPTU real do Vista fica", semAntigo.includes("<YearBuilt>2001</YearBuilt>") && semAntigo.includes('<YearlyTax currency="BRL">396</YearlyTax>') && semAntigo.includes('<Iptu currency="BRL" period="Yearly">396</Iptu>'), semAntigo);
  ok("sem IPTU nenhum: 201", ajustarPadrao(base.replace(/\s*<YearlyTax>0.1<\/YearlyTax>/, "")).bloco.includes('<YearlyTax currency="BRL">201</YearlyTax>'));
  ok("sem número no anterior: nada inventado", !ajustarPadrao(base).bloco.includes("StreetNumber"));
  const terreno = ajustarPadrao(base.replace("Residential / Apartment", "Residential / Land Lot")).bloco;
  ok("terreno: sem ano de construção", !terreno.includes("YearBuilt"));
  const duas = ajustarPadrao(x, ant["900"]).bloco;
  ok("rodar duas vezes não duplica nada", duas === x, duas);
  const feat = ajustarPadrao(base.replace(/<Features>[\s\S]*?<\/Features>/, "<Warranties/>"), ant["900"]).bloco;
  ok("sem características no Vista: as do anterior", feat.includes("<Feature>Pool</Feature>") && feat.includes("<Feature>Maid's Quarters</Feature>"), feat);
  const vf = enriquecerFeed(feed([["900", 8]]), { antigoDe: (c) => ant[c] ?? null });
  ok("feed: resumo conta o que veio do anterior", vf.resumo.iptu === 1 && vf.resumo.ano === 1 && vf.resumo.pais === 1, JSON.stringify(vf.resumo));
}

console.log("geocodificar.mjs");
const pedido = { chave: "x", rua: "Rua Dr. Barão de Jaguara", cidade: "Campinas", uf: "SP", estado: "São Paulo" };
const res = (road, city, lat = "-22.9", lon = "-47.06") => ({ lat, lon, address: { road, city } });
ok("aceita mesma rua e cidade", escolherResultado(pedido, [res("Rua Barão de Jaguara", "Campinas")]).ok);
ok("recusa cidade diferente", escolherResultado(pedido, [res("Rua Barão de Jaguara", "Hortolândia")]).motivo === "cidade_divergente");
ok("recusa rua diferente", escolherResultado(pedido, [res("Rua Barão de Itapura", "Campinas")]).motivo === "via_divergente");
ok("recusa fora do estado", escolherResultado(pedido, [res("Rua Barão de Jaguara", "Campinas", "-13.9", "-50.7")]).motivo === "fora_do_estado");
ok("rua: 'Av. Prof. X' casa com 'Avenida Professor X'", mesmaVia("Av. Prof. Zeferino Vaz", "Avenida Professor Zeferino Vaz"));
ok("falha é tentada de novo só depois de 30 dias",
  !precisaConsultar({ s: "via_divergente", t: "2026-10-01" }, new Date("2026-10-09")) && precisaConsultar({ s: "via_divergente", t: "2026-08-01" }, new Date("2026-10-09")) && !precisaConsultar({ s: "ok", t: "2020-01-01" }));
{
  const pedidos = [];
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (url) => {
    pedidos.push(String(url));
    const rua = new URL(url).searchParams.get("street");
    if (rua === "Rua Quebrada") throw new Error("rede caiu");
    return { ok: true, status: 200, json: async () => (rua === "Rua A" ? [res("Rua A", "Campinas")] : []) };
  };
  const c = { velho: { s: "ok", lat: -22, lon: -47, t: "2026-01-01" } };
  const lista = ["Rua A", "Rua B", "Rua C"].map((rua) => ({ ...pedido, chave: rua, rua }));
  let g = await geocodificar([...lista, { ...pedido, chave: "velho" }], c, { limite: 2, intervaloMs: 0, agora: new Date("2026-10-09") });
  ok("respeita o limite por execução e não repete o que está no cache", pedidos.length === 2 && g.pendentes === 3 && g.achados === 1);
  ok("grava acerto e falha no cache", c["Rua A"].s === "ok" && c["Rua B"].s === "sem_resultado" && !c["Rua C"]);
  g = await geocodificar([{ ...pedido, chave: "q", rua: "Rua Quebrada" }, { ...pedido, chave: "C", rua: "Rua C" }], c, { intervaloMs: 0 });
  ok("erro de rede para a geocodificação sem derrubar", g.erro === "rede caiu" && !c.q && !c.C);
  globalThis.fetch = fetchOriginal;
}

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
  if (url.includes("nominatim")) return { ok: true, status: 200, json: async () => [] };
  return { ok: true, status: 200, text: async () => xml };
};`);

const muitos = Array.from({ length: 120 }, (_, i) => [String(10000 + i), 8]);
// Em arquivo, não em variável de ambiente: o Linux limita cada variável a 128 KB.
let nArq = 0;
const arquivo = (conteudo) => { const p = join(dir, `vista-${nArq++}.xml`); writeFileSync(p, conteudo); return p; };
const rodar = (env, saida) => {
  try {
    execFileSync(process.execPath, ["--import", falso, join(aqui, "gerar.mjs"), saida], {
      env: { ...process.env, VISTA_API_KEY: "teste", FEED_MINIMO: "100", GEO_INTERVALO_MS: "0", ...env }, stdio: "pipe",
    });
    return 0;
  } catch (e) { return e.status ?? 1; }
};
const codigos = muitos.map(([c]) => c);

const s1 = join(dir, "a", "vrsync.xml");
ok("gera e grava", rodar({ XML_FALSO: arquivo(feed(muitos)), CODIGOS_FALSOS: JSON.stringify(codigos) }, s1) === 0 && existsSync(s1));
ok("gravou os 120", existsSync(s1) && ids(readFileSync(s1, "utf8")).length === 120);
ok("gravou o cache de geocodificação ao lado", existsSync(join(dir, "a", "geocode.json")));
ok("título enriquecido no arquivo final", readFileSync(s1, "utf8").includes("<Title><![CDATA["));
ok("planilha de pendências gravada ao lado", existsSync(join(dir, "a", "pendencias.csv")));
{
  const x = readFileSync(s1, "utf8");
  const links = [...x.matchAll(/<VirtualTourLink><!\[CDATA\[([^\]]+)\]\]>/g)].map((m) => m[1]);
  const semArquivo = links.filter((l) => !existsSync(join(dir, "a", "tour", "d", `${new URL(l).searchParams.get("c")}.json`)));
  ok("tour: todo link do XML aponta para dados gravados", links.length > 0 && semArquivo.length === 0, `${links.length} links, ${semArquivo.length} sem arquivo`);
  const s5 = join(dir, "e", "vrsync.xml");
  rodar({ XML_FALSO: arquivo(feed(muitos)), CODIGOS_FALSOS: JSON.stringify(codigos), TOUR_BASE: "desligado" }, s5);
  const yt = "https://www.youtube.com/watch?v=DlYDTuoHf3k";
  ok("vídeo padrão em todo anúncio", (x.match(/<Item medium="video">/g) || []).length === 120 && x.includes(`<Item medium="video">${yt}</Item>`));
  ok("TOUR_BASE=desligado: sem tour", existsSync(s5) && !readFileSync(s5, "utf8").includes("<VirtualTourLink>") && !existsSync(join(dir, "e", "tour")));
}

const s6 = join(dir, "f", "vrsync.xml");
rodar({ XML_FALSO: arquivo(feed(muitos)), CODIGOS_FALSOS: JSON.stringify(codigos), VIDEO_PADRAO: "desligado" }, s6);
ok("VIDEO_PADRAO=desligado: sem vídeo", existsSync(s6) && !readFileSync(s6, "utf8").includes('medium="video"'));

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
