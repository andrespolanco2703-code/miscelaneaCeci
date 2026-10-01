# Cecilia · Miscelánea para Windows

Programa de escritorio (instalador .exe) que funciona **sin internet**. Los datos quedan guardados en ese computador.

## Cómo obtener el instalador (gratis, en la nube de GitHub)
1. En github.com crea un repositorio nuevo llamado `cecilia-pc` (vacío, sin README).
2. Sube el contenido de esta carpeta con **Add file → Upload files** (`www`, `build`, `main.js`, `preload.js`, `sync.js`, `modelo.js`, `firebase-config.js`, `package.json`).
3. Crea a mano el archivo `.github/workflows/construir-exe.yml` con **Add file → Create new file** y pega el contenido
   que aparece en este mismo proyecto (si la carpeta `.github` se subió sola, no hace falta).
4. Abre la pestaña **Actions**: "Construir programa para Windows" tarda unos 5 minutos.
5. Entra a la ejecución con marca verde y, en **Artifacts**, baja **cecilia-instalador-windows**. Dentro del zip está
   `Cecilia Setup 1.1.0.exe`.
6. Cópialo al computador del negocio, haz doble clic y sigue el asistente. Queda un ícono en el escritorio.

## Cosas que debes saber
- Windows puede avisar "Windows protegió su PC" porque el instalador no está firmado. Toca **Más información → Ejecutar de todas formas**.
- Los datos se guardan en un archivo del computador (`%APPDATA%\Cecilia\datos`), sin el límite de 5 MB de antes. Cada día se hace una copia automática en la carpeta `copias` (quedan las últimas 30). Además puedes usar Ajustes ⚙ → **Exportar copia**.
- Si ya usabas la versión 1.0.0, al abrir la 1.1.0 los datos pasan solos al archivo nuevo (las fotos de facturas también).
- F11 pone la app en pantalla completa.
- La lectura de códigos con la cámara del PC puede no funcionar; un lector USB o Bluetooth sí, porque escribe el código como teclado.
- Para actualizar la app: cambia `www/index.html` en GitHub y se construye un instalador nuevo (se instala encima sin perder datos).

## Copia en la nube (Firebase)
La app sigue funcionando sin internet; la nube es una copia que se sube sola unos segundos después de cada cambio.

1. En la consola de Firebase (proyecto **MISCELANEA**) activa **Firestore Database** (modo producción) y **Authentication → Correo/contraseña**.
2. En Authentication → **Usuarios** agrega el correo y la clave de Cecilia.
3. En Firestore → **Reglas**, pega el contenido de `firestore.rules` y pulsa **Publicar**. Sin este paso nadie puede guardar (o, si dejaste reglas abiertas, cualquiera podría leer).
4. En la app: Ajustes ⚙ → **☁ Nube** → escribe ese correo y clave → **Conectar**.

Detalles:
- La clave se guarda cifrada con Windows (no en texto plano) para no pedirla cada vez.
- Las **fotos de facturas no van a la nube**; solo están en el computador. Si restauras en otro PC, esas facturas aparecerán sin foto.
- En un computador nuevo, al conectar la misma cuenta, la app pregunta si traer los datos de la nube o subir los de ese PC. No pisa nada sin preguntar.
- Pensado para **un solo computador activo**. Si usas dos a la vez, el último en sincronizar gana.
- Plan gratis (Spark): unos 20.000 escrituras al día. Una venta es 1 escritura, así que alcanza de sobra.
