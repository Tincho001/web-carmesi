(async function () {
  const $ = (id) => document.getElementById(id);
  // El catálogo lo carga Valentina desde el panel; acá se lee del servidor.
  // Vista previa (mientras la web está en construcción): /inicio o cualquier página con ?vista=1.
  const vista = location.pathname === '/inicio' || new URLSearchParams(location.search).has('vista');
  let datos;
  try {
    const r = await fetch(vista ? '/api/catalogo?vista=1' : '/api/catalogo');
    if (!r.ok) throw new Error(r.status);
    datos = await r.json();
  } catch (_) {
    $('grilla').innerHTML = '<p class="error-carga">No pudimos cargar los productos. Probá recargar la página.</p>';
    return;
  }
  const { productos, categorias, whatsapp, instagram } = datos;
  const plata = (n) => '$' + n.toLocaleString('es-AR');
  const descuento = (p) => Math.round((1 - p.precio / p.precioAnterior) * 100);
  // Precio con el anterior tachado si está en oferta.
  const precioHtml = (p) => p.precioAnterior
    ? `<s class="precio-antes">${plata(p.precioAnterior)}</s> <span class="precio-oferta">${plata(p.precio)}</span>`
    : plata(p.precio);
  const escapar = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const urlWhatsapp = (texto) => `https://wa.me/${whatsapp}?text=${encodeURIComponent(texto)}`;
  const nombreCategoria = (id) => (categorias.find((c) => c.id === id) || {}).nombre || '';
  const porId = (id) => productos.find((p) => p.id === id);
  // Cada producto tiene su página: /producto/cartera-monos-negro
  const enlace = (p) => p.url + (vista ? '?vista=1' : '');
  const consulta = (p) => `¡Hola Carmesí! Me interesa la ${p.nombre} (${p.color}) de ${plata(p.precio)}. ¿Está disponible?\n${location.origin}${p.url}`;

  // Números para el panel (qué miran las clientas). En la vista previa no se cuenta nada.
  function evento(tipo, id) {
    if (vista || !id) return;
    const datos = JSON.stringify({ tipo, productId: Number(id) });
    try { if (navigator.sendBeacon && navigator.sendBeacon('/api/evento', datos)) return; } catch (_) { /* sigue */ }
    fetch('/api/evento', { method: 'POST', body: datos, keepalive: true }).catch(() => {});
  }
  // Una vista por producto y por visita.
  function vio(id) {
    let vistos = [];
    try { vistos = JSON.parse(sessionStorage.getItem('carmesi-vistos')) || []; } catch (_) { vistos = []; }
    if (vistos.includes(id)) return;
    vistos.push(id);
    try { sessionStorage.setItem('carmesi-vistos', JSON.stringify(vistos)); } catch (_) { /* sin almacenamiento */ }
    evento('vista', id);
  }

  async function compartir(p) {
    evento('compartir', p.id);
    const url = location.origin + p.url;
    const titulo = `${p.nombre} ${p.color} — ${plata(p.precio)} | Carmesí Bags`;
    if (navigator.share) {
      try { await navigator.share({ title: titulo, url }); } catch (_) { /* la cerró */ }
      return;
    }
    try { await navigator.clipboard.writeText(url); avisar('Link copiado ✓'); } catch (_) { window.prompt('Copiá el link:', url); }
  }

  // Carrusel de fotos con puntitos y flechas (en el detalle y en la página del producto).
  function carrusel(fotos, puntos, antes, despues) {
    fotos.addEventListener('scroll', () => {
      const i = Math.round(fotos.scrollLeft / fotos.clientWidth);
      puntos.querySelectorAll('span').forEach((s, k) => s.classList.toggle('on', k === i));
    });
    antes.addEventListener('click', () => fotos.scrollBy({ left: -fotos.clientWidth, behavior: 'smooth' }));
    despues.addEventListener('click', () => fotos.scrollBy({ left: fotos.clientWidth, behavior: 'smooth' }));
  }

  // En la vista previa, los links a la portada se quedan dentro de la vista previa.
  if (vista) {
    document.querySelectorAll('a[href="/"], a[href^="/#"]').forEach((a) => { a.href = '/inicio' + a.getAttribute('href').slice(1); });
  }

  // ---------- Links fijos ----------
  const saludo = '¡Hola Carmesí! Quería hacer una consulta 😊';
  if ($('waPortada')) $('waPortada').href = urlWhatsapp(saludo); // la página de un producto no tiene portada
  $('waFlotante').href = urlWhatsapp(saludo);
  $('waPie').href = urlWhatsapp(saludo);
  $('igPie').href = `https://instagram.com/${instagram}`;
  // El usuario de Instagram y el WhatsApp salen de lo que está cargado en el panel.
  $('igPieTexto').textContent = '@' + instagram;
  $('waPieTexto').textContent = 'WhatsApp ' + String(whatsapp).replace(/^549/, '').replace(/^(\d{3})(\d{3})(\d+)$/, '$1 $2-$3');

  // ---------- Filtros ----------
  let filtro = 'todos';
  const filtros = $('filtros');
  const hayNuevos = productos.some((p) => p.nuevo);
  [{ id: 'todos', nombre: 'Todo' }, ...(hayNuevos ? [{ id: 'nuevos', nombre: '✨ Nuevos' }] : []), ...categorias].forEach((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'filtro';
    b.textContent = c.nombre;
    b.dataset.cat = c.id;
    b.setAttribute('aria-pressed', String(c.id === filtro));
    filtros.appendChild(b);
  });
  filtros.addEventListener('click', (e) => {
    const b = e.target.closest('.filtro');
    if (!b) return;
    filtro = b.dataset.cat;
    filtros.querySelectorAll('.filtro').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    pintarGrilla();
  });

  // ---------- Grilla ----------
  const grilla = $('grilla');
  function pintarGrilla() {
    const lista = filtro === 'todos' ? productos : filtro === 'nuevos' ? productos.filter((p) => p.nuevo) : productos.filter((p) => p.categoria === filtro);
    grilla.innerHTML = lista.map((p) => `
      <article class="tarjeta${p.agotado ? ' tarjeta--agotada' : ''}">
        <a class="tarjeta__foto" href="${enlace(p)}" data-ver="${p.id}" aria-label="Ver ${escapar(p.nombre)} ${escapar(p.color)}">
          <img src="${p.miniatura}" alt="${escapar(p.nombre)} ${escapar(p.color)}" loading="lazy" width="720" height="900">
          ${p.agotado ? '<span class="tarjeta__agotado">Sin stock</span>' : ''}
          ${p.precioAnterior && !p.agotado ? `<span class="tarjeta__oferta">Oferta -${descuento(p)}%</span>` : ''}
          ${p.nuevo ? '<span class="tarjeta__nuevo">Nuevo</span>' : ''}
          ${p.fotos && p.fotos.length > 1 ? `<span class="tarjeta__fotos">📷 ${p.fotos.length}</span>` : ''}
        </a>
        <h3 class="tarjeta__nombre">${escapar(p.nombre)}</h3>
        <p class="tarjeta__color">${escapar(p.color)}</p>
        <p class="tarjeta__precio">${precioHtml(p)}</p>
        ${p.agotado
          ? `<button class="tarjeta__agregar" type="button" data-avisame="${p.id}">🔔 Avisame</button>`
          : `<button class="tarjeta__agregar" type="button" data-agregar="${p.id}">Agregar al pedido</button>`}
      </article>`).join('');
    const vacio = lista.length === 0;
    $('vacio').hidden = !vacio;
    if (vacio) {
      $('waVacio').href = urlWhatsapp(`¡Hola Carmesí! Quería consultar por ${nombreCategoria(filtro).toLowerCase()} 😊`);
    }
  }
  grilla.addEventListener('click', (e) => {
    const ver = e.target.closest('[data-ver]');
    // Toque normal: se abre el detalle acá mismo. Ctrl/⌘ + clic abre la página del producto.
    if (ver && !(e.ctrlKey || e.metaKey || e.shiftKey)) { e.preventDefault(); return abrirDetalle(ver.dataset.ver); }
    const agregar = e.target.closest('[data-agregar]');
    if (agregar) agregarAlPedido(agregar.dataset.agregar);
    const av = e.target.closest('[data-avisame]');
    if (av) abrirAvisame(porId(av.dataset.avisame));
  });

  // ---------- Detalle ----------
  const detalle = $('detalle');
  let enDetalle = null;
  function abrirDetalle(id) {
    const p = porId(id);
    enDetalle = p;
    // Hasta 4 fotos: se pasan deslizando (o con las flechas en la compu).
    const fotos = p.fotos && p.fotos.length ? p.fotos : [p.foto];
    $('detalleFotos').innerHTML = fotos.map((src, i) =>
      `<img src="${src}" alt="${escapar(p.nombre)} ${escapar(p.color)}${fotos.length > 1 ? ` (foto ${i + 1} de ${fotos.length})` : ''}">`).join('');
    $('detalleFotos').scrollLeft = 0;
    const varias = fotos.length > 1;
    $('detallePuntos').hidden = !varias;
    $('fotoAnterior').hidden = !varias;
    $('fotoSiguiente').hidden = !varias;
    $('detallePuntos').innerHTML = fotos.map((_, i) => `<span${i ? '' : ' class="on"'}></span>`).join('');
    $('detalleCat').textContent = nombreCategoria(p.categoria);
    $('detalleNombre').textContent = p.nombre;
    $('detalleColor').textContent = p.color;
    $('detallePrecio').innerHTML = precioHtml(p) + (p.precioAnterior ? ` <span class="chip-oferta">-${descuento(p)}%</span>` : '');
    $('detalleDesc').textContent = p.descripcion || '';
    $('detalleDesc').hidden = !p.descripcion;
    $('detalleNuevo').hidden = !p.nuevo;
    $('detalleAgregar').disabled = !!p.agotado;
    $('detalleAgregar').textContent = p.agotado ? 'Sin stock' : 'Agregar al pedido';
    $('detalleAvisame').hidden = !p.agotado;
    $('detalleConsultar').href = urlWhatsapp(consulta(p));
    detalle.showModal();
    vio(p.id);
  }
  carrusel($('detalleFotos'), $('detallePuntos'), $('fotoAnterior'), $('fotoSiguiente'));
  $('detalleCompartir').addEventListener('click', () => compartir(enDetalle));
  $('detalleConsultar').addEventListener('click', () => evento('whatsapp', enDetalle.id));
  $('detalleAvisame').addEventListener('click', () => { detalle.close(); abrirAvisame(enDetalle); });

  // ---------- Avisame cuando vuelva ----------
  let enAvisame = null;
  function abrirAvisame(p) {
    enAvisame = p;
    $('avisameProd').textContent = `${p.nombre} ${p.color} no tiene stock ahora. Dejanos tu WhatsApp y te avisamos cuando vuelva.`;
    $('formAvisame').hidden = false;
    $('avisameListo').hidden = true;
    $('avisameError').hidden = true;
    $('avisame').showModal();
  }
  $('formAvisame').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const boton = f.querySelector('[type="submit"]');
    boton.disabled = true;
    try {
      const r = await fetch('/api/avisame', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: Number(enAvisame.id), nombre: f.nombre.value, telefono: f.telefono.value }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'No se pudo guardar. Probá de nuevo.');
      f.hidden = true;
      $('avisameListo').hidden = false;
    } catch (err) {
      $('avisameError').textContent = err.message;
      $('avisameError').hidden = false;
    } finally { boton.disabled = false; }
  });

  $('detalleAgregar').addEventListener('click', () => {
    agregarAlPedido(enDetalle.id);
    detalle.close();
  });

  // Cerrar diálogos con la X o tocando afuera
  document.querySelectorAll('dialog').forEach((d) => {
    d.addEventListener('click', (e) => {
      if (e.target === d || e.target.closest('[data-cerrar]')) d.close();
    });
  });

  // ---------- Pedido ----------
  const CLAVE = 'carmesi-pedido';
  let pedido = {};
  try { pedido = JSON.parse(localStorage.getItem(CLAVE)) || {}; } catch (_) { pedido = {}; }
  // Descarta productos que ya no están en el catálogo
  Object.keys(pedido).forEach((id) => { if (!porId(id)) delete pedido[id]; });

  function guardar() {
    try { localStorage.setItem(CLAVE, JSON.stringify(pedido)); } catch (_) { /* sin almacenamiento */ }
  }

  function agregarAlPedido(id) {
    evento('agregado', id);
    pedido[id] = (pedido[id] || 0) + 1;
    guardar();
    pintarPedido();
    avisar('Agregado a tu pedido ✓');
  }

  function cambiarCantidad(id, delta) {
    pedido[id] = (pedido[id] || 0) + delta;
    if (pedido[id] <= 0) delete pedido[id];
    guardar();
    pintarPedido();
  }

  function pintarPedido() {
    const items = Object.entries(pedido).map(([id, cant]) => ({ p: porId(id), cant }));
    const unidades = items.reduce((s, i) => s + i.cant, 0);
    const total = items.reduce((s, i) => s + i.cant * i.p.precio, 0);

    const contador = $('contador');
    contador.hidden = unidades === 0;
    contador.textContent = unidades;

    $('pedidoVacio').hidden = unidades > 0;
    $('pedidoPie').hidden = unidades === 0;
    $('pedidoLista').innerHTML = items.map(({ p, cant }) => `
      <li class="pedido__item">
        <img src="${p.miniatura}" alt="">
        <div>
          <p class="pedido__item-nombre">${escapar(p.nombre)}</p>
          <p class="pedido__item-color">${escapar(p.color)}</p>
          <p class="pedido__item-precio">${plata(p.precio * cant)}</p>
        </div>
        <div class="cantidad">
          <button type="button" data-menos="${p.id}" aria-label="Quitar uno">−</button>
          <span>${cant}</span>
          <button type="button" data-mas="${p.id}" aria-label="Sumar uno">+</button>
        </div>
      </li>`).join('');
    $('pedidoTotal').textContent = plata(total);

    const lineas = items.map(({ p, cant }) => `• ${cant} x ${p.nombre} (${p.color}) — ${plata(p.precio * cant)}`);
    $('pedidoEnviar').href = urlWhatsapp(
      `¡Hola Carmesí! Quiero hacer este pedido:\n\n${lineas.join('\n')}\n\nTotal: ${plata(total)}\n\n¿Cómo seguimos?`
    );
  }

  $('pedidoLista').addEventListener('click', (e) => {
    const mas = e.target.closest('[data-mas]');
    const menos = e.target.closest('[data-menos]');
    if (mas) cambiarCantidad(mas.dataset.mas, 1);
    if (menos) cambiarCantidad(menos.dataset.menos, -1);
  });
  $('pedidoVaciar').addEventListener('click', () => {
    pedido = {};
    guardar();
    pintarPedido();
  });
  $('abrirPedido').addEventListener('click', () => $('pedido').showModal());
  $('pedidoEnviar').addEventListener('click', () => Object.keys(pedido).forEach((id) => evento('pedido', id)));

  // ---------- Aviso ----------
  let temporizador;
  function avisar(texto) {
    const a = $('aviso');
    a.textContent = texto;
    a.classList.add('aviso--visible');
    clearTimeout(temporizador);
    temporizador = setTimeout(() => a.classList.remove('aviso--visible'), 1800);
  }

  // ---------- Página de un producto (la arma el servidor; acá se le dan vida a los botones) ----------
  const pagina = $('producto');
  const enPagina = pagina && porId(pagina.dataset.id);
  if (enPagina) {
    carrusel($('prodFotos'), $('prodPuntos'), $('prodAnterior'), $('prodSiguiente'));
    $('prodAgregar').addEventListener('click', () => agregarAlPedido(enPagina.id));
    $('prodConsultar').href = urlWhatsapp(consulta(enPagina));
    $('prodCompartir').addEventListener('click', () => compartir(enPagina));
    $('prodConsultar').addEventListener('click', () => evento('whatsapp', enPagina.id));
    if ($('prodAvisame')) $('prodAvisame').addEventListener('click', () => abrirAvisame(enPagina));
    vio(enPagina.id);
    $('etiquetaProductos').textContent = 'Más productos';
  }

  pintarGrilla();
  pintarPedido();
})();
