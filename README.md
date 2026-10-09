# jazz-conecta

Feed XML (VRSync) dos imóveis da Jazz para os portais (Canal Pró / Grupo ZAP),
gerado de hora em hora direto da API do Vista.

**URL do feed:** https://imobjazz-eng.github.io/jazz-conecta/vrsync.xml

## Como funciona

1. `.github/workflows/feed-vrsync.yml` roda de hora em hora (minuto 17).
2. `gerador/vista.mjs` baixa o acervo inteiro do Vista (`/imoveis/listar`, 50 por página, 8 páginas em paralelo).
3. `gerador/vrsync.mjs` monta o XML. Ficam de fora: imóvel sem código, sem finalidade Venda/Aluguel ou sem preço, e códigos duplicados.
4. O XML é validado (parser do Python) e publicado no branch `gh-pages` (GitHub Pages).

## Travas

Nada é publicado se:
- o Vista entregar menos de 98% dos imóveis que declara ter; ou
- o feed ficar com menos de `FEED_MINIMO` anúncios (padrão 1000).

Nesses casos o XML anterior continua no ar. Feed velho mantém o anúncio no
portal; feed vazio ou truncado derruba.

## Configuração

| Onde | Nome | Obrigatório |
|---|---|---|
| Secrets | `VISTA_API_KEY` | sim |
| Variables | `PUBLIC_FEED_CONTACT_NAME`, `PUBLIC_FEED_CONTACT_PHONE` | não |
| Variables | `FEED_MINIMO` | não (padrão 1000) |

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
