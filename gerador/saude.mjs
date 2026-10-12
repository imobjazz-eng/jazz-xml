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
  const canais = [
    {
      id: "zap", nome: "Grupo ZAP (ZAP Imóveis, VivaReal, OLX)", arquivo: "vrsync.xml",
      status: pior(statusEtapas, n >= (info.minimo ?? 1000) ? "verde" : "vermelho"),
      resumo: `${n} anúncios · ${m.megabytes} MB`, leitura: "O portal lê várias vezes ao dia.",
    },
    {
      id: "chavesnamao", nome: "Chaves na Mão", arquivo: "chavesnamao.xml",
      status: info.chavesNaMao == null ? "vermelho" : pior(statusEtapas, info.chavesNaMao >= n * 0.95 ? "verde" : "amarelo"),
      resumo: info.chavesNaMao == null ? "Arquivo não gerado nesta execução" : `${info.chavesNaMao} imóveis`,
      leitura: "O portal lê uma vez por dia (depois de ativado no portal).",
    },
  ];
  return { geradoEm: (info.agora || new Date()).toISOString(), commit: info.commit || "", geral: pior(...canais.map((c) => c.status)), etapas, canais, avisos: (info.avisos || []).slice(0, 20), numeros: m };
}
