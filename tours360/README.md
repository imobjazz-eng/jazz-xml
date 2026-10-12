# Tour 360° — como enviar

O corretor faz só duas coisas: **fotografar** e **enviar**. A montagem do tour, a página e o link no
XML dos portais saem sozinhos em até ~10 minutos.

## 1. Fotografar (no imóvel)

- Uma foto 360 por ambiente (sala, cozinha, quartos, banheiros, área externa).
- Celular: app gratuito de foto esférica (ex.: "Panorama 360" ou o modo "Photo Sphere"/"Panorama 360°" da
  câmera). Câmera 360 (Insta360, Ricoh Theta) é mais rápida, mas não é obrigatória.
- Celular no meio do cômodo, na altura do peito, luzes acesas, cortinas abertas.
- A foto precisa sair em **JPG no formato 2:1** (ex.: 8000 x 4000). Foto comum ou panorama "faixa" é
  ignorada e aparece como aviso no log da geração.

## 2. Enviar (pelo navegador ou celular)

1. Abra <https://github.com/imobjazz-eng/jazz-xml/tree/main/tours360>.
2. **Add file → Upload files**.
3. Arraste **uma pasta com o código do imóvel no Vista** (ex.: `12345`) contendo as fotos.
   Sem pasta à mão: em **Add file → Create new file** digite `12345/` antes do nome, e depois envie as fotos nela.
4. Nomeie as fotos na ordem do passeio: `1-sala.jpg`, `2-cozinha.jpg`, `3-suite.jpg`...
   O nome vira o rótulo do ambiente ("Sala", "Cozinha", "Suite").
5. **Commit changes**.

Pronto. O tour fica em `https://imobjazz-eng.github.io/jazz-xml/tour360/?c=12345` e entra no anúncio
como `VirtualTourLink`. Para trocar, envie fotos novas com o mesmo nome; para tirar, apague a pasta.

Tour cadastrado no próprio Vista continua tendo preferência.
