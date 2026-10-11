# Página "Imóveis com o telefone na tela" (GitHub Pages)

Cópia publicada de `imobjazz-eng/jazz-lead-conecta/lp-oportunidades` (fonte
e testes moram lá). Aqui a busca roda no navegador e só a chamada à Gecko
passa pelo banco da Jazz (RPC `oportunidades_pedir`/`oportunidades_resposta`),
que guarda a chave, confere o código de acesso e limita as chamadas por dia.

Endereço: https://imobjazz-eng.github.io/jazz-xml/oportunidades/

Para atualizar: copie `buscar-core.mjs` e `public/index.html` de lá (o
index daqui só ganha `<script src="config.js">` antes do script principal).
O workflow do feed publica esta pasta junto, a cada hora ou sob demanda.
