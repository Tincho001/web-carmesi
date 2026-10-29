// Novedades del panel: mensajes para Valentina y su equipo.
// Cada vez que se suma algo nuevo al panel o a la web, se agrega un mensaje al final con el id siguiente.
// Al entrar, a cada uno le aparece una ventanita con lo que todavía no leyó.
// perm: solo lo ven quienes tienen ese permiso (vacío = todos). {nombre} se cambia por el nombre de quien entra.
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
];
