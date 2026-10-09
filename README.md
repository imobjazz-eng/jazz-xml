# jazz-conecta

Feed XML (VRSync) dos imóveis da Jazz para os portais (Canal Pró / Grupo ZAP),
gerado de hora em hora direto da API do Vista.

**URL do feed:** https://imobjazz-eng.github.io/jazz-conecta/vrsync.xml

## Como funciona

1. `.github/workflows/feed-vrsync.yml` roda de hora em hora (minuto 17).
2. `gerador/vista.mjs` baixa o XML VRSync que o próprio Vista gera para os portais (todas as fotos, características, condomínio, IPTU, endereço sem número) e a lista de códigos ativos da API do Vista.
3. `gerador/espelho.mjs` aplica quatro regras sobre o XML do Vista, sem inventar nenhum dado:
   - sai quem a API não reconhece mais (a API é em tempo real; o arquivo do Vista é gerado uma vez por dia);
   - sai quem tem menos de `FEED_MIN_FOTOS` fotos (padrão 7, como no feed antigo);
   - sai preço de venda fora de R$ 15 mil a R$ 150 milhões (limite do Grupo ZAP; os códigos vão para o aviso do log para correção no Vista);
   - no máximo `FEED_MAXIMO` anúncios (padrão 3000, como no feed antigo), priorizando quem tem mais fotos.
4. `gerador/enriquecer.mjs` refaz o enriquecimento do feed antigo, só com dados do próprio anúncio:
   - **título**: até 100 caracteres sem cortar palavra, sem espaço duplo nem hífen grudado, sem caixa alta, sem abreviação (`apto`, `2 dorm`), sem jargão ("excelente oportunidade"), sem contato, e sempre dizendo se é venda ou aluguel ("Sobrado Triplex à venda com 3 dormitórios");
   - **descrição**: `&amp;` corrigido, frase com telefone/e-mail/site removida (proibido no portal), linha em caixa alta vira frase normal (preservando siglas, cidades e bairros), até 3000 caracteres cortando em frase inteira; descrição com menos de 900 caracteres ganha a ficha do imóvel (áreas, quartos, banheiros, vagas, ano, diferenciais, local);
   - **coordenadas**: o pino padrão do Vista no centro do Brasil é descartado; anúncio sem coordenada recebe a da rua, geocodificada no OpenStreetMap (`gerador/geocodificar.mjs`) com as conferências do feed antigo: mesma cidade, mesma rua, dentro do estado. Até `GEO_LIMITE` endereços novos por hora, 1 consulta por segundo, com cache em `geocode.json`.
5. O XML é validado (parser do Python) e publicado no branch `gh-pages` (GitHub Pages), junto com o cache de geocodificação.

## Travas

Nada é publicado se:
- o XML do Vista não vier inteiro (sem o fechamento `</ListingDataFeed>`);
- o feed ficar com menos de `FEED_MINIMO` anúncios (padrão 1000).

O filtro da API é ignorado (com aviso no log) se a API falhar, se entregar
menos de 98% dos códigos, ou se for remover mais de 10% do arquivo de uma vez,
que é sintoma de problema na API e não de imóveis desativados.

Em qualquer trava o XML anterior continua no ar. Feed velho mantém o anúncio
no portal; feed vazio ou truncado derruba.

## Configuração

| Onde | Nome | Obrigatório |
|---|---|---|
| Secrets | `VISTA_API_KEY` | recomendado (filtro de ativos em tempo real) |
| Variables | `FEED_MINIMO` | não (padrão 1000) |
| Variables | `FEED_MIN_FOTOS` | não (padrão 7) |
| Variables | `FEED_MAXIMO` | não (padrão 3000) |
| Variables | `VISTA_XML_URL` | não (padrão: XML de portais do Vista) |
| Variables | `GEO_LIMITE` | não (padrão 200 endereços novos por execução) |

## Rodar local

```sh
node gerador/teste.mjs                                   # testes, sem rede
VISTA_API_KEY=... node gerador/gerar.mjs saida/vrsync.xml  # gera o arquivo
```

## Origem

Extraído de `sampaioopablo1-lgtm/jazz-lead-conecta` (PR #63) quando a Supabase
que montava o feed ficou restrita por cota, em 09/10/2026.

## URL antiga dos portais (Worker da Cloudflare)

Os portais já têm cadastrada a URL
`https://jazz-feed-vrsync.pablo-jazzimob.workers.dev/vrsync.xml`. O Worker em
`worker/index.js` busca o XML do GitHub Pages e entrega nesse endereço, com
cópia de segurança no cache da Cloudflare se o GitHub falhar. Assim ninguém
precisa trocar o cadastro no Canal Pró.

Publicação: `.github/workflows/deploy-worker.yml`, com os segredos
`CLOUDFLARE_API_TOKEN` (permissão "Edit Cloudflare Workers") e
`CLOUDFLARE_ACCOUNT_ID`. Testes: `node worker/teste.mjs`.
