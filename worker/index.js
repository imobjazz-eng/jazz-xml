/**
 * Worker `jazz-feed-vrsync` (Cloudflare) — mantém a URL que os portais já têm:
 *
 *   https://jazz-feed-vrsync.pablo-jazzimob.workers.dev/vrsync.xml
 *
 * O XML agora é gerado de hora em hora pelo GitHub Actions deste repositório
 * e publicado no GitHub Pages. Este Worker só busca o arquivo lá e entrega no
 * endereço antigo, para ninguém precisar trocar o cadastro no Canal Pró.
 *
 * PLANO B. A cada busca bem-sucedida, a resposta fica guardada no cache da
 * Cloudflare como "última cópia boa". Se o GitHub falhar, o portal recebe essa
 * cópia em vez de um erro: feed velho mantém o anúncio no ar; erro o derruba.
 */

const ORIGEM = "https://imobjazz-eng.github.io/jazz-conecta/vrsync.xml";
const CHAVE_COPIA = "https://copia-boa.jazz-feed-vrsync/vrsync.xml";
const CABECALHOS = {
  "Content-Type": "application/xml; charset=utf-8",
  // 10 min na borda: os portais leem várias vezes por hora e o arquivo muda
  // de hora em hora.
  "Cache-Control": "public, max-age=600",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== "/vrsync.xml" && url.pathname !== "/") {
      return new Response("Não encontrado", { status: 404 });
    }
    if (url.pathname === "/") {
      return Response.redirect(new URL("/vrsync.xml", url).toString(), 302);
    }

    const cache = caches.default;
    try {
      const r = await fetch(ORIGEM, { cf: { cacheTtl: 600, cacheEverything: true } });
      if (!r.ok) throw new Error(`origem respondeu ${r.status}`);
      const corpo = await r.text();
      // Arquivo truncado ou página de erro não vira "cópia boa".
      if (!corpo.includes("<Listings") || !corpo.trimEnd().endsWith("</Listings>")) {
        throw new Error("origem devolveu algo que não é o feed completo");
      }
      const resposta = new Response(corpo, { headers: CABECALHOS });
      ctx.waitUntil(
        cache.put(CHAVE_COPIA, new Response(corpo, {
          headers: { ...CABECALHOS, "Cache-Control": "public, max-age=2592000" },
        })),
      );
      return resposta;
    } catch (e) {
      const copia = await cache.match(CHAVE_COPIA);
      if (copia) {
        return new Response(copia.body, {
          headers: { ...CABECALHOS, "X-Feed-Stale": "1" },
        });
      }
      return new Response(`Feed indisponível: ${e.message}`, { status: 503 });
    }
  },
};
