// Novedades del panel: mensajes para Valentina y su equipo.
// Cada vez que se suma algo nuevo al panel o a la web, se agrega un mensaje al final con el id siguiente.
// Al entrar, a cada uno le aparece una ventanita con lo que todavía no leyó.
// perm: solo lo ven quienes tienen ese permiso (vacío = todos). rol: solo ese rol (ej: 'admin'). {nombre} se cambia por el nombre de quien entra.
// En el texto: **negrita**, y cada renglón que empieza con "- " es un punto de una lista.

module.exports = [
  {
    id: 1,
    fecha: '2026-10-29',
    icono: '👋',
    titulo: '¡Bienvenida/o a tu panel!',
    perm: '',
    texto: `¡Hola {nombre}! Este es el panel de Carmesí Bags: desde acá manejás la tienda online desde el celular.
- **📷 Agregar producto**: le sacás una foto y lo cargás en 3 pasos.
- **👜 Productos**: ves todo, lo editás o lo marcás sin stock.
- **📖 Guía**: en Inicio tocá "¿Cómo se hace?" y está todo explicado paso a paso.
- **💬** arriba: le escribís a Martín de Pixel Cuyo por cualquier duda.
Por ahora la web está **en construcción** para el público: podés ir cargando todo tranquila/o.`,
  },
  {
    id: 2,
    fecha: '2026-10-29',
    icono: '📸',
    titulo: 'Fotos: cámara, galería y hasta 4 por producto',
    perm: 'products_edit',
    texto: `- **📷 Sacar foto** abre la cámara directo; **🖼️ Galería** elige una que ya tengas.
- Cada producto lleva **hasta 4 fotos**: de frente, de costado, por dentro y un detalle. En la web se pasan deslizando.
- **✨ Quitar fondo**: si la foto tiene un fondo feo, queda con el fondo crema de Carmesí. Si no te gusta, **Deshacer**.`,
  },
  {
    id: 3,
    fecha: '2026-10-29',
    icono: '📝',
    titulo: 'Descripción de cada producto',
    perm: 'products_edit',
    texto: `Al cargar o editar un producto podés poner una **descripción** (opcional): medidas, material, bolsillos, tipo de correa…
La clienta la ve al tocar el producto en la web.`,
  },
  {
    id: 4,
    fecha: '2026-10-29',
    icono: '🏷️',
    titulo: 'Ofertas con precio tachado',
    perm: 'products_edit',
    texto: `Ahora podés poner un producto **en oferta**:
- Editar → poné el precio nuevo → activá **Está en oferta** → poné el **precio anterior** (más alto).
- En la web se ve el de antes tachado y una etiqueta roja con el % de descuento, que se calcula solo.
- Para sacarla: Editar → apagá **Está en oferta** → Guardar.`,
  },
  {
    id: 5,
    fecha: '2026-10-29',
    icono: '🔗',
    titulo: 'Cada producto tiene su propio link',
    perm: 'products_edit',
    texto: `Abrí un producto y tocá **🔗 Copiar link para compartir**. Pegalo en WhatsApp o en una historia de Instagram.
La clienta ve esa cartera con sus fotos, el precio y el botón para pedirla. Cuando te consulte desde ahí, el mensaje ya te llega con el link.
Los links funcionan cuando se abra la web.`,
  },
  {
    id: 6,
    fecha: '2026-10-29',
    icono: '🔔',
    titulo: 'Historial, Excel y campanita de avisos',
    perm: 'activity',
    texto: `- En **⋯ Más → 🕑 Historial** ves todos los cambios en un almanaque y los podés **bajar en Excel**.
- Se guardan los **últimos 6 meses**. 10 días antes de que se borre algo, te avisa la **🔔 campanita** para que lo bajes si lo querés guardar.`,
  },
  {
    id: 7,
    fecha: '2026-10-29',
    icono: '🛍️',
    titulo: '"Avisame cuando vuelva": clientas que esperan stock',
    perm: 'products_edit',
    texto: `Cuando un producto está **sin stock**, en la web aparece el botón **🔔 Avisame cuando vuelva**. La clienta deja su WhatsApp.
- En el panel, ese producto muestra **🔔** con cuántas clientas esperan.
- Cuando vuelva a entrar: abrí el producto, apagá **Sin stock** y tocá **💬 Avisar** en cada clienta. Se abre su WhatsApp con el mensaje y el link ya escritos.
- La **campanita** te recuerda si te quedó alguna sin avisar.`,
  },
  {
    id: 8,
    fecha: '2026-10-29',
    icono: '✨',
    titulo: 'Etiqueta "Nuevo" automática',
    perm: 'products_edit',
    texto: `Los productos que cargás llevan la etiqueta **Nuevo** en la web durante sus **primeros 15 días**. No tenés que hacer nada: aparece y se va sola.
En la tienda también hay un botón **✨ Nuevos** para ver solo esos.`,
  },
  {
    id: 9,
    fecha: '2026-10-29',
    icono: '📊',
    titulo: 'Lo más visto por las clientas',
    perm: 'activity',
    texto: `En **⋯ Más → 📊 Lo más visto** ves qué productos miran más las clientas, cuáles agregan al pedido y cuáles consultan por WhatsApp.
- Podés ver los últimos 7 días, 30 días o 3 meses.
- Te sirve para saber **qué reponer** y qué mostrar en Instagram.
- Lo que mirás vos con el panel abierto no cuenta.`,
  },
  {
    id: 10,
    fecha: '2026-10-29',
    icono: '❓',
    titulo: 'Preguntas frecuentes en la web',
    perm: 'settings',
    texto: `Abajo de los productos ahora hay **preguntas frecuentes** (envíos, pagos…), así las clientas encuentran la respuesta sin escribirte.
Dejé unas de ejemplo: **revisalas y cambialas** en **⋯ Más → ❓ Preguntas frecuentes**, sobre todo lo de envíos y formas de pago.`,
  },
  {
    id: 11,
    fecha: '2026-10-29',
    icono: '💾',
    titulo: 'Tus datos, resguardados todos los días',
    perm: '',
    texto: `Todas las noches se guarda una **copia de seguridad** de la tienda: productos, precios, fotos y usuarios.
Si alguna vez se borra algo por error, avisale a Martín y se puede recuperar.`,
  },
  {
    id: 12,
    fecha: '2026-10-29',
    icono: '🎵',
    titulo: 'TikTok en la web',
    perm: '',
    texto: `Abajo de la web ahora están los íconos de **WhatsApp, Instagram y TikTok** (@bags_carmesi), y también en la página de "en construcción".
Si algún día cambia el usuario, se cambia en **⋯ Más → 💬 WhatsApp y redes**.`,
  },
  {
    id: 13,
    fecha: '2026-10-29',
    icono: '🎞️',
    titulo: 'La web ahora tiene movimiento',
    perm: '',
    texto: `Le sumamos animaciones suaves a la tienda:
- El **logo se dibuja** al entrar y el resto aparece de a poco.
- Una **cinta** con frases pasa de costado debajo de la portada.
- En la compu, al pasar el mouse por un producto se ve **la segunda foto**. Otra razón para cargarle varias 📸
- La bolsita del pedido **salta** cuando agregan algo.
No tenés que hacer nada: funciona solo.`,
  },
  {
    id: 14,
    fecha: '2026-10-29',
    icono: '🎬',
    titulo: 'Video en la portada',
    perm: '',
    texto: `La portada de la web ahora tiene de fondo un video de los neceseres de Carmesí 💛
- En el celu se ve detrás del logo; en la compu, al costado, como un reel.
- Se ve sin sonido y está achicado para que cargue rápido.
Si querés cambiarlo por otro (una colección nueva, una temporada), mandale el video a Martín.`,
  },
  {
    id: 15,
    fecha: '2026-10-29',
    icono: '📝',
    titulo: 'Ahora podés cambiar los textos de la web',
    perm: 'settings',
    texto: `En **⋯ Más → 📝 Textos de la web** cambiás:
- El texto **"Carmesí Bags"** que aparece abajo de los productos (quiénes son, qué venden, dónde entregan).
- Las **frases de la cinta** que pasa de costado debajo de la portada.
Y las **preguntas frecuentes**, en **⋯ Más → ❓ Preguntas frecuentes**. Revisá sobre todo lo de envíos y pagos, así queda como vos trabajás.`,
  },
  {
    id: 16,
    fecha: '2026-10-29',
    icono: '📲',
    titulo: 'El panel como app en tu celu',
    perm: '',
    texto: `Podés tener un ícono de **Carmesí** en la pantalla del celu y entrar al panel con un toque.
Está explicado en **⋯ Más → 📲 Poner el panel en el celu** (para Android y iPhone).
En **Inicio** también tenés la lista **🚀 Para arrancar**, con los primeros pasos. Se van tildando solos.`,
  },
  {
    id: 17,
    fecha: '2026-10-29',
    icono: '✏️',
    titulo: 'Pedile cambios a Martín desde el panel',
    perm: '',
    rol: 'admin',
    texto: `¿Querés algo en la web que no podés cambiar vos (un diseño, una sección nueva…)? Pedíselo desde **⋯ Más → ✏️ Realizar cambios en web**.
- Escribí **un cambio por pedido**, bien explicado.
- Podés pedir hasta **3 cambios por mes** (no se acumulan).
- Abajo ves si tu pedido está **Recibido**, **Visto** o **Hecho**.`,
  },
  {
    id: 18,
    fecha: '2026-10-30',
    icono: '🔍',
    titulo: 'Buscador en la tienda',
    perm: '',
    texto: `Ahora las clientas pueden **buscar** en la web: arriba de las categorías hay un buscador.
- Busca por nombre, color, categoría y descripción (ej: "cartera negra", "leopardo", "matero").
- Si no encuentra nada, les ofrece consultarte por WhatsApp.
💡 Por eso conviene poner nombres y colores claros, y algo de descripción en cada producto.`,
  },
  {
    id: 19,
    fecha: '2026-10-30',
    icono: '📬',
    titulo: 'Tu bandeja de noticias',
    perm: '',
    texto: `Las noticias y mejoras del panel ahora quedan guardadas:
- Cuando hay algo nuevo, te aparece **una vez** al entrar.
- Si la cerrás con la ✕ sin leerla, te queda en la **🔔 campanita** con el número, hasta que la abras.
- Todas las anteriores están en **⋯ Más → 📬 Noticias y mejoras**.
Ahí también te va a escribir Martín cuando haya arreglos o cosas para contarte 💛`,
  },
];
