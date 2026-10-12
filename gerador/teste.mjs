/**
 * Testes do gerador — sem rede. O formato do XML de exemplo copia o que o
 * Vista exporta (conferido no arquivo real em 09/10/2026).
 *
 * Rodar: node gerador/teste.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ajustar, separar } from "./espelho.mjs";
import { fichaDoImovel, enriquecerTitulo, enriquecerDescricao, enriquecerAnuncio, enriquecerFeed, enderecosSemCoordenada, chaveEndereco, lerAnuncio, usoDe, linkYoutubeValido, pendencias, planilhaPendencias } from "./enriquecer.mjs";
import { escolherResultado, geocodificar, precisaConsultar, mesmaVia } from "./geocodificar.mjs";
import { extrairAntigo } from "./antigo.mjs";
import { paraChavesNaMao, imovelChavesNaMao } from "./chavesnamao.mjs";
import { montarSaude } from "./saude.mjs";
import { paraImovelWeb, imovelImovelWeb } from "./imovelweb.mjs";
import { dadosDaApi } from "./vista.mjs";
import { ajustarPadrao, notaEstimada, errosObrigatorios, headerForaDeListings } from "./enriquecer.mjs";
import { TOUR_BASE, codigoDoTour, fotosDoAnuncio, dadosDoTour, inserirTour, linkDoTour } from "./tour.mjs";
import { tamanhoJpeg, eh360, nomeDoComodo, lerTours360, linkDoTour360, dadosDoTour360, toursDaLista, publicarTours360 } from "./tour360.mjs";

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
d = enriquecerDescricao("**Galpão no Centro**\n\n* Segurança 24h\n= Lazer completo\nFale com a imobiliária Jazz.com. Perto da Vila Bethânia.com permuta. Lar perfeito.Com piscina. Em Ubatuba.(400 m da praia). Área de 2.500 m², R$ 1.200,50 e site.com.br", anuncio, { curta: 0 });
ok("Markdown e domínio colado saem da descrição",
  d.texto === "Galpão no Centro\n\n- Segurança 24h\n- Lazer completo\nFale com a imobiliária Jazz. Perto da Vila Bethânia. Com permuta. Lar perfeito. Com piscina. Em Ubatuba. (400 m da praia). Área de 2.500 m², R$ 1.200,50 e site.com.br", d.texto);
d = enriquecerDescricao("Frase completa. ".repeat(250), anuncio);
ok("descrição longa cortada em frase inteira (até 3000) e a ficha no fim, inteira", d.texto.length <= 3000 && d.ficha && /completa\.\n\nFicha do imóvel:/.test(d.texto) && d.texto.endsWith(fichaDoImovel(anuncio)), d.texto.length);
d = enriquecerDescricao("Frase completa. ".repeat(250), anuncio, { curta: 900 });
ok("com limite (curta), descrição longa não ganha ficha", !d.ficha && d.texto.endsWith("completa."));

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
ok("pendências apontam o que só o Vista resolve", ["ano de construção", "área útil", "características", "IPTU", "quartos", "vídeo", "localização no mapa"].every((f) => faltas.includes(f)) && faltas.includes("mais fotos (tem 8; o portal pede 20)"), faltas.join(", "));
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
  ok("VirtualTourLink entra logo depois do Title", /<\/Title>\n {6}<VirtualTourLink>https:\/\/imobjazz-eng\.github\.io\/jazz-xml\/tour\/\?c=12345<\/VirtualTourLink>\n {6}<Media>/.test(t1), t1);
  ok("sem Title: entra antes de Media", inserirTour(listing("805", 8), link).includes("<VirtualTourLink>" + link + "</VirtualTourLink>\n      <Media>"));
  ok("link do tour sem CDATA e com & escapado", inserirTour(listing("806", 8), "https://x.teste/?a=1&b=2").includes("<VirtualTourLink>https://x.teste/?a=1&amp;b=2</VirtualTourLink>"));
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

console.log("tour360.mjs — tour 360 com as fotos enviadas pelo corretor");
// JPEG mínimo: só SOI, um APP0 qualquer e o SOF0 com altura e largura.
const jpeg = (largura, altura) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
  0xff, 0xc0, 0x00, 0x11, 0x08, altura >> 8, altura & 255, largura >> 8, largura & 255, 0x03, ...new Array(9).fill(0), 0xff, 0xd9]);
{
  ok("lê o tamanho do JPEG", JSON.stringify(tamanhoJpeg(jpeg(8000, 4000))) === JSON.stringify({ altura: 4000, largura: 8000 }));
  ok("não-JPEG: null", tamanhoJpeg(Buffer.from("PNG...")) === null);
  ok("360 só na proporção 2:1", eh360({ largura: 8000, altura: 4000 }) && eh360({ largura: 5376, altura: 2688 }) && !eh360({ largura: 4000, altura: 3000 }) && !eh360({ largura: 9000, altura: 1500 }));
  ok("nome do arquivo vira nome do cômodo", nomeDoComodo("2-sala_de_estar.jpg", 2) === "Sala de estar" && nomeDoComodo("03.jpg", 3) === "Ambiente 3" && nomeDoComodo("suite master.JPG", 1) === "Suite master");
  const pasta = mkdtempSync(join(tmpdir(), "t360-"));
  mkdirSync(join(pasta, "12345")); mkdirSync(join(pasta, "..x")); mkdirSync(join(pasta, "777"));
  writeFileSync(join(pasta, "12345", "10-quarto.jpg"), jpeg(8000, 4000));
  writeFileSync(join(pasta, "12345", "2-cozinha.jpg"), jpeg(8000, 4000));
  writeFileSync(join(pasta, "12345", "1-sala.JPG"), jpeg(6000, 3000));
  writeFileSync(join(pasta, "12345", "foto-comum.jpg"), jpeg(4000, 3000));
  writeFileSync(join(pasta, "12345", "LEIA.txt"), "x");
  writeFileSync(join(pasta, "777", "comum.jpg"), jpeg(4000, 3000));
  const { tours, avisos } = await lerTours360(pasta);
  const t = tours.get("12345");
  ok("só fotos 360, na ordem numérica do nome", t && t.cenas.map((c) => c.nome).join(",") === "Sala,Cozinha,Quarto" && t.cenas[0].arquivo === "1.jpg", JSON.stringify(t));
  ok("pasta sem foto 360 não vira tour", !tours.has("777") && tours.size === 1);
  ok("avisa foto comum e pasta inválida", avisos.some((a) => a.includes("foto-comum.jpg")) && avisos.some((a) => a.includes("..x")), avisos.join(" | "));
  ok("pasta tours360 ausente: vazio, sem erro", (await lerTours360(join(pasta, "nao-existe"))).tours.size === 0);
  ok("link 360 em HTTPS no GitHub Pages", linkDoTour360("12345") === "https://imobjazz-eng.github.io/jazz-xml/tour360/?c=12345");
  ok("dados da página: só nome e arquivo", JSON.stringify(dadosDoTour360(t).cenas[0]) === '{"f":"1.jpg","n":"Sala"}');

  // Enviados pelo celular (lista da Supabase).
  const remotos = toursDaLista({
    "500": { cenas: [{ caminho: "500/a/1.jpg", nome: "Sala", porta: { yaw: -30, pitch: -5 } }, { caminho: "500/a/2.jpg", nome: "" }] },
    "501": { cenas: [{ caminho: "outro/a/1.jpg" }] },
    "../x": { cenas: [{ caminho: "../x/1.jpg" }] },
  }, "https://banco.teste");
  const r5 = remotos.get("500");
  ok("lista do celular: URL pública, nome, porta e ordem", remotos.size === 1 && r5.cenas[0].url === "https://banco.teste/storage/v1/object/public/tours360/500/a/1.jpg"
    && r5.cenas[0].porta.yaw === -30 && r5.cenas[1].nome === "Ambiente 2" && r5.cenas[1].arquivo === "2.jpg", JSON.stringify(r5));
  ok("dados da página levam a porta", JSON.stringify(dadosDoTour360(r5).cenas[0].p) === '{"yaw":-30,"pitch":-5}');
  const site1 = mkdtempSync(join(tmpdir(), "s360-"));
  let baixadas = 0;
  const baixar = async () => { baixadas++; return { ok: true, arrayBuffer: async () => jpeg(400, 200) }; };
  ok("publica baixando as fotos", (await publicarTours360(remotos, site1, { baixar })).length === 0 && baixadas === 2 && existsSync(join(site1, "tour360", "f", "500", "2.jpg")));
  const site2 = mkdtempSync(join(tmpdir(), "s360-"));
  baixadas = 0;
  await publicarTours360(remotos, site2, { baixar, cache: join(site1, "tour360") });
  ok("já publicada: copia do cache, sem baixar de novo", baixadas === 0 && existsSync(join(site2, "tour360", "f", "500", "1.jpg")));
  const falhas = await publicarTours360(remotos, mkdtempSync(join(tmpdir(), "s360-")), { baixar: async () => ({ ok: false, status: 404 }) });
  ok("foto que sumiu: falha avisada, sem derrubar", falhas.length === 1 && falhas[0].includes("404"), falhas.join());
}

console.log("chavesnamao.mjs — XML do Chaves na Mão a partir do VRSync enriquecido");
{
  const vr = `<Listing><ListingID>700</ListingID><Title><![CDATA[Casa & quintal]]></Title><TransactionType>Sale/Rent</TransactionType>
    <Details><PropertyType>Residential / Land Lot</PropertyType><Description><![CDATA[Texto]]></Description><ListPrice currency="BRL">500000</ListPrice>
    <RentalPrice currency="BRL" period="Monthly">2500</RentalPrice><PropertyAdministrationFee currency="BRL">300</PropertyAdministrationFee>
    <Iptu currency="BRL" period="Yearly">201</Iptu><LotArea unit="square metres">360</LotArea>
    <Features><Feature>Pool</Feature><Feature>Balcony</Feature><Feature>Inexistente</Feature></Features></Details>
    <Location displayAddress="All"><Address>Rua A</Address><StreetNumber>12</StreetNumber><City><![CDATA[Atibaia]]></City>
    <Neighborhood><![CDATA[Centro]]></Neighborhood><PostalCode>12940-000</PostalCode><State abbreviation="SP">São Paulo</State></Location>
    <VirtualTourLink>https://imobjazz-eng.github.io/jazz-xml/tour/?c=700</VirtualTourLink>
    <Media>${Array.from({ length: 35 }, (_, i) => `<Item medium="image"${i === 3 ? ' primary="true"' : ""}>https://f/${i}.jpg</Item>`).join("")}<Item medium="video">https://www.youtube.com/watch?v=DlYDTuoHf3k</Item></Media></Listing>`;
  const c = imovelChavesNaMao(vr);
  ok("venda e aluguel: V + L, valores e período", c.transacao === "V" && c.transacao2 === "L" && c.valor === "500000" && c.valor_locacao === "2500" && c.periodo_locacao === "1");
  ok("terreno com condomínio vira 'Terreno em Condomínio'", c.finalidade === "RE" && c.tipo === "Terreno em Condomínio", c.tipo);
  ok("características só da lista do portal (condomínio → área comum)", JSON.stringify(c.area_comum) === '["Piscina"]' && JSON.stringify(c.area_privativa) === '["Sacada"]' && c.varanda === "1");
  ok("até 30 fotos, capa primeiro", c.fotos.length === 30 && c.fotos[0] === "https://f/3.jpg");
  ok("tour de fotos comuns não vai como tour_360; vídeo vai", c.tour_360 === "" && c.video.includes("DlYDTuoHf3k"));
  ok("endereço completo, CEP só números", c.endereco === "Rua A" && c.numero === "12" && c.cep === "12940000" && c.estado === "SP" && c.esconder_endereco_imovel === "0");
  const r = paraChavesNaMao(`<Listings>${vr}${vr.replace("<ListingID>700", "<ListingID>701").replace(/<ListPrice[^<]*<\/ListPrice>/, "").replace("Sale/Rent", "For Sale")}</Listings>`);
  const tags = (r.xml.match(/<imovel>[\s\S]*?<\/imovel>/) || [""])[0].match(/^ {6}<(\w+)/gm) || [];
  ok("todas as 53 tags presentes; sem preço fica de fora", r.total === 1 && tags.length === 53 && r.xml.includes("<titulo><![CDATA[Casa & quintal]]></titulo>"), `${r.total} imóveis, ${tags.length} tags`);
}

console.log("imovelweb.mjs — OpenNavent a partir do VRSync enriquecido");
{
  const base = (tipo, extra = "") => `<Listing><ListingID>800</ListingID><Title><![CDATA[Casa ampla com piscina, churrasqueira e quintal em condomínio fechado no Centro de Atibaia]]></Title>
    <TransactionType>Sale/Rent</TransactionType><Details><PropertyType>${tipo}</PropertyType><Description><![CDATA[Texto]]></Description>
    <ListPrice currency="BRL">500000</ListPrice><RentalPrice currency="BRL">2500</RentalPrice><LivingArea unit="square metres">120</LivingArea>
    <YearBuilt>2001</YearBuilt><Iptu currency="BRL" period="Yearly">201</Iptu>${extra}<Features><Feature>Pool</Feature><Feature>Balcony</Feature></Features></Details>
    <Location displayAddress="All"><Address>Rua A, B</Address><StreetNumber>12</StreetNumber><Complement>ap 3</Complement><City><![CDATA[Atibaia]]></City>
    <Neighborhood><![CDATA[Centro]]></Neighborhood><PostalCode>12940-000</PostalCode><State abbreviation="SP">São Paulo</State></Location>
    <Media><Item medium="image">https://f/1.jpg</Item><Item medium="video">https://www.youtube.com/watch?v=DlYDTuoHf3k</Item></Media></Listing>`;
  const d = imovelImovelWeb(base("Residential / Home"), { ano: 2026 });
  ok("tipo, venda e aluguel, idade", d.idTipo === "1" && d.idSubTipo === "5" && d.precos.map((p) => p[0]).join() === "VENTA,ALQUILER" && d.caracteristicas.some((c) => c.id === "CFT5" && c.valor === 25));
  ok("localidade Bairro,Cidade,Estado,Brasil e endereço com número", d.localidade === "Centro,Atibaia,São Paulo,Brasil" && d.endereco === "Rua A, B, 12 - ap 3", d.localidade + " | " + d.endereco);
  ok("título até 80 em palavra inteira; vídeo pelo código", d.titulo.length <= 80 && !/\s$/.test(d.titulo) && d.video === "DlYDTuoHf3k", d.titulo);
  ok("casa: piscina e varanda privativas", d.caracteristicas.some((c) => c.id === "20140") && d.caracteristicas.some((c) => c.id === "20199"));
  ok("apartamento sem condomínio fica de fora; com condomínio, piscina comum", imovelImovelWeb(base("Residential / Apartment")) === null
    && imovelImovelWeb(base("Residential / Apartment", '<PropertyAdministrationFee currency="BRL">400</PropertyAdministrationFee>')).caracteristicas.some((c) => c.id === "30025"));
  const r = paraImovelWeb(`<Listings>${base("Residential / Home")}</Listings>`, { codigoImobiliaria: "J1", agora: new Date(1700000000000) });
  ok("arquivo OpenNavent com dataModificacao em ms e código da imobiliária", r.total === 1 && r.xml.includes("<dataModificacao><![CDATA[1700000000000]]></dataModificacao>") && r.xml.includes("<codigoImobiliaria><![CDATA[J1]]></codigoImobiliaria>"));
}

console.log("saude.mjs — painel de saúde dos XMLs");
{
  const xml = feed(Array.from({ length: 10 }, (_, i) => [String(600 + i), i < 3 ? 8 : 20]));
  const s = montarSaude(xml, { noArquivo: 12, ativosNaApi: 10, excluidos: {}, maximo: 10, minimo: 5, chavesNaMao: 10, agora: new Date("2026-10-12T12:00:00Z") });
  const st = Object.fromEntries(s.etapas.map((e) => [e.id, e.status]));
  ok("etapas com verde/amarelo/vermelho", st.vista === "verde" && st.api === "verde" && st.selecao === "verde" && st.fotos === "vermelho" && st.video === "vermelho", JSON.stringify(st));
  ok("tabela com 10+ portais, do canal certo", s.portais.length >= 10 && s.portais[0].nome === "ZAP Imóveis" && s.portais[0].etapas.arquivo.link === "vrsync.xml"
    && s.portais.find((p) => p.nome === "DF Imóveis").etapas.arquivo.status === "cinza");
  ok("geral é o pior dos canais; os dois canais presentes", s.geral === "vermelho" && s.canais.map((c) => c.id).join() === "zap,chavesnamao,imovelweb" && s.geradoEm === "2026-10-12T12:00:00.000Z");
  const s2 = montarSaude(xml, { noArquivo: 12, ativosNaApi: null, enriquecimentoOk: false, chavesNaMao: null, maximo: 10 });
  const st2 = Object.fromEntries(s2.etapas.map((e) => [e.id, e.status]));
  ok("API fora: amarelo; enriquecimento falho e Chaves na Mão ausente: vermelho", st2.api === "amarelo" && st2.enriquecimento === "vermelho" && s2.canais[1].status === "vermelho");
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
  const comp = ajustarPadrao(base, { numero: "45", complemento: "Apto 12 <bl B>" }).bloco;
  ok("complemento logo depois do número, em CDATA", comp.includes("<StreetNumber>45</StreetNumber>\n        <Complement><![CDATA[Apto 12 <bl B>]]></Complement>"), comp);
  ok("sem número não entra complemento", !ajustarPadrao(base, { complemento: "Apto 1" }).bloco.includes("Complement"));
  ok("nota estimada: endereço com número + 20 fotos + preço = 100", notaEstimada(listing("1", 20).replace("<Location", "<Location><Address>Rua A</Address><StreetNumber>1</StreetNumber></Location><X")) === 100);
  ok("nota estimada: sem número e 10 fotos", notaEstimada(listing("1", 10).replace("<Location", "<Location><Address>Rua A</Address></Location><X")) === 20 + 25 + 10 + 13 + 7);
  const sel = ajustar(feed([["1", 30], ["2", 20], ["3", 25]]), { maximo: 2, prioridade: (c) => (c === "1" ? 0 : 100) });
  ok("teto de 3000 escolhe pela nota estimada, depois fotos", ids(sel.xml).join(",") === "2,3", ids(sel.xml).join(","));
  const feats = ajustarPadrao(base.replace("<Feature>Maids Quarters</Feature>", "<Feature>Veranda</Feature>\n          <Feature>Balcony</Feature>\n          <Feature>Exterior View</Feature>\n          <Feature>Security Guard on Duty</Feature>")).bloco;
  ok("Features: Veranda vira Balcony sem repetir, Exterior View sai, vigilância vira Patrol", (feats.match(/<Feature>Balcony<\/Feature>/g) || []).length === 1 && !feats.includes("Exterior View") && feats.includes("<Feature>Patrol</Feature>") && !feats.includes("Veranda"), feats);
  const semBairro = ajustarPadrao(base, { bairro: "Centro" }).bloco;
  ok("bairro do XML anterior quando o Vista não manda", semBairro.includes("<Neighborhood><![CDATA[Centro]]></Neighborhood>"), semBairro);
  ok("bairro do Vista fica", !ajustarPadrao(base.replace("</Location>", "  <Neighborhood><![CDATA[Vila A]]></Neighborhood>\n      </Location>"), { bairro: "Centro" }).bloco.includes("Centro"));
  const err = errosObrigatorios(base);
  ok("obrigatórios: área útil, banheiros, CEP e bairro apontados", ["área útil", "banheiros", "CEP", "bairro"].every((e) => err.includes(e)) && !err.includes("preço de venda"), err.join(", "));
  ok("área útil e bairro que o gerador completa não contam como erro", !errosObrigatorios(base, { area_util: 50, bairro: "X" }).includes("área útil") && !errosObrigatorios(base, { area_util: 50, bairro: "X" }).includes("bairro"));
  const cab = `<?xml version="1.0"?>\n<ListingDataFeed>\n  <Listings>\n    <Header>\n      <Provider>Vista</Provider>\n    </Header>\n    `;
  ok("Header sai de dentro de Listings (como na documentação)", headerForaDeListings(cab) === `<?xml version="1.0"?>\n<ListingDataFeed>\n  <Header>\n    <Provider>Vista</Provider>\n  </Header>\n  <Listings>\n    `, JSON.stringify(headerForaDeListings(cab)));
  ok("feed: Header antes de Listings e XML ainda separável", /<\/Header>\s*<Listings>/.test(enriquecerFeed(feed([["901", 8]])).xml) && separar(enriquecerFeed(feed([["901", 8]])).xml).blocos.length === 1);
  const api = dadosDaApi({ Numero: "120", Complemento: "Apto 3 [B]", AreaPrivativa: "85,5", BanheiroSocialQtd: "2", AnoConstrucao: "2015", ValorIptu: "1200.40", Bairro: " Cambuí ", CEP: "13025000", Latitude: "-22.9", Longitude: "-47.05" });
  ok("API do Vista: campos lidos e limpos", api.numero === "120" && api.complemento === "Apto 3 B" && api.area_util === 86 && api.banheiros === 2 && api.ano === 2015 && api.iptu === 1200 && api.bairro === "Cambuí" && api.cep === "13025-000" && api.lat === -22.9, JSON.stringify(api));
  ok("API do Vista: lixo fica de fora", Object.keys(dadosDaApi({ Numero: "S/N", AreaPrivativa: "0", BanheiroSocialQtd: "0", AnoConstrucao: "0", ValorIptu: "0.01", CEP: "00000000", Latitude: "0", Longitude: "0" })).length === 0);
  const comApi = ajustarPadrao(base, { ...ant["900"], ...api }).bloco;
  ok("dados da API têm preferência sobre o XML anterior e o padrão", comApi.includes("<YearBuilt>2015</YearBuilt>") && comApi.includes('<Iptu currency="BRL" period="Yearly">1200</Iptu>') && comApi.includes("<StreetNumber>120</StreetNumber>") && comApi.includes('<LivingArea unit="square metres">86</LivingArea>'), comApi);
  ok("banheiros, CEP e bairro da API entram", comApi.includes("<Bathrooms>2</Bathrooms>") && comApi.includes("<PostalCode>13025-000</PostalCode>") && comApi.includes("Cambuí"));
  ok("com os dados da API o anúncio deixa de ser recusado", errosObrigatorios(base, api).length === 0, errosObrigatorios(base, api).join(","));
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
ok("chavesnamao.xml, imovelweb.xml e saude.json gravados ao lado", ["chavesnamao.xml", "imovelweb.xml", "saude.json"].every((f) => existsSync(join(dir, "a", f)))
  && JSON.parse(readFileSync(join(dir, "a", "saude.json"), "utf8")).numeros.anuncios === 120);
{
  const x = readFileSync(s1, "utf8");
  const links = [...x.matchAll(/<VirtualTourLink>([^<]+)<\/VirtualTourLink>/g)].map((m) => m[1]);
  const semArquivo = links.filter((l) => !existsSync(join(dir, "a", "tour", "d", `${new URL(l).searchParams.get("c")}.json`)));
  ok("tour: todo link do XML aponta para dados gravados", links.length > 0 && semArquivo.length === 0, `${links.length} links, ${semArquivo.length} sem arquivo`);
  const s5 = join(dir, "e", "vrsync.xml");
  rodar({ XML_FALSO: arquivo(feed(muitos)), CODIGOS_FALSOS: JSON.stringify(codigos), TOUR_BASE: "desligado" }, s5);
  const yt = "https://www.youtube.com/watch?v=DlYDTuoHf3k";
  ok("vídeo padrão em todo anúncio", (x.match(/<Item medium="video">/g) || []).length === 120 && x.includes(`<Item medium="video">${yt}</Item>`));
  ok("TOUR_BASE=desligado: sem tour", existsSync(s5) && !readFileSync(s5, "utf8").includes("<VirtualTourLink>") && !existsSync(join(dir, "e", "tour")));
}

{
  // Tour 360: pasta do corretor com uma foto 360 para o 10000.
  const fotos = join(dir, "tours360");
  mkdirSync(join(fotos, "10000"), { recursive: true });
  writeFileSync(join(fotos, "10000", "1-sala.jpg"), jpeg(400, 200));
  const s7 = join(dir, "g", "vrsync.xml");
  rodar({ XML_FALSO: arquivo(feed(muitos)), CODIGOS_FALSOS: JSON.stringify(codigos), TOURS360_DIR: fotos }, s7);
  const x7 = existsSync(s7) ? readFileSync(s7, "utf8") : "";
  ok("tour 360 entra no anúncio no lugar do tour de fotos", x7.includes("tour360/?c=10000") && !x7.includes("jazz-xml/tour/?c=10000") && x7.includes("jazz-xml/tour/?c=10001"));
  ok("tour 360: dados e foto publicados ao lado", existsSync(join(dir, "g", "tour360", "d", "10000.json")) && existsSync(join(dir, "g", "tour360", "f", "10000", "1.jpg")));
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
