/**
 * XML do ImovelWeb (Navent: ImovelWeb, Wimoveis, Casa Mineira), formato
 * OpenNavent, gerado a partir do XML VRSync JÁ ENRIQUECIDO.
 *
 * A Navent não publica a especificação; o formato segue um integrador
 * homologado de código aberto (plugin "UQBITZ Hub de Integração
 * Imobiliária", wordpress.org/plugins/uqbitz-hub-imoveis): raiz
 * <OpenNavent>, dataModificacao em milissegundos, tipo/subtipo numéricos,
 * localidade "Bairro,Cidade,Estado,Brasil", preços VENTA/ALQUILER (nunca
 * zero), características por código (CFT*, 10xxx área comum, 20xxx área
 * privativa), até 50 fotos e vídeo do YouTube pelo código.
 *
 * O portal só aceita o arquivo de uma imobiliária cadastrada: o código da
 * Jazz no ImovelWeb vai em IMOVELWEB_CODIGO (variável do repositório).
 */

const MAX_FOTOS = 50;
const ESTADOS = { AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia", CE: "Ceará", DF: "Distrito Federal",
  ES: "Espírito Santo", GO: "Goiás", MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais", PA: "Pará",
  PB: "Paraíba", PR: "Paraná", PE: "Pernambuco", PI: "Piauí", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte", RS: "Rio Grande do Sul",
  RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina", SP: "São Paulo", SE: "Sergipe", TO: "Tocantins" };

// Tipo VRSync → [idTipo, idSubTipo, tipo (categoria raiz)].
const TIPOS = {
  "Residential / Home": ["1", "5", "Casa"],
  "Residential / Sobrado": ["1", "33", "Casa"],
  "Residential / Condo": ["1", "6", "Casa"],
  "Residential / Apartment": ["2", "1", "Apartamento"],
  "Residential / Penthouse": ["2", "26", "Apartamento"],
  "Residential / Flat": ["2", "4", "Apartamento"],
  "Residential / Studio": ["2", "2", "Apartamento"],
  "Residential / Kitnet": ["2", "2", "Apartamento"],
  "Residential / Land Lot": ["1003", "8", "Terreno"],
  "Residential / Agricultural": ["1004", "10", "Rural"],
  "Residential / Farm Ranch": ["1004", "12", "Rural"],
  "Commercial / Office": ["1005", "16", "Comercial"],
  "Commercial / Industrial": ["1005", "20", "Comercial"],
  "Commercial / Warehouse": ["1005", "20", "Comercial"],
  "Commercial / Building": ["1005", "15", "Comercial"],
  "Commercial / Edificio Comercial": ["1005", "15", "Comercial"],
  "Commercial / Land Lot": ["1005", "32", "Comercial"],
  "Commercial / Business": ["1005", "31", "Comercial"],
  "Commercial / Home": ["1005", "17", "Comercial"],
};
// Subtipos em condomínio: lazer e segurança vão como área comum.
const EM_CONDOMINIO = new Set(["1/6", "2/1", "2/2", "2/4", "2/26", "1003/9"]);

// Característica VRSync → [código em condomínio, código no imóvel, nome].
const CARACTERISTICAS = {
  "Cooling": [null, 20012, "AR_CONDICIONADO"],
  "BBQ": [10048, 20048, "CHURRASQUEIRA"],
  "Barbecue Balcony": [null, 20199, "VARANDA"],
  "Home Office": [null, 20077, "ESCRITÓRIO"],
  "Gourmet Area": [10080, 20080, "ESPAÇO_GOURMET"],
  "Garden Area": [null, 20110, "JARDIM"],
  "Fireplace": [null, 20114, "LAREIRA"],
  "Laundry": [null, 20117, "LAVANDERIA"],
  "Furnished": [null, 20126, "MOBILIADO"],
  "Pets Allowed": [null, 20135, "PERMITE_ANIMAIS"],
  "Pool": [30025, 20140, "PISCINA"],
  "Playground": [10152, 20152, "PLAYGROUND"],
  "Backyard": [null, 20166, "QUINTAL"],
  "Balcony": [null, 20199, "VARANDA"],
  "Maid's Quarters": [null, 20062, "DEPENDÊNCIA_DE_EMPREGADOS"],
  "Heating": [null, 20011, "AQUECIMENTO_CENTRAL"],
  "Elevator": [10071, 10071, "ELEVADOR"],
  "Party Room": [10181, 10181, "SALÃO_DE_FESTAS"],
  "Game room": [10182, 10182, "SALÃO_DE_JOGOS"],
  "Sauna": [10183, 10183, "SAUNA"],
  "Spa": [10189, 10189, "SPA"],
  "Sports Court": [10165, 10165, "QUADRA_POLIESPORTIVA"],
  "Tennis court": [10164, 10164, "QUADRA_DE_TÊNIS"],
};

const ESCAPES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };
const desescapar = (t) => t.replace(/&(amp|lt|gt|quot|apos);/g, (e) => ESCAPES[e]);
const cdata = (t) => `<![CDATA[${String(t ?? "").replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
function valor(bloco, tag) {
  const m = bloco.match(new RegExp(`<${tag}(?:\\s[^>]*)?>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*</${tag}>`));
  return m ? desescapar(m[1].trim()) : "";
}
const atributo = (bloco, tag, attr) => (bloco.match(new RegExp(`<${tag}\\b[^>]*\\b${attr}="([^"]*)"`)) || [])[1] || "";
const inteiro = (v) => (v !== "" && Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : null);
const semVirgula = (t) => String(t || "").replace(/,/g, " ").replace(/\s+/g, " ").trim();
const codigoYoutube = (u) => (String(u).match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/) || [])[1] || "";

function cortarTitulo(t, max = 80) {
  if (t.length <= max) return t;
  const c = t.slice(0, max + 1);
  return c.slice(0, c.lastIndexOf(" ") > 40 ? c.lastIndexOf(" ") : max).replace(/[\s,;:–-]+$/, "");
}

/** Um <Listing> VRSync → dados do <Imovel> OpenNavent; null se faltar obrigatório. */
export function imovelImovelWeb(bloco, { ano = new Date().getFullYear() } = {}) {
  const tipoVr = valor(bloco, "PropertyType");
  const [idTipo, idSubTipo, tipo] = TIPOS[tipoVr] || (/^Commercial/.test(tipoVr) ? ["1005", "16", "Comercial"] : ["1", "5", "Casa"]);
  const condominio = inteiro(valor(bloco, "PropertyAdministrationFee"));
  let sub = idSubTipo;
  if (idTipo === "1003" && condominio) sub = "9"; // loteamento / condomínio

  const transacao = valor(bloco, "TransactionType");
  const precos = [];
  const venda = inteiro(valor(bloco, "ListPrice")), aluguel = inteiro(valor(bloco, "RentalPrice"));
  if (/For Sale|Sale\/Rent/.test(transacao) && venda) precos.push(["VENTA", venda]);
  if (/For Rent|Sale\/Rent/.test(transacao) && aluguel) precos.push(["ALQUILER", aluguel]);

  const uf = atributo(bloco, "State", "abbreviation") || valor(bloco, "State");
  const estado = ESTADOS[uf.toUpperCase()] || semVirgula(valor(bloco, "State"));
  const cidade = semVirgula(valor(bloco, "City"));
  const bairro = semVirgula(valor(bloco, "Neighborhood"));
  const areaUtil = inteiro(valor(bloco, "LivingArea"));
  const areaTotal = inteiro(valor(bloco, "LotArea"));
  const util = areaUtil || areaTotal;

  // Obrigatórios do portal (o integrador homologado pula quem não tem).
  if (!precos.length || !estado || !cidade || !util) return null;
  if (EM_CONDOMINIO.has(`${idTipo}/${sub}`) && idTipo !== "1003" && !condominio) return null;

  const rua = valor(bloco, "Address");
  const numero = valor(bloco, "StreetNumber");
  const complemento = valor(bloco, "Complement");
  let endereco = rua;
  if (numero) endereco += `, ${numero}`;
  if (complemento) endereco += ` - ${complemento}`;

  const fotos = [];
  for (const m of bloco.matchAll(/<Item\b([^>]*)>([^<]+)<\/Item>/g)) {
    const url = desescapar(m[2].trim());
    if (/medium="image"/.test(m[1]) && /^https?:\/\//.test(url)) (/primary="true"/.test(m[1]) ? fotos.unshift(url) : fotos.push(url));
  }
  const video = codigoYoutube((bloco.match(/<Item\b[^>]*medium="video"[^>]*>([^<]+)<\/Item>/) || [])[1] || "");

  const cft = [];
  const num = (id, nome, v) => { if (v != null) cft.push({ id, nome, valor: v }); };
  num("CFT2", "PRINCIPALES|QUARTO", inteiro(valor(bloco, "Bedrooms")));
  num("CFT4", "PRINCIPALES|SUITE", inteiro(valor(bloco, "Suites")));
  num("CFT3", "PRINCIPALES|BANHEIRO", inteiro(valor(bloco, "Bathrooms")));
  num("CFT7", "PRINCIPALES|VAGA", inteiro(valor(bloco, "Garage")));
  num("CFT101", "MEDIDAS|AREA_UTIL", util);
  num("CFT100", "MEDIDAS|AREA_TOTAL", areaTotal || util);
  cft.push({ id: "CON1", nome: "MEDIDAS|UNIDAD_DE_MEDIDA", idValor: "M2" });
  num("CFT400", "PRINCIPALES|IPTU", inteiro(valor(bloco, "Iptu") || valor(bloco, "YearlyTax")));
  num("CFT6", "PRINCIPALES|CONDOMINIO", condominio);
  const construido = inteiro(valor(bloco, "YearBuilt"));
  if (construido && construido <= ano) cft.push({ id: "CFT5", nome: "PRINCIPALES|IDADE", valor: ano - construido });

  const emCondominio = EM_CONDOMINIO.has(`${idTipo}/${sub}`);
  const vistos = new Set();
  for (const m of bloco.matchAll(/<Feature>([^<]+)<\/Feature>/g)) {
    const par = CARACTERISTICAS[desescapar(m[1].trim())];
    if (!par) continue;
    const id = (emCondominio ? par[0] : par[1]) ?? par[1] ?? par[0];
    if (!id || vistos.has(id)) continue;
    vistos.add(id);
    cft.push({ id: String(id), nome: `${id >= 20000 && id < 30000 ? "AREA_PRIVATIVA" : id >= 10000 && id < 20000 ? "AREAS_COMUNS" : "AGRUPADA"}|${par[2]}` });
  }

  return {
    codigo: valor(bloco, "ListingID"), idTipo, idSubTipo: sub, tipo,
    titulo: cortarTitulo(valor(bloco, "Title")), descricao: valor(bloco, "Description").slice(0, 4000),
    precos, endereco, localidade: [bairro, cidade, estado, "Brasil"].filter(Boolean).join(","),
    cep: valor(bloco, "PostalCode"), fotos: [...new Set(fotos)].slice(0, MAX_FOTOS), video, caracteristicas: cft,
  };
}

function imovelXml(d, publicador) {
  const L = [];
  L.push("    <Imovel>");
  L.push(`      <codigoAnuncio>${cdata(d.codigo)}</codigoAnuncio>`);
  L.push(`      <codigoReferencia>${cdata(d.codigo)}</codigoReferencia>`);
  L.push(`      <tipoPropriedade>\n        <idTipo>${cdata(d.idTipo)}</idTipo>\n        <idSubTipo>${cdata(d.idSubTipo)}</idSubTipo>\n        <tipo>${cdata(d.tipo)}</tipo>\n      </tipoPropriedade>`);
  L.push(`      <titulo>${cdata(d.titulo)}</titulo>`);
  L.push(`      <descricao>${cdata(d.descricao)}</descricao>`);
  L.push("      <precos>");
  for (const [op, q] of d.precos) L.push(`        <preco>\n          <quantidade>${cdata(q)}</quantidade>\n          <moeda>${cdata("BRL")}</moeda>\n          <operacao>${cdata(op)}</operacao>\n        </preco>`);
  L.push("      </precos>");
  L.push(`      <publicacao>\n        <tipoPublicacao>${cdata("SIMPLE")}</tipoPublicacao>\n      </publicacao>`);
  L.push("      <publicador>");
  L.push(`        <codigoImobiliaria>${cdata(publicador.codigo)}</codigoImobiliaria>`);
  if (publicador.email) L.push(`        <emailContato>${cdata(publicador.email)}</emailContato>`);
  if (publicador.nome) L.push(`        <nomeContato>${cdata(publicador.nome)}</nomeContato>`);
  L.push("      </publicador>");
  L.push("      <localizacao>");
  L.push(`        <endereco>${cdata(d.endereco)}</endereco>`);
  L.push(`        <localidade>${cdata(d.localidade)}</localidade>`);
  if (d.cep) L.push(`        <codigoPostal>${cdata(d.cep)}</codigoPostal>`);
  L.push(`        <mostrarMapa>${cdata("APROXIMADO")}</mostrarMapa>`);
  L.push("      </localizacao>");
  if (d.fotos.length || d.video) {
    L.push("      <multimidia>");
    if (d.fotos.length) {
      L.push("        <imagens>");
      for (const u of d.fotos) L.push(`          <imagem>\n            <urlImagem>${cdata(u)}</urlImagem>\n          </imagem>`);
      L.push("        </imagens>");
    }
    if (d.video) L.push(`        <videos>\n          <video>\n            <codigoVideo>${cdata(d.video)}</codigoVideo>\n            <titulo>${cdata(d.titulo)}</titulo>\n          </video>\n        </videos>`);
    L.push("      </multimidia>");
  }
  L.push("      <caracteristicas>");
  for (const c of d.caracteristicas) {
    const v = c.valor != null ? `<valor>${cdata(c.valor)}</valor>` : c.idValor ? `<idValor>${cdata(c.idValor)}</idValor>` : "";
    L.push(`        <caracteristica><id>${cdata(c.id)}</id><nome>${cdata(c.nome)}</nome>${v}</caracteristica>`);
  }
  L.push("      </caracteristicas>");
  L.push("    </Imovel>");
  return L.join("\n");
}

/** XML VRSync (enriquecido) → XML OpenNavent do ImovelWeb. */
export function paraImovelWeb(xmlVrsync, { codigoImobiliaria = "", email = "", nome = "", agora = new Date() } = {}) {
  const imoveis = [];
  let fora = 0;
  for (const [bloco] of xmlVrsync.matchAll(/<Listing>[\s\S]*?<\/Listing>/g)) {
    const d = imovelImovelWeb(bloco, { ano: agora.getFullYear() });
    if (!d) { fora++; continue; }
    imoveis.push(imovelXml(d, { codigo: codigoImobiliaria, email: email || valor(bloco, "Email"), nome: nome || valor(bloco, "Name") }));
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<OpenNavent>\n  <dataModificacao>${cdata(String(agora.getTime()))}</dataModificacao>\n  <Imoveis>\n${imoveis.join("\n")}\n  </Imoveis>\n</OpenNavent>\n`;
  return { xml, total: imoveis.length, fora };
}
