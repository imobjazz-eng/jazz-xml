/**
 * Worker `jazz-feed-vrsync` (Cloudflare) — mantém a URL que os portais já têm:
 *
 *   https://jazz-feed-vrsync.pablo-jazzimob.workers.dev/vrsync.xml
 *
 * O XML é gerado de hora em hora pelo GitHub Actions deste repositório (que
 * confere arquivo completo e piso de anúncios antes de publicar) e fica no
 * GitHub Pages. Este Worker só repassa o arquivo nesse endereço antigo, para
 * ninguém precisar trocar o cadastro no Canal Pró.
 *
 * REPASSA SEM LER. O arquivo tem ~25 MB; ler o corpo para conferir estouraria
 * o limite de CPU do plano gratuito da Cloudflare. O corpo é repassado em
 * fluxo e, em paralelo, guardado no cache como "última cópia boa".
 *
 * PLANO B. Se o GitHub falhar, o portal recebe essa cópia em vez de um erro:
 * feed velho mantém o anúncio no ar; erro o derruba.
 */

const ORIGEM = "https://imobjazz-eng.github.io/jazz-xml/vrsync.xml";
const CHAVE_COPIA = "https://copia-boa.jazz-feed-vrsync/vrsync.xml";
const CABECALHOS = {
  "Content-Type": "application/xml; charset=utf-8",
  // 10 min: os portais leem várias vezes por hora; o arquivo muda de hora em hora.
  "Cache-Control": "public, max-age=600",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/") {
      return Response.redirect(new URL("/vrsync.xml", url).toString(), 302);
    }
    if (url.pathname !== "/vrsync.xml") {
      return new Response("Não encontrado", { status: 404 });
    }

    const cache = caches.default;
    try {
      const r = await fetch(ORIGEM, { cf: { cacheTtl: 600, cacheEverything: true } });
      if (!r.ok || !r.body) throw new Error(`origem respondeu ${r.status}`);
      const [paraPortal, paraCopia] = r.body.tee();
      ctx.waitUntil(
        cache.put(CHAVE_COPIA, new Response(paraCopia, {
          headers: { ...CABECALHOS, "Cache-Control": "public, max-age=2592000" },
        })),
      );
      return new Response(paraPortal, { headers: CABECALHOS });
    } catch (e) {
      const copia = await cache.match(CHAVE_COPIA);
      if (copia) {
        return new Response(copia.body, { headers: { ...CABECALHOS, "X-Feed-Stale": "1" } });
      }
      return new Response(`Feed indisponível: ${e.message}`, { status: 503 });
    }
  },
};
