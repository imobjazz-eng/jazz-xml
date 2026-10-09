/**
 * Enriquecimento dos anúncios — título, descrição e coordenadas.
 *
 * DE ONDE VEM. Replica as regras do feed antigo (`smart-feed-nativo` na
 * Supabase): o "conteúdo otimizado" de lá era higiene por regra, não texto
 * gerado. Aqui as mesmas regras, com estas melhorias:
 *
 *  - Descrição: não apaga frases do corretor por conter "excelente
 *    oportunidade" (o feed antigo apagava; perdia a abertura de muitos
 *    anúncios). Jargão só sai do título, onde o espaço é curto.
 *  - Contato (telefone, e-mail, site) sai com a frase inteira, não só o
 *    número ("ligue para  e agende" ficava sem sentido).
 *  - Texto todo em maiúsculas vira frase normal, preservando siglas e UF.
 *  - "&amp;" que o Vista grava dentro do CDATA aparecia literal no portal.
 *  - A ficha que completa descrição curta usa só campos do próprio anúncio,
 *    sem parágrafo padrão repetido em todos os anúncios.
 *  - Coordenada fora do estado (o Vista grava o centro do Brasil quando o
 *    corretor não marca o mapa) é descartada e o endereço é geocodificado.
 *
 * NADA É INVENTADO: só reorganiza o que o anúncio já informa. Sem rede aqui.
 */
import { separar } from "./espelho.mjs";

export const TITULO_MAX = 100;
export const TITULO_MIN = 10;
export const DESCRICAO_MAX = 3000;
/** Abaixo disso a descrição ganha a ficha do imóvel (regra do feed antigo). */
export const DESCRICAO_CURTA = 900;

// Estado de São Paulo (regra do feed antigo).
const SP = { latMin: -25.35, latMax: -19.75, lonMin: -53.35, lonMax: -44 };

const RE_EMOJI = /[\u{1F000}-\u{1FFFF}\u{2190}-\u{2BFF}\u{FE0F}\u{2600}-\u{27BF}]/gu;
const RE_FONE = /(?:\+?55[\s.-]?)?\(?\d{2}\)?[\s.-]?9?[\s.-]?\d{4}[\s.-]?\d{4}/;
const RE_URL = /https?:\/\/\S+|www\.\S+/i;
const RE_EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;
const RE_CONTATO = new RegExp(`${RE_FONE.source}|${RE_URL.source}|${RE_EMAIL.source}`, "i");
const MAIUSCULA = "A-ZÁÉÍÓÚÂÊÔÃÕÇÀÜ";
const RE_PALAVRA_CAIXA_ALTA = new RegExp(`\\b[${MAIUSCULA}]{4,}\\b`, "g");

const SIGLAS = new Set(["IPTU", "CRECI", "MCMV", "CDHU", "ITBI", "SPDA", "FGTS", "ABNT", "SESC", "SENAI", "USP", "UNICAMP", "ITA", "INPE", "DCTA", "CTA", "PUC", "BR", "SP", "MG", "RJ", "PR", "SC", "ZEIS", "ZAE", "TV", "LED", "AC", "AT", "AU"]);
const UFS = new Set(["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"]);
const CONECTIVOS = new Set(["a", "à", "ao", "aos", "as", "às", "o", "os", "de", "da", "das", "do", "dos", "e", "em", "na", "nas", "no", "nos", "com", "para", "por", "sem", "sob", "um", "uma"]);

const ABREVIACOES = [
  [/\baptos\b\.?/gi, "apartamentos"],
  [/\bapto\b\.?/gi, "apartamento"],
  [/\bdorms\b\.?/gi, "dormitórios"],
  [/\bdorm\b\.?/gi, "dormitório"],
  [/\bwc\b\.?/gi, "banheiro"],
  [/\bvgs\b\.?/gi, "vagas"],
  [/\bvg\b\.?/gi, "vaga"],
];

const JARGOES = [
  /oportunidade imperd[íi]vel/i,
  /[óo]tima oportunidade/i,
  /excelente oportunidade/i,
  /oportunidade [úu]nica/i,
  /n[ãa]o perca/i,
  /imperd[íi]vel/i,
  /melhor\s+\S{0,20}\s*da cidade/i,
];

const TIPOLOGIA_INICIO = /^(apartamento|casa|sobrado|cobertura|kitnet|kitinete|studio|st[úu]dio|est[úu]dio|flat|terreno|lote|ch[áa]cara|s[íi]tio|fazenda|sala|loja|galp[ãa]o|ponto|pr[ée]dio|edif[íi]cio|pousada|hotel|[áa]rea)\b/i;

/** PropertyType VRSync → nome em português (para ficha e título reserva). */
const TIPOS = {
  "Residential / Apartment": "Apartamento",
  "Residential / Home": "Casa",
  "Residential / Condo": "Casa em condomínio",
  "Residential / Sobrado": "Sobrado",
  "Residential / Penthouse": "Cobertura",
  "Residential / Studio": "Studio",
  "Residential / Kitnet": "Kitnet",
  "Residential / Flat": "Flat",
  "Residential / Land Lot": "Terreno",
  "Residential / Agricultural": "Chácara",
  "Residential / Farm Ranch": "Fazenda",
  "Commercial / Office": "Sala comercial",
  "Commercial / Industrial": "Galpão",
  "Commercial / Building": "Prédio comercial",
  "Commercial / Edificio Comercial": "Prédio comercial",
  "Commercial / Land Lot": "Terreno comercial",
  "Commercial / Business": "Ponto comercial",
};

/**
 * Feature VRSync → português. Ficam de fora as que o Vista marca em massa
 * sem relação com o imóvel (ex.: "Maids Quarters" em 2/3 do acervo).
 */
const DIFERENCIAIS = {
  BBQ: "Churrasqueira",
  Backyard: "Quintal",
  Cooling: "Ar-condicionado",
  "Party Room": "Salão de festas",
  Veranda: "Varanda",
  Playground: "Playground",
  Balcony: "Sacada",
  Pool: "Piscina",
  Elevator: "Elevador",
  "Sports Court": "Quadra poliesportiva",
  "Game room": "Salão de jogos",
  "Garden Area": "Jardim",
  "Controlled Access": "Acesso controlado",
  BarbecueBalcony: "Varanda com churrasqueira",
  Intercom: "Interfone",
  "Gourmet Area": "Espaço gourmet",
  "Home Office": "Escritório",
  "Tennis court": "Quadra de tênis",
  "Security Guard on Duty": "Segurança",
  Furnished: "Mobiliado",
  Sauna: "Sauna",
  Laundry: "Lavanderia",
  "Ocean View": "Vista para o mar",
  Fireplace: "Lareira",
  Heating: "Aquecimento",
  Warehouse: "Depósito",
  Spa: "Spa",
  Generator: "Gerador",
};

const TRANSACAO = { "For Sale": "à venda", "For Rent": "para alugar", "Sale/Rent": "à venda e para alugar" };

// ---------------------------------------------------------------- leitura

function valor(bloco, tag) {
  const m = bloco.match(new RegExp(`<${tag}(?:\\s[^>]*)?>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`));
  return m ? m[1].trim() : null;
}
const numero = (bloco, tag) => {
  const v = Number(valor(bloco, tag));
  return Number.isFinite(v) && v > 0 ? v : null;
};

/** Os campos do anúncio usados pelas regras. */
export function lerAnuncio(bloco) {
  const uf = (bloco.match(/<State[^>]*abbreviation="([A-Z]{2})"/) || [])[1] || null;
  return {
    codigo: valor(bloco, "ListingID"),
    titulo: valor(bloco, "Title") ?? "",
    descricao: valor(bloco, "Description") ?? "",
    transacao: valor(bloco, "TransactionType"),
    tipo: TIPOS[valor(bloco, "PropertyType")] ?? null,
    precoVenda: numero(bloco, "ListPrice"),
    areaUtil: numero(bloco, "LivingArea"),
    areaTotal: numero(bloco, "LotArea"),
    quartos: numero(bloco, "Bedrooms"),
    suites: numero(bloco, "Suites"),
    banheiros: numero(bloco, "Bathrooms"),
    vagas: numero(bloco, "Garage"),
    ano: numero(bloco, "YearBuilt"),
    diferenciais: [...bloco.matchAll(/<Feature>([^<]+)<\/Feature>/g)].map((m) => DIFERENCIAIS[m[1].trim()]).filter(Boolean),
    rua: valor(bloco, "Address") || null,
    bairro: valor(bloco, "Neighborhood") || null,
    cidade: valor(bloco, "City") || null,
    uf,
    estado: valor(bloco, "State") || null,
    lat: Number(valor(bloco, "Latitude")),
    lon: Number(valor(bloco, "Longitude")),
    temCoordenada: /<Latitude>/.test(bloco),
  };
}

// ---------------------------------------------------------------- texto

function decodificarEntidades(t) {
  return t
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/gi, "&");
}

function semHtml(t) {
  return t.replace(/<\s*(br|\/p|p|\/li|li|\/div)\b[^>]*>/gi, "\n").replace(/<\/?[a-z][^>]*>/gi, " ");
}

const ehCaixaAlta = (t, proporcao) => {
  const letras = t.match(/\p{L}/gu) || [];
  if (letras.length < 6) return false;
  return letras.filter((c) => c === c.toUpperCase() && c !== c.toLowerCase()).length / letras.length >= proporcao;
};

/** Palavra isolada em caixa alta vira capitalizada (regra do feed antigo). */
const capitalizarPalavras = (t) =>
  t.replace(RE_PALAVRA_CAIXA_ALTA, (w) => (SIGLAS.has(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()));

// Algarismo romano de nome de condomínio ("Euroville II") fica em maiúsculas.
const ROMANO = /^(?:II|III|IV|VI|VII|VIII|IX|XI|XII)$/;

/** Título todo em maiúsculas → "Casa à Venda - Jardim Tamoio | Campinas/SP". */
function tituloEmCaixaAlta(t) {
  let inicio = true;
  return t.replace(/[\p{L}\d]+/gu, (w, pos) => {
    const anterior = t[pos - 1];
    const primeira = inicio;
    inicio = false;
    if (SIGLAS.has(w) || ROMANO.test(w) || (UFS.has(w) && (anterior === "/" || anterior === "-"))) return w;
    if (/\d/.test(w) || (w === w.toLowerCase() && /\p{L}/u.test(w))) return w; // "ZC2", "m²"
    const minuscula = w.toLowerCase();
    if (!primeira && CONECTIVOS.has(minuscula)) return minuscula;
    return minuscula.charAt(0).toUpperCase() + minuscula.slice(1);
  });
}

/** Linha toda em maiúsculas → frase normal, preservando siglas. */
function linhaEmCaixaAlta(linha) {
  // Linha curta sem ponto final é título de seção: cada palavra capitalizada.
  if (linha.trim().length <= 120 && !/[.!?]\s+\S/.test(linha.trim())) return tituloEmCaixaAlta(linha);
  let t = linha.toLowerCase().replace(/[\p{L}]+/gu, (w) => {
    const W = w.toUpperCase();
    return (SIGLAS.has(W) && w.length <= 5) || ROMANO.test(W) ? W : w;
  });
  t = t.replace(/(^\s*[-–•*]?\s*|[.!?]\s+)(\p{Ll})/gu, (_, a, c) => a + c.toUpperCase());
  return t;
}

// Com número na frente, concorda: "2 dorm" → "2 dormitórios", "1 vg" → "1 vaga".
const ABREVIACOES_CONTADAS = [
  [/\b(\d+)\s*(dorms?)\b\.?/gi, "dormitório", "dormitórios"],
  [/\b(\d+)\s*(vgs?)\b\.?/gi, "vaga", "vagas"],
];

function expandirAbreviacoes(t) {
  for (const [re, um, varios] of ABREVIACOES_CONTADAS) {
    t = t.replace(re, (_, n, abrev) => {
      const sub = Number(n) === 1 ? um : varios;
      return `${n} ${/^\p{Lu}/u.test(abrev) ? sub.charAt(0).toUpperCase() + sub.slice(1) : sub}`;
    });
  }
  for (const [re, sub] of ABREVIACOES) {
    t = t.replace(re, (m) => (/^\p{Lu}/u.test(m) ? sub.charAt(0).toUpperCase() + sub.slice(1) : sub));
  }
  return t;
}

const cdataSeguro = (t) => t.replace(/]]>/g, "]] >");

/** Corta no limite sem deixar palavra pela metade nem conectivo solto. */
function cortar(t, max, separadores = [" - ", " | ", ", ", " "]) {
  if (t.length <= max) return t;
  let corte = t.slice(0, max + 1);
  for (const sep of separadores) {
    const i = corte.lastIndexOf(sep);
    if (i > max * 0.6) { corte = corte.slice(0, i); break; }
  }
  if (corte.length > max) corte = corte.slice(0, max);
  return limparFinal(corte);
}

function limparFinal(t) {
  let antes;
  do {
    antes = t;
    t = t.replace(/[\s,;:\-–|/(]+$/u, "");
    const ultima = t.match(/(\S+)$/);
    if (ultima && CONECTIVOS.has(ultima[1].toLowerCase()) && t.length > ultima[1].length) {
      t = t.slice(0, -ultima[1].length);
    }
  } while (t !== antes);
  return t;
}

// ---------------------------------------------------------------- título

/** Onde termina o "tipo + adjetivos" do título: primeira ligação ou separador. */
const LIGACAO_DEPOIS_DO_TIPO = /\s(?=(?:no|na|nos|nas|em|com|apenas|perto|pr[óo]xim[oa]|a\s\d|\d)\b)|(?=,\s)|\s(?=[-–|]\s)/i;

const RE_JARGAO = new RegExp(JARGOES.map((re) => re.source).join("|"), "i");
const RE_SEPARADOR = /(\s+[|–-]\s+|[!:]\s+)/;

/**
 * Jargão sai do título. Sai a expressão ("Excelente oportunidade de
 * apartamento à venda" → "Apartamento à venda"); chamada depois de separador
 * que fica sem dado ("| Excelente Oportunidade para Investimento") sai inteira.
 */
function semJargao(t) {
  if (!RE_JARGAO.test(t)) return t;
  const partes = t.split(RE_SEPARADOR);
  const saida = [];
  for (let i = 0; i < partes.length; i += 2) {
    let trecho = partes[i];
    if (RE_JARGAO.test(trecho)) {
      trecho = trecho.replace(new RegExp(`(?:${RE_JARGAO.source})[!.]*(?:\\s+(?:de|para|em|no|na)\\b)?`, "gi"), "").trim();
      // Depois de separador, o resto só fica se trouxer dado (metragem, local).
      if (saida.length && !/\d|\b(?:no|na|em)\s+\p{Lu}/u.test(trecho)) continue;
      if (!trecho) continue;
    }
    if (saida.length) saida.push(partes[i - 1]);
    saida.push(trecho);
  }
  const r = saida.join("").replace(/\s{2,}/g, " ").replace(/^[\s,\-–—:!|.]+/u, "").trim();
  return r ? r.charAt(0).toUpperCase() + r.slice(1) : t;
}

export function enriquecerTitulo(titulo, a, max = TITULO_MAX) {
  let t = decodificarEntidades(semHtml(titulo)).replace(/\s*\n\s*/g, " ");
  t = t.replace(RE_EMOJI, "").replace(new RegExp(RE_CONTATO.source, "gi"), "");
  // "?" solto é travessão que o Vista perdeu na codificação.
  t = t.replace(/\s\?\s/g, " - ");
  // Hífen grudado: "gourmet- 200", "praia-Aviação".
  t = t.replace(/([\p{L}\d])-\s+/gu, "$1 - ").replace(/\s+-(\p{L})/gu, " - $1").replace(/(\p{Ll})-(\p{Lu})/gu, "$1 - $2");
  t = t.replace(/\s{2,}/g, " ").replace(/\s+([,.;:!])/g, "$1").trim();

  t = ehCaixaAlta(t, 0.7) ? tituloEmCaixaAlta(t) : capitalizarPalavras(t);
  t = expandirAbreviacoes(t);

  t = semJargao(t);
  t = t.replace(/[.!]+$/, "").trim();

  t = cortar(t, max); // antes de conferir a transação: o corte pode levá-la
  const transacao = TRANSACAO[a.transacao];

  // Título vazio ou curto demais: tipo + transação + local, do próprio anúncio.
  if (t.length < TITULO_MIN) {
    const local = [a.bairro, a.cidade].filter(Boolean).join(", ");
    return cortar(`${a.tipo ?? "Imóvel"} ${transacao ?? ""}${local ? ` em ${local}` : ""}`.replace(/\s+/g, " ").trim(), max);
  }

  // Diz se é venda ou aluguel (regra "nota 10" do feed antigo), logo depois
  // do tipo: "Sobrado Triplex à venda com 3 dormitórios".
  if (transacao && !/\b(venda|vend[eo]|alug|loca[çc])/i.test(t)) {
    const m = TIPOLOGIA_INICIO.test(t) && t.match(LIGACAO_DEPOIS_DO_TIPO);
    if (m && m.index <= 45) t = `${t.slice(0, m.index)} ${transacao}${t.slice(m.index)}`;
    else t = `${cortar(t, max - transacao.length - 2)}, ${transacao}`;
  }
  t = cortar(t, max);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// ---------------------------------------------------------------- descrição

const plural = (n, um, varios) => `${n} ${n > 1 ? varios : um}`;
const m2 = (n) => `${Math.round(n).toLocaleString("pt-BR")} m²`;

/** Ficha montada só com campos do anúncio. Vazia se não houver o que dizer. */
export function fichaDoImovel(a) {
  const linhas = [];
  if (a.areaUtil) linhas.push(`Área útil: ${m2(a.areaUtil)}`);
  if (a.areaTotal && Math.round(a.areaTotal) !== Math.round(a.areaUtil ?? 0)) linhas.push(`Área total: ${m2(a.areaTotal)}`);
  if (a.quartos) {
    linhas.push(plural(a.quartos, "quarto", "quartos") + (a.suites ? `, sendo ${plural(a.suites, "suíte", "suítes")}` : ""));
  } else if (a.suites) {
    linhas.push(plural(a.suites, "suíte", "suítes"));
  }
  if (a.banheiros) linhas.push(plural(a.banheiros, "banheiro", "banheiros"));
  if (a.vagas) linhas.push(plural(a.vagas, "vaga de garagem", "vagas de garagem"));
  if (a.ano && a.ano > 1900) linhas.push(`Ano de construção: ${a.ano}`);
  const partes = [];
  if (linhas.length) partes.push(["Ficha do imóvel:", ...linhas.map((l) => `- ${l}`)].join("\n"));
  const dif = [...new Set(a.diferenciais)];
  if (dif.length) partes.push(`Diferenciais: ${dif.join(", ")}.`);
  const local = [a.bairro, a.cidade && (a.uf ? `${a.cidade}/${a.uf}` : a.cidade)].filter(Boolean).join(", ");
  if (local && partes.length) partes.push(`Localização: ${local}.`);
  return partes.join("\n\n");
}

/**
 * Devolve a função que recoloca a grafia de nomes próprios (cidades, bairros,
 * a própria Jazz) num texto que foi passado para minúsculas.
 */
export function restauradorDeNomes(nomes) {
  const lista = [...new Set([...nomes, "Jazz Imobiliária", "Jazz"].map((n) => (n ?? "").trim()).filter((n) => n.length >= 4 && /\p{Lu}/u.test(n) && !ehCaixaAlta(n, 0.9)))];
  if (!lista.length) return (t) => t;
  lista.sort((x, y) => y.length - x.length);
  const grafia = new Map(lista.map((n) => [n.toLowerCase(), n]));
  const escapar = (n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<!\\p{L})(?:${lista.map(escapar).join("|")})(?!\\p{L})`, "giu");
  return (t) => t.replace(re, (m) => grafia.get(m.toLowerCase()) ?? m);
}

export function enriquecerDescricao(descricao, a, { curta = DESCRICAO_CURTA, max = DESCRICAO_MAX, restaurarNomes = (t) => t } = {}) {
  let t = decodificarEntidades(semHtml(descricao)).replace(/\r\n?/g, "\n").replace(RE_EMOJI, "");

  // Contato fora do portal é proibido: sai a frase inteira que o contém.
  t = t
    .split("\n")
    .map((linha) => {
      if (!RE_CONTATO.test(linha)) return linha;
      return linha.split(/(?<=[.!?])\s+/).filter((frase) => !RE_CONTATO.test(frase)).join(" ");
    })
    .join("\n");

  t = t
    .split("\n")
    .map((linha) => (ehCaixaAlta(linha, 0.8) && linha.replace(/[^\p{L}]/gu, "").length >= 15 ? restaurarNomes(linhaEmCaixaAlta(linha)) : capitalizarPalavras(linha)))
    .join("\n");
  t = expandirAbreviacoes(t);
  t = t
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  let ficha = false;
  if (t.length < curta) {
    const extra = fichaDoImovel(a);
    if (extra) {
      t = t ? `${t}\n\n${extra}` : extra;
      ficha = true;
    }
  }
  if (t.length > max) t = cortarTexto(t, max);
  return { texto: t, ficha };
}

/** Corta texto longo no fim do último parágrafo ou frase que cabe. */
function cortarTexto(t, max) {
  const corte = t.slice(0, max);
  for (const re of [/\n\n(?=[^\n]*$)/, /[.!?](?=\s[^.!?]*$)/]) {
    const m = corte.match(re);
    if (m && m.index > max * 0.6) return corte.slice(0, m.index + (m[0].startsWith("\n") ? 0 : 1)).trim();
  }
  return limparFinal(corte.slice(0, corte.lastIndexOf(" ")));
}

// ---------------------------------------------------------------- coordenadas

export function coordenadaPlausivel(lat, lon, uf) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return false;
  if (uf && uf !== "SP") return lat > -34 && lat < 5.5 && lon > -74 && lon < -34; // Brasil
  return lat >= SP.latMin && lat <= SP.latMax && lon >= SP.lonMin && lon <= SP.lonMax;
}

const normalizar = (s) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Chave do cache de geocodificação: muda se o endereço mudar. */
export function chaveEndereco(a) {
  if (!a.rua || !a.cidade) return null;
  return [a.rua, a.cidade, a.uf ?? ""].map(normalizar).join("|");
}

/** Anúncios sem coordenada válida e com rua para geocodificar. */
export function enderecosSemCoordenada(xml) {
  const lista = new Map();
  for (const bloco of separar(xml).blocos) {
    const a = lerAnuncio(bloco);
    if (a.temCoordenada && coordenadaPlausivel(a.lat, a.lon, a.uf)) continue;
    const chave = chaveEndereco(a);
    if (chave && !lista.has(chave)) {
      lista.set(chave, { chave, rua: a.rua, bairro: a.bairro, cidade: a.cidade, uf: a.uf, estado: a.estado });
    }
  }
  return [...lista.values()];
}

function trocarCoordenadas(bloco, coord) {
  let b = bloco.replace(/\s*<Latitude>[^<]*<\/Latitude>/g, "").replace(/\s*<Longitude>[^<]*<\/Longitude>/g, "");
  if (!coord) return b;
  const m = b.match(/\n([ \t]*)<City>[\s\S]*?<\/City>/);
  const campos = (ind) => `\n${ind}<Latitude>${coord.lat.toFixed(7)}</Latitude>\n${ind}<Longitude>${coord.lon.toFixed(7)}</Longitude>`;
  if (m) return b.replace(m[0], m[0] + campos(m[1]));
  return b.replace(/(<Location[^>]*>)/, (x) => x + campos("        "));
}

// ---------------------------------------------------------------- anúncio

function trocarCdata(bloco, tag, texto) {
  const novo = `<${tag}><![CDATA[${cdataSeguro(texto)}]]></${tag}>`;
  if (new RegExp(`<${tag}[\\s>]`).test(bloco) || bloco.includes(`<${tag}/>`)) {
    return bloco.replace(new RegExp(`<${tag}(?:\\s[^>]*)?(?:/>|>[\\s\\S]*?</${tag}>)`), () => novo);
  }
  return null;
}

/**
 * Enriquece um anúncio. `coordenadaDe(chave)` devolve {lat, lon} do cache de
 * geocodificação, ou null.
 */
export function enriquecerAnuncio(bloco, { coordenadaDe = () => null, restaurarNomes } = {}) {
  const a = lerAnuncio(bloco);
  const mudou = { titulo: false, descricao: false, ficha: false, coordenada_adicionada: false, coordenada_descartada: false };
  let b = bloco;

  const titulo = enriquecerTitulo(a.titulo, a);
  if (titulo !== a.titulo) {
    let novo = trocarCdata(b, "Title", titulo);
    if (!novo) novo = b.replace(/(\n[ \t]*)(<Media>|<\/Listing>)/, (_, esp, tag) => `${esp}<Title><![CDATA[${cdataSeguro(titulo)}]]></Title>${esp}${tag}`);
    if (novo !== b) { b = novo; mudou.titulo = true; }
  }

  const d = enriquecerDescricao(a.descricao, a, {
    restaurarNomes: restaurarNomes ?? restauradorDeNomes([a.cidade, a.bairro]),
  });
  if (d.texto !== a.descricao && d.texto) {
    let novo = trocarCdata(b, "Description", d.texto);
    if (!novo) novo = b.replace(/(<Details>)(\s*)/, (_, tag, esp) => `${tag}${esp}<Description><![CDATA[${cdataSeguro(d.texto)}]]></Description>${esp}`);
    if (novo !== b) { b = novo; mudou.descricao = true; mudou.ficha = d.ficha; }
  }

  const valida = a.temCoordenada && coordenadaPlausivel(a.lat, a.lon, a.uf);
  if (!valida) {
    const chave = chaveEndereco(a);
    const coord = chave ? coordenadaDe(chave) : null;
    if (coord && coordenadaPlausivel(coord.lat, coord.lon, a.uf)) {
      b = trocarCoordenadas(b, coord);
      mudou.coordenada_adicionada = true;
    } else if (a.temCoordenada) {
      b = trocarCoordenadas(b, null);
      mudou.coordenada_descartada = true;
    }
  }
  return { bloco: b, mudou };
}

/** Enriquece o feed inteiro. Cabeçalho, rodapé e ordem ficam como estão. */
export function enriquecerFeed(xml, opcoes = {}) {
  const { cabecalho, blocos, rodape } = separar(xml);
  const resumo = { titulo: 0, descricao: 0, ficha: 0, coordenada_adicionada: 0, coordenada_descartada: 0, sem_coordenada: 0 };
  const nomes = blocos.flatMap((b) => [valor(b, "City"), valor(b, "Neighborhood")]);
  const restaurarNomes = restauradorDeNomes(nomes);
  const corpo = blocos.map((bloco) => {
    const r = enriquecerAnuncio(bloco, { restaurarNomes, ...opcoes });
    for (const [k, v] of Object.entries(r.mudou)) if (v) resumo[k]++;
    if (!/<Latitude>/.test(r.bloco)) resumo.sem_coordenada++;
    return r.bloco;
  });
  const indentacao = (cabecalho.match(/\n([ \t]*)$/) || [, ""])[1];
  return { xml: cabecalho + corpo.join(`\n${indentacao}`) + rodape, resumo };
}
