/**
 * XML do portal Chaves na Mão, gerado a partir do XML VRSync JÁ ENRIQUECIDO
 * (o mesmo dos portais do Grupo ZAP): o enriquecimento vale para todos os
 * portais e cada portal só ganha a sua "tradução" de formato.
 *
 * Formato oficial: https://tecnologiacnm.github.io/cnm-xml-documentation/
 *  - raiz <Document><imoveis><imovel>, UTF-8, TODAS as tags presentes
 *    (vazias quando não houver dado), nomes sensíveis a maiúsculas;
 *  - tipos e itens de área comum/privativa só das listas do portal
 *    (chavesnamao.com.br/imoveis/integracao/areas_comuns e areas_privativas);
 *  - até 30 fotos (o resto é ignorado pelo portal);
 *  - tour_360 só recebe tour 360 de verdade (tour360/), nunca o tour de
 *    fotos comuns.
 * O portal lê o arquivo uma vez por dia.
 */

const MAX_FOTOS = 30;

const TAGS = [
  "referencia", "codigo_cliente", "link_cliente", "titulo", "transacao", "transacao2", "finalidade", "finalidade2",
  "destaque", "tipo", "tipo2", "valor", "valor_locacao", "valor_iptu", "valor_condominio", "area_total", "area_util",
  "conservacao", "quartos", "suites", "garagem", "banheiro", "closet", "salas", "despensa", "bar", "cozinha",
  "quarto_empregada", "escritorio", "area_servico", "lareira", "varanda", "lavanderia", "aceita_pet", "estado",
  "cidade", "bairro", "cep", "endereco", "numero", "complemento", "esconder_endereco_imovel", "descritivo",
  "fotos_imovel", "data_atualizacao", "latitude", "longitude", "video", "tour_360", "area_comum", "area_privativa",
  "aceita_troca", "periodo_locacao",
];

// Tipo VRSync → [finalidade, tipo do Chaves na Mão].
const TIPOS = {
  "Residential / Home": ["RE", "Casa / Sobrado"],
  "Residential / Sobrado": ["RE", "Casa / Sobrado"],
  "Residential / Condo": ["RE", "Casa / Sobrado em Condomínio"],
  "Residential / Apartment": ["RE", "Apartamento"],
  "Residential / Penthouse": ["RE", "Cobertura"],
  "Residential / Flat": ["RE", "Flat"],
  "Residential / Studio": ["RE", "Kitnet / Stúdio"],
  "Residential / Kitnet": ["RE", "Kitnet / Stúdio"],
  "Residential / Land Lot": ["RE", "Terreno / Lote"],
  "Residential / Agricultural": ["RE", "Sítio / Chácara"],
  "Residential / Farm Ranch": ["RE", "Sítio / Chácara"],
  "Commercial / Office": ["CO", "Conj. Comercial / Sala"],
  "Commercial / Industrial": ["CO", "Galpão / Depósito"],
  "Commercial / Warehouse": ["CO", "Galpão / Depósito"],
  "Commercial / Building": ["CO", "Prédio"],
  "Commercial / Edificio Comercial": ["CO", "Prédio"],
  "Commercial / Land Lot": ["CO", "Terreno comercial"],
  "Commercial / Business": ["CO", "Ponto Comercial"],
  "Commercial / Home": ["CO", "Casa / Sobrado Comercial"],
  "Commercial / Agricultural": ["CO", "Fazenda"],
};

// Tipos em que lazer e segurança são do condomínio (área comum).
const EM_CONDOMINIO = new Set(["Apartamento", "Cobertura", "Flat", "Kitnet / Stúdio", "Casa / Sobrado em Condomínio",
  "Terreno em Condomínio", "Conj. Comercial / Sala", "Prédio"]);

// Característica VRSync → item do Chaves na Mão: [área comum, área privativa].
// null = não existe naquela lista; a escolha depende do tipo (acima).
const CARACTERISTICAS = {
  "Party Room": ["Salão de festas", "Salão de festas privativo"],
  "Playground": ["Playground", "Playground"],
  "Pool": ["Piscina", "Piscina"],
  "Elevator": ["Elevador(es)", "Elevador(es)"],
  "Sports Court": ["Quadra poliesportiva", "Quadra esportiva"],
  "Game room": ["Salão de jogos", "Sala de jogos"],
  "Controlled Access": ["Portaria", null],
  "Intercom": ["Interfone", null],
  "Gourmet Area": ["Espaço gourmet", "Espaço gourmet"],
  "Tennis court": ["Quadra de tênis", "Quadra de tênis"],
  "Patrol": ["Ronda/Vigilância", null],
  "Sauna": ["Sauna", "Sauna"],
  "Spa": ["Spa", "Spa"],
  "Garden Area": ["Jardim", "Jardim"],
  "Generator": ["Gerador de energia", "Gerador"],
  "Ocean View": ["Vista para o mar", "Vista para o mar"],
  "Maid's Quarters": [null, "Dependência de empregada"],
  "Balcony": [null, "Sacada"],
  "BBQ": ["Churrasqueira coletiva", "Churrasqueira"],
  "Backyard": [null, "Quintal"],
  "Cooling": [null, "Ar Condicionado"],
  "Barbecue Balcony": [null, "Varanda com churrasqueira"],
  "Home Office": [null, "Escritório"],
  "Kitchen": [null, "Cozinha"],
  "Furnished": [null, "Mobiliado"],
  "Laundry": [null, "Lavanderia"],
  "Fireplace": [null, "Lareira"],
  "Heating": [null, "Sistema de aquecimento"],
  "Warehouse": [null, "Depósito"],
  "Pets Allowed": [null, "Aceita Pet"],
  "Fenced Yard": [null, "Murado"],
};
// Itens que são sempre do imóvel, mesmo em condomínio.
const SEMPRE_PRIVATIVO = new Set(["Maid's Quarters", "Balcony", "Backyard", "Cooling", "Barbecue Balcony", "Home Office",
  "Kitchen", "Furnished", "Laundry", "Fireplace", "Heating", "Warehouse", "Pets Allowed", "Fenced Yard"]);

const ESCAPES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };
const desescapar = (t) => t.replace(/&(amp|lt|gt|quot|apos);/g, (e) => ESCAPES[e]);
const escapar = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const cdata = (t) => `<![CDATA[${String(t).replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;

function valor(bloco, tag) {
  const m = bloco.match(new RegExp(`<${tag}(?:\\s[^>]*)?>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*</${tag}>`));
  return m ? desescapar(m[1].trim()) : "";
}
const atributo = (bloco, tag, attr) => (bloco.match(new RegExp(`<${tag}\\b[^>]*\\b${attr}="([^"]*)"`)) || [])[1] || "";
const numero = (v) => (v !== "" && Number.isFinite(Number(v)) && Number(v) > 0 ? String(Number(v)) : "");

/** Um <Listing> VRSync → campos do <imovel> do Chaves na Mão. */
export function imovelChavesNaMao(bloco) {
  const c = {};
  const codigo = valor(bloco, "ListingID");
  c.referencia = codigo;
  c.codigo_cliente = codigo;
  c.titulo = valor(bloco, "Title").slice(0, 200);

  const transacao = valor(bloco, "TransactionType");
  const venda = numero(valor(bloco, "ListPrice"));
  const aluguel = numero(valor(bloco, "RentalPrice"));
  if (transacao === "For Rent") { c.transacao = "L"; c.valor = aluguel; c.periodo_locacao = "1"; }
  else if (transacao === "Sale/Rent") { c.transacao = "V"; c.transacao2 = "L"; c.valor = venda; c.valor_locacao = aluguel; c.periodo_locacao = "1"; }
  else { c.transacao = "V"; c.valor = venda; }

  const tipoVr = valor(bloco, "PropertyType");
  let [finalidade, tipo] = TIPOS[tipoVr] || [/^Commercial/.test(tipoVr) ? "CO" : "RE", /^Commercial/.test(tipoVr) ? "Casa / Sobrado Comercial" : "Casa / Sobrado"];
  const condominio = numero(valor(bloco, "PropertyAdministrationFee"));
  if (tipo === "Terreno / Lote" && condominio) tipo = "Terreno em Condomínio";
  c.finalidade = finalidade;
  c.tipo = tipo;
  c.destaque = "0";

  c.valor_iptu = numero(valor(bloco, "Iptu") || valor(bloco, "YearlyTax"));
  c.valor_condominio = condominio;
  c.area_total = numero(valor(bloco, "LotArea"));
  c.area_util = numero(valor(bloco, "LivingArea"));
  c.quartos = numero(valor(bloco, "Bedrooms"));
  c.suites = numero(valor(bloco, "Suites"));
  c.garagem = numero(valor(bloco, "Garage"));
  c.banheiro = numero(valor(bloco, "Bathrooms"));

  const caracteristicas = [...bloco.matchAll(/<Feature>([^<]+)<\/Feature>/g)].map((m) => desescapar(m[1].trim()));
  const tem = (f) => caracteristicas.includes(f);
  if (tem("Fireplace")) c.lareira = "1";
  if (tem("Balcony") || tem("Barbecue Balcony")) c.varanda = "1";
  if (tem("Laundry")) c.lavanderia = "1";
  if (tem("Home Office")) c.escritorio = "1";
  if (tem("Maid's Quarters")) c.quarto_empregada = "1";
  if (tem("Kitchen")) c.cozinha = "1";
  if (tem("Pets Allowed")) c.aceita_pet = "1";
  const emCondominio = EM_CONDOMINIO.has(tipo);
  const comum = new Set(), privativa = new Set();
  for (const f of caracteristicas) {
    const par = CARACTERISTICAS[f];
    if (!par) continue;
    const [noCondominio, noImovel] = par;
    if (emCondominio && !SEMPRE_PRIVATIVO.has(f) && noCondominio) comum.add(noCondominio);
    else if (noImovel) privativa.add(noImovel);
    else if (noCondominio) comum.add(noCondominio);
  }
  c.area_comum = [...comum];
  c.area_privativa = [...privativa];

  c.estado = atributo(bloco, "State", "abbreviation") || valor(bloco, "State").slice(0, 2).toUpperCase();
  c.cidade = valor(bloco, "City");
  c.bairro = valor(bloco, "Neighborhood");
  c.cep = valor(bloco, "PostalCode").replace(/\D/g, "").slice(0, 8);
  c.endereco = valor(bloco, "Address").slice(0, 200);
  c.numero = valor(bloco, "StreetNumber").slice(0, 10);
  c.complemento = valor(bloco, "Complement").slice(0, 20);
  c.esconder_endereco_imovel = atributo(bloco, "Location", "displayAddress") === "All" ? "0" : "1";
  c.descritivo = valor(bloco, "Description").slice(0, 3000);
  c.latitude = valor(bloco, "Latitude");
  c.longitude = valor(bloco, "Longitude");

  const fotos = [];
  for (const m of bloco.matchAll(/<Item\b([^>]*)>([^<]+)<\/Item>/g)) {
    const url = desescapar(m[2].trim());
    if (/medium="image"/.test(m[1]) && /^https?:\/\//.test(url)) {
      if (/primary="true"/.test(m[1])) fotos.unshift(url);
      else fotos.push(url);
    }
  }
  c.fotos = [...new Set(fotos)].slice(0, MAX_FOTOS);
  const video = (bloco.match(/<Item\b[^>]*medium="video"[^>]*>([^<]+)<\/Item>/) || [])[1];
  c.video = video ? desescapar(video.trim()) : "";
  const tour = valor(bloco, "VirtualTourLink");
  c.tour_360 = /\/tour360\//.test(tour) ? tour : "";
  return c;
}

function tagXml(nome, c, ind) {
  if (nome === "descritivo") return `${ind}<descritivo>${cdata(c.descritivo || "")}</descritivo>`;
  if (nome === "titulo") return `${ind}<titulo>${cdata(c.titulo || "")}</titulo>`;
  if (nome === "fotos_imovel") {
    const fotos = c.fotos.map((u) => `${ind}  <foto>\n${ind}    <url>${escapar(u)}</url>\n${ind}    <data_atualizacao></data_atualizacao>\n${ind}  </foto>`);
    return fotos.length ? `${ind}<fotos_imovel>\n${fotos.join("\n")}\n${ind}</fotos_imovel>` : `${ind}<fotos_imovel></fotos_imovel>`;
  }
  if (nome === "area_comum" || nome === "area_privativa") {
    const itens = c[nome].map((i) => `${ind}  <item>${escapar(i)}</item>`);
    return itens.length ? `${ind}<${nome}>\n${itens.join("\n")}\n${ind}</${nome}>` : `${ind}<${nome}></${nome}>`;
  }
  return `${ind}<${nome}>${escapar(c[nome] ?? "")}</${nome}>`;
}

/** XML VRSync (enriquecido) → XML do Chaves na Mão, com todas as tags em todo imóvel. */
export function paraChavesNaMao(xmlVrsync) {
  const imoveis = [];
  for (const [bloco] of xmlVrsync.matchAll(/<Listing>[\s\S]*?<\/Listing>/g)) {
    const c = imovelChavesNaMao(bloco);
    if (!c.referencia || !c.valor || !c.estado || !c.cidade || !c.bairro || !c.descritivo) continue; // obrigatórios
    imoveis.push(`    <imovel>\n${TAGS.map((t) => tagXml(t, c, "      ")).join("\n")}\n    </imovel>`);
  }
  return { xml: `<?xml version="1.0" encoding="UTF-8"?>\n<Document>\n  <imoveis>\n${imoveis.join("\n")}\n  </imoveis>\n</Document>\n`, total: imoveis.length };
}
