/**
 * Testes do Worker sem rede: `fetch` e `caches.default` simulados.
 * Rodar: node worker/teste.mjs
 */
const guardado = new Map();
globalThis.caches = {
  default: {
    put: async (k, r) => guardado.set(k, await r.text()),
    match: async (k) => (guardado.has(k) ? new Response(guardado.get(k)) : undefined),
  },
};
let origem = { status: 200, corpo: '<?xml version="1.0"?><Listings><Listing/></Listings>\n' };
globalThis.fetch = async () => {
  if (origem.status === 0) throw new Error("rede caiu");
  return new Response(origem.corpo, { status: origem.status });
};

const { default: worker } = await import("./index.js");
const pendentes = [];
const ctx = { waitUntil: (p) => pendentes.push(p) };
const pedir = async (caminho) => {
  const r = await worker.fetch(new Request(`https://jazz-feed-vrsync.pablo-jazzimob.workers.dev${caminho}`), {}, ctx);
  await Promise.all(pendentes.splice(0));
  return r;
};

let falhas = 0, total = 0;
const ok = (nome, cond, det = "") => {
  total++;
  console.log((cond ? "  ok  " : " FALHA") + "  " + nome + (cond ? "" : "  -> " + det));
  if (!cond) falhas++;
};

let r = await pedir("/vrsync.xml");
ok("serve o XML da origem", r.status === 200 && (await r.text()).includes("<Listing/>"));
ok("content-type XML", r.headers.get("content-type")?.startsWith("application/xml"));
ok("guarda a cópia boa", guardado.size === 1);

origem = { status: 500, corpo: "erro" };
r = await pedir("/vrsync.xml");
ok("origem 500: serve a cópia boa", r.status === 200 && r.headers.get("x-feed-stale") === "1" && (await r.text()).includes("<Listing/>"));

origem = { status: 0 };
r = await pedir("/vrsync.xml");
ok("rede caiu: serve a cópia boa", r.status === 200 && r.headers.get("x-feed-stale") === "1");

origem = { status: 404, corpo: "nao achei" };
r = await pedir("/vrsync.xml");
ok("origem 404: serve a cópia boa", r.headers.get("x-feed-stale") === "1" && (await r.text()).includes("<Listing/>"));

guardado.clear();
origem = { status: 404, corpo: "nao achei" };
r = await pedir("/vrsync.xml");
ok("sem cópia e origem fora: 503", r.status === 503);

r = await pedir("/");
ok("raiz redireciona para /vrsync.xml", r.status === 302 && r.headers.get("location")?.endsWith("/vrsync.xml"));

r = await pedir("/outra");
ok("outro caminho: 404", r.status === 404);

console.log(`\n${total - falhas}/${total} ok`);
process.exit(falhas ? 1 : 0);
