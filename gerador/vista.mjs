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

/**
 * Número e complemento do endereço de cada imóvel, pela API (o XML de
 * portais do Vista não traz). Melhor esforço: qualquer falha devolve mapa
 * vazio e o feed segue com o que tiver (XML anterior).
 */
export async function baixarEnderecos({ chave, base, paralelo = 8 }) {
  const enderecos = new Map();
  if (!chave) return enderecos;
  try {
    const opcoes = { chave, base: (base || "https://rafaelak-rest.vistahost.com.br").replace(/\/+$/, ""), campos: ["Codigo", "Numero", "Complemento"] };
    const primeira = await pagina(1, opcoes);
    const paginas = Number(primeira.paginas);
    if (!Number.isFinite(paginas) || paginas < 1) throw new Error("sem total de páginas");
    const respostas = [primeira];
    let proxima = 2;
    const trabalhador = async () => {
      while (proxima <= paginas) respostas.push(await pagina(proxima++, opcoes));
    };
    await Promise.all(Array.from({ length: Math.min(paralelo, Math.max(0, paginas - 1)) }, trabalhador));
    for (const resp of respostas) {
      for (const [k, v] of Object.entries(resp)) {
        if (!/^\d+$/.test(k) || !v || typeof v !== "object") continue;
        const numero = String(v.Numero ?? "").trim();
        const complemento = String(v.Complemento ?? "").replace(/[<>\]\[]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
        const e = {};
        if (/^\d{1,6}[A-Za-z]?$/.test(numero) && Number.parseInt(numero, 10) > 0) e.numero = numero;
        if (complemento) e.complemento = complemento;
        if (Object.keys(e).length) enderecos.set(k, e);
      }
    }
  } catch (e) {
    console.log(`Número/complemento pela API indisponível (${e.message}): segue com o XML anterior.`);
  }
  return enderecos;
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
