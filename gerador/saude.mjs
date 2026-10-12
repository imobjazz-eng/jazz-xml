/**
 * Saúde dos XMLs: cada geração grava saude.json ao lado do XML, e a página
 * saude.html (GitHub Pages) mostra cada etapa e cada canal em verde,
 * amarelo ou vermelho. A frescura (há quanto tempo foi a última geração) é
 * calculada na página: se o gerador parar, ela fica vermelha sozinha.
 *
 * Os limites seguem o que o portal mede (relatório do Canal Pro):
 * fotos (~16 contam como completas), vídeo, tour, endereço com número.
 */

export const FOTOS_PORTAL = 16;
/** Portais com a integração já ativada (o Chaves na Mão ainda depende de pedido ao portal). */
export const PORTAIS_ATIVOS = ["zap"];

/**
 * Portais do maior para o menor em audiência (Similarweb, ranking Brasil de
 * imóveis jul/2026 e visitas de dez/2024; OLX e Mercado Livre são
 * generalistas, sem número só de imóveis). `canal`: arquivo que geramos.
 * `doc`: verde = documentação oficial; amarelo = só por integrador de
 * terceiros; vermelho = não encontrada. `vista`: citado como integrado ao Vista.
 */
export const PORTAIS = [
  // Prioridade para a Jazz (São José dos Campos/SP; 99,9% dos anúncios em SP:
  // Campinas, SJC, litoral e interior). Alta: nacional forte em SP. Média:
  // alcance em SP com mais esforço. Fora da região: portal regional de outro estado.
  { nome: "Grupo OLX: ZAP Imóveis, VivaReal e OLX", grupo: "Um só arquivo (Canal Pro)", audiencia: "~15 mi visitas/mês cada · ZAP 1º", formato: "VRSync", doc: "verde", vista: true, canal: "zap", prioridade: "Alta", motivo: "Maior grupo do país, forte em SP; inclui o público popular e de litoral da OLX" },
  { nome: "QuintoAndar", grupo: "Rede QuintoAndar", audiencia: "~12,8 mi visitas/mês · 2º", formato: "Via ImovelWeb (filtro no portal de integração)", doc: "amarelo", vista: true, canal: "imovelweb", prioridade: "Alta", motivo: "2º em audiência; recebe os anúncios do ImovelWeb (exige parceria)" },
  { nome: "Chaves na Mão", grupo: "", audiencia: "~9,8 mi visitas/mês · 3º", formato: "Próprio (CNM)", doc: "verde", vista: true, canal: "chavesnamao", prioridade: "Alta", motivo: "3º em audiência; arquivo pronto" },
  { nome: "ImovelWeb", grupo: "Navent / QuintoAndar", audiencia: "~6,7 mi visitas/mês", formato: "OpenNavent", doc: "amarelo", vista: true, canal: "imovelweb", prioridade: "Alta", motivo: "Nacional, forte em SP; porta de entrada para o QuintoAndar" },
  { nome: "Mercado Livre Imóveis", grupo: "Mercado Livre", audiencia: "generalista (160 mi, varejo inteiro)", formato: "API (não XML)", doc: "verde", vista: true, canal: null, prioridade: "Média", motivo: "Alcance enorme; exige integração por API" },
  { nome: "123i", grupo: "", audiencia: "sem dado", formato: "Não publicado (integradores citam o modelo VivaReal)", doc: "vermelho", vista: true, canal: null, prioridade: "Média", motivo: "Integrado ao Vista; confirmar com o portal se aceita o vrsync.xml" },
  { nome: "Wimoveis", grupo: "Navent / QuintoAndar", audiencia: "~1,3 mi visitas/mês", formato: "OpenNavent (mesmo arquivo do ImovelWeb)", doc: "amarelo", vista: false, canal: "imovelweb", prioridade: "Fora da região", motivo: "Foco no Distrito Federal" },
  { nome: "Casa Mineira", grupo: "QuintoAndar", audiencia: "top 10 de concorrentes do ZAP", formato: "OpenNavent (mesmo arquivo do ImovelWeb)", doc: "amarelo", vista: true, canal: "imovelweb", prioridade: "Fora da região", motivo: "Foco em Minas Gerais" },
  { nome: "DF Imóveis", grupo: "", audiencia: "~1,3 mi visitas/mês", formato: "Formato ZAP (VRSync, segundo integradores; aprovação manual)", doc: "amarelo", vista: false, canal: "zap", prioridade: "Fora da região", motivo: "Só Distrito Federal; aceitaria o vrsync.xml" },
  { nome: "Netimóveis", grupo: "", audiencia: "~390 mil visitas/mês", formato: "Não encontrado", doc: "vermelho", vista: false, canal: null, prioridade: "Fora da região", motivo: "Foco em MG e RJ" },
  { nome: "Imóveis SC", grupo: "", audiencia: "sem dado recente", formato: "Próprio (manual de 2017, fora do ar)", doc: "vermelho", vista: false, canal: null, prioridade: "Fora da região", motivo: "Só Santa Catarina" },
];

const pct = (n, total) => (total ? Math.round((n / total) * 1000) / 10 : 0);
const pior = (...s) => (s.includes("vermelho") ? "vermelho" : s.includes("amarelo") ? "amarelo" : "verde");
const faixa = (falta, total, amarelo, vermelho) => {
  const p = total ? falta / total : 0;
  return p >= vermelho ? "vermelho" : p >= amarelo ? "amarelo" : "verde";
};

/** Números do XML final (o que os portais recebem). */
export function medirXml(xml) {
  const blocos = [...xml.matchAll(/<Listing>[\s\S]*?<\/Listing>/g)].map((m) => m[0]);
  const m = { anuncios: blocos.length, fotosAbaixo: 0, fotosAbaixo20: 0, semVideo: 0, semTour: 0, tour360: 0, semNumero: 0, semCoordenada: 0, semDescricao: 0 };
  for (const b of blocos) {
    const fotos = (b.match(/<Item[^>]*medium="image"/g) || []).length;
    if (fotos < FOTOS_PORTAL) m.fotosAbaixo++;
    if (fotos < 20) m.fotosAbaixo20++;
    if (!/medium="video"/.test(b)) m.semVideo++;
    const tour = (b.match(/<VirtualTourLink>\s*(?:<!\[CDATA\[)?([^<\]]*)/) || [])[1] || "";
    if (!tour.trim()) m.semTour++;
    if (/\/tour360\//.test(tour)) m.tour360++;
    if (!/<StreetNumber>\s*\S/.test(b)) m.semNumero++;
    if (!/<Latitude>\s*-?\d/.test(b)) m.semCoordenada++;
    const d = (b.match(/<Description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/Description>/) || [])[1] || "";
    if (d.trim().length < 50) m.semDescricao++;
  }
  m.megabytes = Math.round((Buffer.byteLength(xml) / 1048576) * 10) / 10;
  return m;
}

/**
 * Monta o saude.json. `info`: dados da execução (gerar.mjs).
 * Cada etapa: {id, nome, status, resumo, detalhe}.
 */
export function montarSaude(xml, info = {}) {
  const m = medirXml(xml);
  const n = m.anuncios;
  const maximo = info.maximo ?? 3000;
  const etapas = [];
  const etapa = (id, nome, status, resumo, detalhe = "") => etapas.push({ id, nome, status, resumo, detalhe });

  etapa("vista", "Vista: arquivo de imóveis", info.noArquivo ? "verde" : "vermelho",
    info.noArquivo ? `${info.noArquivo} imóveis no XML do Vista` : "XML do Vista não lido",
    "Base de tudo: fotos, características e preços vêm do Vista.");

  const filtroIgnorado = (info.avisos || []).some((a) => /filtro de ativos ignorado/.test(a));
  etapa("api", "Vista: imóveis ativos (tempo real)", info.ativosNaApi == null || filtroIgnorado ? "amarelo" : "verde",
    info.ativosNaApi == null ? "API do Vista indisponível nesta geração" : filtroIgnorado ? "Filtro de ativos ignorado por segurança" : `${info.ativosNaApi} imóveis ativos na API`,
    "Imóvel desativado no Vista sai dos portais na geração seguinte (a cada 10 minutos).");

  const fora = info.excluidos || {};
  etapa("selecao", "Seleção dos anúncios", n >= maximo ? "verde" : n >= (info.minimo ?? 1000) ? "amarelo" : "vermelho",
    `${n} de ${maximo} anúncios`,
    `Fora: ${fora.poucas_fotos ?? 0} com poucas fotos, ${fora.acima_do_limite ?? 0} acima do limite, ${fora.preco_fora_do_padrao ?? 0} com preço fora do padrão, ${fora.inativo_no_vista ?? 0} inativos no Vista.`);

  etapa("enriquecimento", "Enriquecimento dos dados", info.enriquecimentoOk === false ? "vermelho" : "verde",
    info.enriquecimentoOk === false ? "Falhou: publicado sem enriquecimento" : "Título, descrição com ficha, endereço, IPTU, ano e características",
    "Mesmo enriquecimento para todos os portais.");

  etapa("endereco", "Endereço completo", pior(faixa(m.semNumero, n, 0.01, 0.05), faixa(m.semCoordenada, n, 0.05, 0.2)),
    `${pct(n - m.semNumero, n)}% com número · ${pct(n - m.semCoordenada, n)}% com coordenada`,
    `${m.semNumero} sem número, ${m.semCoordenada} sem coordenada${info.geoErro ? ` (geocodificação: ${info.geoErro})` : ""}. Endereço vale 35 pontos no Canal Pro.`);

  etapa("descricao", "Descrição", faixa(m.semDescricao, n, 0.01, 0.05),
    `${pct(n - m.semDescricao, n)}% com descrição completa`, "Descrição vale 25 pontos no Canal Pro.");

  etapa("fotos", "Fotos", faixa(m.fotosAbaixo, n, 0.05, 0.3),
    `${m.fotosAbaixo} anúncios com menos de ${FOTOS_PORTAL} fotos`,
    `${m.fotosAbaixo20} com menos de 20. Só se resolve cadastrando fotos no Vista (vale 20 pontos).`);

  etapa("video", "Vídeo", faixa(m.semVideo, n, 0.01, 0.1), `${pct(n - m.semVideo, n)}% com vídeo`, "Vídeo do YouTube (vale 3 pontos).");

  // Tour com fotos comuns está em todos, mas o portal só conta tour 360:
  // enquanto houver anúncio sem tour 360, a etapa fica amarela.
  etapa("tour", "Tour virtual", pior(faixa(m.semTour, n, 0.01, 0.1), m.tour360 >= n ? "verde" : "amarelo"),
    `${pct(n - m.semTour, n)}% com tour de fotos · ${m.tour360} com tour 360`,
    `O Canal Pro só contou tour 360 até agora. Envio de fotos 360 pelo celular: ${info.tours360Ok === false ? "lista indisponível nesta geração" : "funcionando"}. Tour vale 4 pontos.`);
  if (info.tours360Ok === false) etapas[etapas.length - 1].status = pior(etapas[etapas.length - 1].status, "amarelo");

  const statusEtapas = pior(...etapas.map((e) => e.status));
  // Ativação no portal não é detectável daqui: marcada à mão (PORTAIS_ATIVOS).
  const ativos = info.portaisAtivos ?? PORTAIS_ATIVOS;
  const arquivoZap = n >= (info.minimo ?? 1000) ? "verde" : "vermelho";
  const arquivoCnm = info.chavesNaMao == null ? "vermelho" : info.chavesNaMao >= n * 0.95 ? "verde" : "amarelo";
  const canal = (id, nome, arquivo, statusArquivo, resumo, leitura) => {
    const ativo = ativos.includes(id);
    const ativacao = { status: ativo ? "verde" : "amarelo", texto: ativo ? "Integração ativa no portal" : "Aguardando ativação no portal" };
    return { id, nome, arquivo, statusArquivo, resumo, leitura, ativacao, status: pior(statusEtapas, statusArquivo, ativacao.status) };
  };
  const iw = info.imovelWeb;
  const arquivoIw = !iw ? "vermelho" : !iw.temCodigo ? "amarelo" : iw.total >= n * 0.9 ? "verde" : "amarelo";
  const canais = [
    canal("zap", "Grupo ZAP (ZAP Imóveis, VivaReal, OLX)", "vrsync.xml", arquivoZap, `${n} anúncios · ${m.megabytes} MB`, "O portal lê várias vezes ao dia."),
    canal("chavesnamao", "Chaves na Mão", "chavesnamao.xml", arquivoCnm,
      info.chavesNaMao == null ? "Arquivo não gerado nesta execução" : `${info.chavesNaMao} imóveis`, "O portal lê uma vez por dia."),
    canal("imovelweb", "ImovelWeb (Wimoveis, Casa Mineira)", "imovelweb.xml", arquivoIw,
      !iw ? "Arquivo não gerado nesta execução" : `${iw.total} imóveis${iw.fora ? ` · ${iw.fora} sem campo obrigatório do portal` : ""}${iw.temCodigo ? "" : " · falta o código da Jazz no portal"}`,
      "O portal lê uma vez por dia."),
  ];
  // Tabela de portais: uma linha por portal, uma coluna por etapa da integração.
  // "cinza" = etapa ainda não iniciada para aquele portal.
  const porId = Object.fromEntries(canais.map((c) => [c.id, c]));
  const portais = PORTAIS.map((p) => {
    const c = p.canal ? porId[p.canal] : null;
    return {
      nome: p.nome, grupo: p.grupo, audiencia: p.audiencia, formato: p.formato, prioridade: p.prioridade, motivo: p.motivo,
      etapas: {
        documentacao: { status: p.doc, texto: p.doc === "verde" ? "Oficial" : p.doc === "amarelo" ? "De terceiros" : "Não encontrada" },
        vista: { status: p.vista ? "verde" : "amarelo", texto: p.vista ? "Integrado ao Vista" : "Fora da lista do Vista" },
        dados: c ? { status: statusEtapas, texto: statusEtapas === "verde" ? "Completos" : "Com pendências" } : { status: "cinza", texto: "—" },
        arquivo: c ? { status: c.statusArquivo, texto: c.arquivo, link: c.arquivo } : { status: "cinza", texto: p.formato.startsWith("API") ? "Exige API" : "Não gerado" },
        publicacao: c ? { status: "publicacao", texto: "A cada 10 min" } : { status: "cinza", texto: "—" },
        portal: c ? { status: c.ativacao.status, texto: c.ativacao.status === "verde" ? "Ativo" : "Ativar no portal" } : { status: "cinza", texto: "—" },
      },
    };
  });
  return { geradoEm: (info.agora || new Date()).toISOString(), commit: info.commit || "", geral: pior(...canais.map((c) => c.status)), etapas, canais, portais, avisos: (info.avisos || []).slice(0, 20), numeros: m };
}
