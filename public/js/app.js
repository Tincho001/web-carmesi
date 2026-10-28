(async function () {
  const $ = (id) => document.getElementById(id);
  // El catálogo lo carga Valentina desde el panel; acá se lee del servidor.
  let datos;
  try {
    const r = await fetch(location.pathname === '/inicio' ? '/api/catalogo?vista=1' : '/api/catalogo');
    if (!r.ok) throw new Error(r.status);
    datos = await r.json();
  } catch (_) {
    $('grilla').innerHTML = '<p class="error-carga">No pudimos cargar los productos. Probá recargar la página.</p>';
    return;
  }
  const { productos, categorias, whatsapp, instagram } = datos;
  const plata = (n) => '$' + n.toLocaleString('es-AR');
  const escapar = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const urlWhatsapp = (texto) => `https://wa.me/${whatsapp}?text=${encodeURIComponent(texto)}`;
  const nombreCategoria = (id) => (categorias.find((c) => c.id === id) || {}).nombre || '';
  const porId = (id) => productos.find((p) => p.id === id);

  // ---------- Links fijos ----------
  const saludo = '¡Hola Carmesí! Quería hacer una consulta 😊';
  $('waPortada').href = urlWhatsapp(saludo);
  $('waFlotante').href = urlWhatsapp(saludo);
  $('waPie').href = urlWhatsapp(saludo);
  $('igPie').href = `https://instagram.com/${instagram}`;

  // ---------- Filtros ----------
  let filtro = 'todos';
  const filtros = $('filtros');
  [{ id: 'todos', nombre: 'Todo' }, ...categorias].forEach((c) => {
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
    const lista = filtro === 'todos' ? productos : productos.filter((p) => p.categoria === filtro);
    grilla.innerHTML = lista.map((p) => `
      <article class="tarjeta${p.agotado ? ' tarjeta--agotada' : ''}">
        <button class="tarjeta__foto" type="button" data-ver="${p.id}" aria-label="Ver ${escapar(p.nombre)} ${escapar(p.color)}">
          <img src="${p.miniatura}" alt="${escapar(p.nombre)} ${escapar(p.color)}" loading="lazy" width="720" height="900">
          ${p.agotado ? '<span class="tarjeta__agotado">Sin stock</span>' : ''}
        </button>
        <h3 class="tarjeta__nombre">${escapar(p.nombre)}</h3>
        <p class="tarjeta__color">${escapar(p.color)}</p>
        <p class="tarjeta__precio">${plata(p.precio)}</p>
        <button class="tarjeta__agregar" type="button" data-agregar="${p.id}"${p.agotado ? ' disabled' : ''}>
          ${p.agotado ? 'Sin stock' : 'Agregar al pedido'}
        </button>
      </article>`).join('');
    const vacio = lista.length === 0;
    $('vacio').hidden = !vacio;
    if (vacio) {
      $('waVacio').href = urlWhatsapp(`¡Hola Carmesí! Quería consultar por ${nombreCategoria(filtro).toLowerCase()} 😊`);
    }
  }
  grilla.addEventListener('click', (e) => {
    const ver = e.target.closest('[data-ver]');
    if (ver) return abrirDetalle(ver.dataset.ver);
    const agregar = e.target.closest('[data-agregar]');
    if (agregar) agregarAlPedido(agregar.dataset.agregar);
  });

  // ---------- Detalle ----------
  const detalle = $('detalle');
  let enDetalle = null;
  function abrirDetalle(id) {
    const p = porId(id);
    enDetalle = p;
    $('detalleFoto').src = p.foto;
    $('detalleFoto').alt = `${p.nombre} ${p.color}`;
    $('detalleCat').textContent = nombreCategoria(p.categoria);
    $('detalleNombre').textContent = p.nombre;
    $('detalleColor').textContent = p.color;
    $('detallePrecio').textContent = plata(p.precio);
    $('detalleDesc').textContent = p.descripcion || '';
    $('detalleDesc').hidden = !p.descripcion;
    $('detalleAgregar').disabled = !!p.agotado;
    $('detalleAgregar').textContent = p.agotado ? 'Sin stock' : 'Agregar al pedido';
    $('detalleConsultar').href = urlWhatsapp(`¡Hola Carmesí! Me interesa la ${p.nombre} (${p.color}) de ${plata(p.precio)}. ¿Está disponible?`);
    detalle.showModal();
  }
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

  // ---------- Aviso ----------
  let temporizador;
  function avisar(texto) {
    const a = $('aviso');
    a.textContent = texto;
    a.classList.add('aviso--visible');
    clearTimeout(temporizador);
    temporizador = setTimeout(() => a.classList.remove('aviso--visible'), 1800);
  }

  pintarGrilla();
  pintarPedido();
})();
