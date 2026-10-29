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
];
