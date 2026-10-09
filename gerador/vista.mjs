/**
 * Download do acervo inteiro da API do Vista + montagem do VRSync, com as
 * travas contra feed truncado. Usado pelo `gerar.mjs` (linha de comando /
 * GitHub Actions).
 */
import { montarFeed } from "./vrsync.mjs";

const CAMPOS = [
  "Codigo", "Status", "Categoria", "Bairro", "Cidade", "Endereco", "Numero",
  "ValorVenda", "ValorLocacao", "AreaTotal", "AreaPrivativa", "Dormitorios",
  "Suites", "Vagas", "BanheiroSocialQtd", "FotoDestaque", "DescricaoWeb",
  "Latitude", "Longitude",
];
const POR_PAGINA = 50; // máximo aceito pelo /imoveis/listar
const TENTATIVAS = 3;

async function pagina(n, { chave, base }) {
  const pesquisa = JSON.stringify({
    fields: CAMPOS,
    order: { Codigo: "asc" },
    paginacao: { pagina: n, quantidade: POR_PAGINA },
  });
  const url = `${base}/imoveis/listar?showtotal=1&key=${encodeURIComponent(chave)}&pesquisa=${encodeURIComponent(pesquisa)}`;
  for (let t = 1; t <= TENTATIVAS; t++) {
    try {
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (t === TENTATIVAS) throw new Error(`página ${n}: ${e.message}`);
      await new Promise((ok) => setTimeout(ok, 1500 * t));
    }
  }
}

/**
 * Baixa todas as páginas. `paralelo` páginas por vez: 94 páginas em série
 * passam do limite de 30 s de uma função agendada do Netlify.
 */
export async function baixarAcervo({ chave, base, paralelo = 8 }) {
  if (!chave) throw new Error("VISTA_API_KEY não informada");
  const opcoes = { chave, base: (base || "https://rafaelak-rest.vistahost.com.br").replace(/\/+$/, "") };
  const primeira = await pagina(1, opcoes);
  const total = Number(primeira.total);
  const paginas = Number(primeira.paginas);
  if (!Number.isFinite(total) || !Number.isFinite(paginas) || total <= 0) {
    throw new Error(`o Vista não informou total/páginas: ${JSON.stringify(primeira).slice(0, 200)}`);
  }

  const respostas = [primeira];
  let proxima = 2;
  const trabalhador = async () => {
    while (proxima <= paginas) {
      const n = proxima++;
      respostas.push(await pagina(n, opcoes));
    }
  };
  await Promise.all(Array.from({ length: Math.min(paralelo, Math.max(0, paginas - 1)) }, trabalhador));

  const itens = [];
  for (const resp of respostas) {
    for (const [k, v] of Object.entries(resp)) if (/^\d+$/.test(k) && v && typeof v === "object") itens.push(v);
  }
  return { total, paginas, itens };
}

/**
 * Baixa, confere e monta. Lança erro (e não devolve XML nenhum) se o Vista
 * entregou menos de 98% do que declarou ou se o feed ficou abaixo do piso:
 * um feed curto publicado tira anúncio do ar; um erro mantém o anterior.
 */
export async function gerarXml({ chave, base, minimo = 1000, contato, paralelo }) {
  const { total, paginas, itens } = await baixarAcervo({ chave, base, paralelo });
  if (itens.length < total * 0.98) {
    throw new Error(`Vista entregou ${itens.length} de ${total} imóveis. Feed incompleto não é publicado.`);
  }
  const { xml, publicados, excluidos } = montarFeed(itens, { contato });
  if (publicados < minimo) {
    throw new Error(`só ${publicados} anúncios (piso ${minimo}). Nada foi publicado.`);
  }
  return { xml, publicados, excluidos, total, recebidos: itens.length, paginas };
}
