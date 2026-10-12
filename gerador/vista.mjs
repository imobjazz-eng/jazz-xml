/**
 * Rede: baixa o XML de portais do Vista e a lista de códigos ativos da API,
 * e junta os dois com as regras de `espelho.mjs`.
 */
import { ajustar } from "./espelho.mjs";

/**
 * XML VRSync que o Vista gera para os portais (o mesmo que alimentava o feed
 * antigo da Jazz). Só traz o que já é público nos portais.
 */
export const URL_XML_VISTA = "https://rafaelak-portais.vistahost.com.br/903eaf6e3559adb17a44a470abe5d8a7";

const POR_PAGINA = 50; // máximo aceito pelo /imoveis/listar
const TENTATIVAS = 3;

async function comTentativas(rotulo, fn) {
  for (let t = 1; t <= TENTATIVAS; t++) {
    try {
      return await fn();
    } catch (e) {
      if (t === TENTATIVAS) throw new Error(`${rotulo}: ${e.message}`);
      await new Promise((ok) => setTimeout(ok, 1500 * t));
    }
  }
}

/** Baixa o XML do Vista e confere que veio inteiro. */
export async function baixarXmlVista(url = URL_XML_VISTA) {
  return comTentativas("XML do Vista", async () => {
    const r = await fetch(url, { headers: { Accept: "application/xml" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const xml = await r.text();
    if (!xml.includes("<ListingDataFeed") || !xml.trimEnd().endsWith("</ListingDataFeed>")) {
      throw new Error("arquivo incompleto ou fora do formato VRSync");
    }
    return xml;
  });
}

async function pagina(n, { chave, base, campos = ["Codigo"] }) {
  const pesquisa = JSON.stringify({
    fields: campos,
    order: { Codigo: "asc" },
    paginacao: { pagina: n, quantidade: POR_PAGINA },
  });
  const url = `${base}/imoveis/listar?showtotal=1&key=${encodeURIComponent(chave)}&pesquisa=${encodeURIComponent(pesquisa)}`;
  return comTentativas(`página ${n} da API`, async () => {
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });
}

/**
 * Códigos que a API do Vista reconhece agora. `paralelo` páginas por vez.
 * Lança erro se a API entregar menos de 98% do que declara: um conjunto
 * incompleto faria imóveis ativos sumirem do feed.
 */
export async function baixarAtivos({ chave, base, paralelo = 8 }) {
  if (!chave) throw new Error("VISTA_API_KEY não informada");
  const opcoes = { chave, base: (base || "https://rafaelak-rest.vistahost.com.br").replace(/\/+$/, "") };
  const primeira = await pagina(1, opcoes);
  const total = Number(primeira.total);
  const paginas = Number(primeira.paginas);
  if (!Number.isFinite(total) || !Number.isFinite(paginas) || total <= 0) {
    throw new Error("a API do Vista não informou total/páginas");
  }
  const respostas = [primeira];
  let proxima = 2;
  const trabalhador = async () => {
    while (proxima <= paginas) respostas.push(await pagina(proxima++, opcoes));
  };
  await Promise.all(Array.from({ length: Math.min(paralelo, Math.max(0, paginas - 1)) }, trabalhador));

  const ativos = new Set();
  for (const resp of respostas) for (const k of Object.keys(resp)) if (/^\d+$/.test(k)) ativos.add(k);
  if (ativos.size < total * 0.98) {
    throw new Error(`API entregou ${ativos.size} de ${total} códigos`);
  }
  return ativos;
}

// Campos da API usados para completar o que o XML de portais não traz.
const CAMPOS_COMPLEMENTO = ["Codigo", "Numero", "Complemento", "AreaPrivativa", "BanheiroSocialQtd", "AnoConstrucao", "ValorIptu", "Bairro", "CEP", "Latitude", "Longitude"];
const CAMPOS_ENDERECO = ["Codigo", "Numero", "Complemento"];

/** Dados de um imóvel da API → formato usado pelo enriquecimento. */
export function dadosDaApi(v) {
  const e = {};
  const texto = (x) => String(x ?? "").replace(/[<>\]\[]/g, "").replace(/\s+/g, " ").trim();
  const num = (x) => Number(String(x ?? "").replace(",", "."));
  const numero = texto(v.Numero);
  if (/^\d{1,6}[A-Za-z]?$/.test(numero) && Number.parseInt(numero, 10) > 0) e.numero = numero;
  const complemento = texto(v.Complemento).slice(0, 40);
  if (complemento) e.complemento = complemento;
  const area = num(v.AreaPrivativa);
  if (area >= 1 && area < 1_000_000) e.area_util = Math.round(area);
  const banheiros = num(v.BanheiroSocialQtd);
  if (Number.isInteger(banheiros) && banheiros >= 1 && banheiros < 50) e.banheiros = banheiros;
  const ano = num(v.AnoConstrucao);
  if (Number.isInteger(ano) && ano >= 1800 && ano <= new Date().getFullYear() + 5) e.ano = ano;
  const iptu = num(v.ValorIptu);
  if (iptu > 1 && iptu < 10_000_000) e.iptu = Math.round(iptu);
  const bairro = texto(v.Bairro).slice(0, 80);
  if (bairro) e.bairro = bairro;
  const cep = texto(v.CEP).replace(/\D/g, "");
  if (/^\d{8}$/.test(cep) && cep !== "00000000") e.cep = `${cep.slice(0, 5)}-${cep.slice(5)}`;
  const lat = num(v.Latitude);
  const lon = num(v.Longitude);
  if (lat && lon && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) { e.lat = lat; e.lon = lon; }
  return e;
}

async function baixarPaginas(opcoes, paralelo) {
  const primeira = await pagina(1, opcoes);
  const paginas = Number(primeira.paginas);
  if (!Number.isFinite(paginas) || paginas < 1) throw new Error("sem total de páginas");
  const respostas = [primeira];
  let proxima = 2;
  const trabalhador = async () => {
    while (proxima <= paginas) respostas.push(await pagina(proxima++, opcoes));
  };
  await Promise.all(Array.from({ length: Math.min(paralelo, Math.max(0, paginas - 1)) }, trabalhador));
  return respostas;
}

/**
 * O que a API do Vista sabe e o XML de portais não traz (número, complemento,
 * área útil, banheiros, ano, IPTU, bairro, CEP, coordenada). Melhor esforço:
 * se a API recusar algum campo, tenta só número e complemento; qualquer
 * falha devolve mapa vazio e o feed segue com o que tiver.
 */
export async function baixarEnderecos({ chave, base, paralelo = 8 }) {
  const dados = new Map();
  if (!chave) return dados;
  const raiz = (base || "https://rafaelak-rest.vistahost.com.br").replace(/\/+$/, "");
  for (const campos of [CAMPOS_COMPLEMENTO, CAMPOS_ENDERECO]) {
    try {
      const respostas = await baixarPaginas({ chave, base: raiz, campos }, paralelo);
      for (const resp of respostas) {
        for (const [k, v] of Object.entries(resp)) {
          if (!/^\d+$/.test(k) || !v || typeof v !== "object") continue;
          const e = dadosDaApi(v);
          if (Object.keys(e).length) dados.set(k, e);
        }
      }
      return dados;
    } catch (e) {
      console.log(`API do Vista recusou os campos ${campos.join(",")} (${e.message}).`);
    }
  }
  return dados;
}

/**
 * Pipeline completo. Lança erro (e não devolve XML) se o arquivo do Vista
 * não vier ou se o resultado ficar abaixo do piso.
 */
export async function gerarFeed({ chave, base, urlXml, minimo = 1000, minFotos = 7, maximo = 3000, prioridade } = {}) {
  const xmlVista = await baixarXmlVista(urlXml);
  let ativos = null;
  let erroApi = null;
  try {
    ativos = await baixarAtivos({ chave, base });
  } catch (e) {
    erroApi = e.message;
  }
  const enderecos = await baixarEnderecos({ chave, base });
  const r = ajustar(xmlVista, { ativos, minFotos, maximo, prioridade: prioridade && ((codigo, bloco) => prioridade(codigo, bloco, enderecos)) });
  if (erroApi) r.avisos.push(`API: ${erroApi}`);
  if (r.publicados < minimo) {
    throw new Error(`só ${r.publicados} anúncios (piso ${minimo}). Nada foi publicado.`);
  }
  return { ...r, ativosNaApi: ativos ? ativos.size : null, enderecos };
}
