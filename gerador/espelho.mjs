/**
 * Ajustes sobre o XML VRSync que o próprio Vista gera para os portais.
 *
 * POR QUE ASSIM. O Vista já exporta um VRSync completo (todas as fotos,
 * características, condomínio, IPTU, ano, endereço sem número). Era a fonte
 * do feed antigo da Jazz. Montar o XML do zero pela API perderia tudo isso,
 * então aqui o arquivo do Vista é a base e só três regras são aplicadas:
 *
 *  1. Imóvel que a API do Vista não reconhece mais sai, mesmo que o arquivo
 *     (gerado uma vez por dia pelo Vista) ainda o traga. A API é em tempo
 *     real; o arquivo, não. Com isso, desativado no Vista sai do portal na
 *     hora seguinte.
 *  2. Mínimo de fotos por anúncio (padrão 7, regra do feed antigo).
 *  3. Preço de venda fora do aceito pelo Grupo ZAP (R$ 15 mil a R$ 150
 *     milhões, regra do feed antigo) sai: é erro de digitação no Vista
 *     (R$ 40 bilhões, R$ 745) e o código vai para o aviso do log.
 *  4. Teto de anúncios (padrão 3000, regra do feed antigo), priorizando
 *     quem tem mais fotos.
 *
 * Nada é inventado: nenhum campo ausente é preenchido com valor padrão.
 * Sem rede aqui; quem baixa é o `gerar.mjs`.
 */

const RE_LISTING = /<Listing>[\s\S]*?<\/Listing>/g;

function codigoDe(bloco) {
  const m = bloco.match(/<ListingID>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)/);
  return m ? m[1] : null;
}

const PRECO_VENDA_MIN = 15_000;
const PRECO_VENDA_MAX = 150_000_000;

function precoForaDoPadrao(bloco) {
  const tipo = (bloco.match(/<TransactionType>\s*([^<]+?)\s*<\/TransactionType>/) || [])[1];
  if (tipo === "For Rent") return false;
  const preco = Number((bloco.match(/<ListPrice[^>]*>\s*([\d.]+)\s*<\/ListPrice>/) || [])[1]);
  return Number.isFinite(preco) && preco > 0 && (preco < PRECO_VENDA_MIN || preco > PRECO_VENDA_MAX);
}

function fotosDe(bloco) {
  return (bloco.match(/<Item[^>]*medium="image"/g) || []).length;
}

/** Separa o XML em cabeçalho, anúncios e rodapé, sem alterar nenhum byte. */
export function separar(xml) {
  const blocos = [];
  let primeiro = -1;
  let fimUltimo = -1;
  for (const m of xml.matchAll(RE_LISTING)) {
    if (primeiro < 0) primeiro = m.index;
    fimUltimo = m.index + m[0].length;
    blocos.push(m[0]);
  }
  if (primeiro < 0) return { cabecalho: xml, blocos, rodape: "" };
  return { cabecalho: xml.slice(0, primeiro), blocos, rodape: xml.slice(fimUltimo) };
}

/**
 * @param xml       XML VRSync do Vista
 * @param ativos    Set de códigos que a API do Vista devolve, ou null para
 *                  não filtrar (API fora do ar)
 * @param minFotos  mínimo de fotos por anúncio
 * @param maximo    teto de anúncios
 * @param limiteRemocao fração máxima do arquivo que o filtro de ativos pode
 *                  remover. Acima disso o filtro é ignorado: sumir 10% do
 *                  acervo de uma vez é sintoma de API com problema, não de
 *                  imóveis desativados.
 */
export function ajustar(xml, { ativos = null, minFotos = 7, maximo = 3000, limiteRemocao = 0.1, agora = new Date() } = {}) {
  const { cabecalho, blocos, rodape } = separar(xml);
  const excluidos = { inativo_no_vista: 0, poucas_fotos: 0, preco_fora_do_padrao: 0, acima_do_limite: 0, sem_codigo: 0 };
  const avisos = [];

  let itens = blocos.map((bloco) => ({ bloco, codigo: codigoDe(bloco), fotos: fotosDe(bloco) }));
  const semCodigo = itens.filter((i) => !i.codigo).length;
  excluidos.sem_codigo = semCodigo;
  itens = itens.filter((i) => i.codigo);

  if (ativos) {
    const inativos = itens.filter((i) => !ativos.has(i.codigo)).length;
    if (inativos > itens.length * limiteRemocao) {
      avisos.push(`filtro de ativos ignorado: removeria ${inativos} de ${itens.length} anúncios`);
    } else {
      itens = itens.filter((i) => ativos.has(i.codigo));
      excluidos.inativo_no_vista = inativos;
    }
  } else {
    avisos.push("API do Vista indisponível: imóveis não foram conferidos contra a API");
  }

  const antes = itens.length;
  itens = itens.filter((i) => i.fotos >= minFotos);
  excluidos.poucas_fotos = antes - itens.length;

  const precoErrado = itens.filter((i) => precoForaDoPadrao(i.bloco)).map((i) => i.codigo);
  if (precoErrado.length) {
    excluidos.preco_fora_do_padrao = precoErrado.length;
    avisos.push(`preço de venda fora de R$ 15 mil a R$ 150 milhões (corrigir no Vista): ${precoErrado.join(", ")}`);
    const fora = new Set(precoErrado);
    itens = itens.filter((i) => !fora.has(i.codigo));
  }

  if (itens.length > maximo) {
    // Mais fotos primeiro; empate pelo código, para a seleção ser estável.
    const ordem = [...itens].sort((a, b) => b.fotos - a.fotos || a.codigo.localeCompare(b.codigo, "pt", { numeric: true }));
    const ficam = new Set(ordem.slice(0, maximo).map((i) => i.codigo));
    excluidos.acima_do_limite = itens.length - maximo;
    itens = itens.filter((i) => ficam.has(i.codigo));
  }

  const novoCabecalho = cabecalho.replace(
    /<PublishDate>[^<]*<\/PublishDate>/,
    `<PublishDate>${agora.toISOString().slice(0, 19)}</PublishDate>`,
  );
  const indentacao = (cabecalho.match(/\n([ \t]*)$/) || [, ""])[1];
  const corpo = itens.map((i) => i.bloco).join(`\n${indentacao}`);
  return {
    xml: novoCabecalho + corpo + rodape,
    publicados: itens.length,
    noArquivo: blocos.length,
    excluidos,
    avisos,
  };
}
