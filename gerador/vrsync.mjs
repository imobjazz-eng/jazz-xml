/**
 * Montagem do XML VRSync a partir da resposta CRUA da API do Vista.
 *
 * POR QUE EXISTE. O feed dos portais (Canal Pró / Grupo ZAP) era montado
 * dentro da Supabase, e parou em 20/09/2026 quando a organização foi restrita
 * por cota: imóvel novo não entrava e imóvel desativado não saía. Este módulo
 * monta o mesmo XML direto do Vista, sem passar por banco nenhum, para rodar
 * no GitHub Actions.
 * Mesma estrutura do feed que o app Jazz Lead Conecta servia.
 *
 * Sem rede aqui: recebe os itens já baixados e devolve texto. Quem baixa é o
 * `gerar.mjs`; quem testa é o `teste.mjs`.
 */

export function xml(valor) {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function tagTexto(tag, valor) {
  const s = String(valor ?? "").trim();
  return s ? `<${tag}>${xml(s)}</${tag}>` : "";
}

function positivo(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function tagNumero(tag, valor) {
  const n = positivo(valor);
  return n ? `<${tag}>${n}</${tag}>` : "";
}

/** Latitude/longitude: o Vista manda "" quando não tem, e "" vira 0 no Number(). */
function tagCoordenada(tag, valor) {
  const s = String(valor ?? "").trim();
  const n = Number(s);
  return s && Number.isFinite(n) && n !== 0 ? `<${tag}>${n}</${tag}>` : "";
}

/** Sem acento e em minúscula: "Locação" e "locacao" têm de casar igual. */
function normalizar(v) {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Na API do Vista o campo Status carrega a finalidade comercial.
export const ehVenda = (status) => /\bvenda\b/.test(normalizar(status));
export const ehLocacao = (status) => /\b(aluguel|alugar|locacao|locar)\b/.test(normalizar(status));

function tipoDeImovel(categoria) {
  const tipo = normalizar(categoria);
  if (/apart|cobertura|flat|kitnet/.test(tipo)) return "Residential / Apartment";
  if (/terreno|lote/.test(tipo)) return "Residential / Land Lot";
  if (/sala|comercial|loja|galp|predio/.test(tipo)) return "Commercial / Business";
  return "Residential / Home";
}

/**
 * Preços que vão ao portal. Venda só se o Status diz venda; aluguel só se diz
 * aluguel — preço preenchido na finalidade errada não pode vazar.
 */
export function precos(item) {
  return {
    venda: ehVenda(item.Status) ? positivo(item.ValorVenda) : null,
    locacao: ehLocacao(item.Status) ? positivo(item.ValorLocacao) : null,
  };
}

/**
 * Por que um item fica de fora (ou null se entra). O motivo é contado e
 * impresso no log do Actions, para ninguém achar que imóvel "sumiu" sem razão.
 */
export function motivoExclusao(item) {
  if (!String(item?.Codigo ?? "").trim()) return "sem_codigo";
  if (!ehVenda(item.Status) && !ehLocacao(item.Status)) return "finalidade_invalida";
  const { venda, locacao } = precos(item);
  // Ex.: categoria "Empreendimento" vem com valor 0. Portal recusa anúncio sem preço.
  if (!venda && !locacao) return "sem_preco";
  return null;
}

export function anuncioXml(item, contato = {}) {
  const id = String(item.Codigo).trim();
  const titulo = [item.Categoria || "Imovel", item.Bairro, item.Cidade].filter(Boolean).join(" - ");
  const endereco = [item.Endereco, item.Numero].map((s) => String(s ?? "").trim()).filter(Boolean).join(", ");
  const { venda, locacao } = precos(item);
  const precoXml = [
    venda ? `<ListPrice currency="BRL">${venda}</ListPrice>` : "",
    locacao ? `<RentalPrice currency="BRL">${locacao}</RentalPrice>` : "",
  ].filter(Boolean).join("\n      ");
  const urlDetalhe = `https://jazz-lead-conecta.lovable.app/beta/imovel/${encodeURIComponent(id)}`;

  return `
  <Listing>
    <ListingID>${xml(id)}</ListingID>
    <Title>${xml(titulo)}</Title>
    <TransactionType>${venda ? "For Sale" : "For Rent"}</TransactionType>
    <PublicationType>STANDARD</PublicationType>
    <DetailViewUrl>${xml(urlDetalhe)}</DetailViewUrl>
    <Location>
      <Country abbreviation="BR">Brasil</Country>
      <State abbreviation="SP">Sao Paulo</State>
      ${tagTexto("City", item.Cidade)}
      ${tagTexto("Neighborhood", item.Bairro)}
      ${tagTexto("Address", endereco)}
      ${tagCoordenada("Latitude", item.Latitude)}
      ${tagCoordenada("Longitude", item.Longitude)}
    </Location>
    <Details>
      <PropertyType>${xml(tipoDeImovel(item.Categoria))}</PropertyType>
      ${precoXml}
      ${tagNumero("LivingArea", positivo(item.AreaPrivativa) ?? positivo(item.AreaTotal))}
      ${tagNumero("LotArea", item.AreaTotal)}
      ${tagNumero("Bedrooms", item.Dormitorios)}
      ${tagNumero("Bathrooms", item.BanheiroSocialQtd)}
      ${tagNumero("Suites", item.Suites)}
      ${tagNumero("Garage", item.Vagas)}
      ${tagTexto("Description", item.DescricaoWeb || titulo)}
    </Details>
    <ContactInfo>
      ${tagTexto("Name", contato.nome ?? "Jazz")}
      ${tagTexto("Telephone", contato.telefone ?? "")}
    </ContactInfo>
    ${item.FotoDestaque
      ? `<Media><Item medium="image" caption="${xml(titulo)}">${xml(item.FotoDestaque)}</Item></Media>`
      : "<Media />"}
  </Listing>`;
}

/**
 * Recebe os itens do Vista (array) e devolve { xml, publicados, excluidos }.
 * `excluidos` é um contador por motivo.
 */
export function montarFeed(itens, { contato, agora = new Date() } = {}) {
  const excluidos = {};
  const vistos = new Set();
  const aceitos = [];
  for (const item of itens) {
    const motivo = motivoExclusao(item) ?? (vistos.has(String(item.Codigo).trim()) ? "duplicado" : null);
    if (motivo) {
      excluidos[motivo] = (excluidos[motivo] ?? 0) + 1;
      continue;
    }
    vistos.add(String(item.Codigo).trim());
    aceitos.push(item);
  }

  const corpo = `<?xml version="1.0" encoding="UTF-8"?>
<Listings xmlns="http://www.vivareal.com/schemas/1.0/VRSync" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Header>
    <Provider>Jazz Lead Conecta</Provider>
    <PublishDate>${agora.toISOString()}</PublishDate>
    <ListingCount>${aceitos.length}</ListingCount>
  </Header>
  ${aceitos.map((i) => anuncioXml(i, contato)).join("")}
</Listings>
`;
  return { xml: corpo, publicados: aceitos.length, excluidos };
}
