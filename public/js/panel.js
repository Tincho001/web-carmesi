(function () {
  const $ = (id) => document.getElementById(id);
  const plata = (n) => '$' + Number(n).toLocaleString('es-AR');
  const descuento = (precio, antes) => Math.round((1 - precio / antes) * 100);
  const escapar = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let yo = null;
  let categorias = [];
  let productos = [];

  // ---------- llamadas al servidor ----------
  async function api(method, url, body) {
    const r = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401 && url !== '/api/login' && url !== '/api/me/password') { mostrarLogin(); throw new Error('Iniciá sesión'); }
    if (!r.ok) throw Object.assign(new Error(data.error || 'Algo salió mal. Probá de nuevo.'), { data });
    return data;
  }

  function mostrarError(el, err) {
    el.textContent = err ? err.message || err : '';
    el.hidden = !err;
  }

  let temporizador;
  function avisar(texto) {
    const a = $('aviso');
    a.textContent = texto;
    a.classList.add('aviso--visible');
    clearTimeout(temporizador);
    temporizador = setTimeout(() => a.classList.remove('aviso--visible'), 2000);
  }

  // ---------- login ----------
  function mostrarLogin() {
    $('app').hidden = true;
    $('login').hidden = false;
  }

  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const { user } = await api('POST', '/api/login', { username: f.get('username'), password: f.get('password') });
      e.target.reset();
      mostrarError($('loginError'), null);
      await entrar(user);
    } catch (err) { mostrarError($('loginError'), err); }
  });

  const ROL_NOMBRE = { super: 'Pixel Cuyo (control total)', admin: 'Administradora', vendedor: 'Vendedor/a' };
  // Lo que puede hacer quien entró: lo manda el servidor según los permisos de su nivel.
  let permisos = {};
  const puede = {
    super: () => yo.role === 'super',
    hacer: (clave) => yo.role === 'super' || !!permisos[clave],
  };
  let enObra = false;

  async function entrar(user, me) {
    yo = user;
    if (!me) me = await api('GET', '/api/me');
    permisos = me.perms || {};
    $('login').hidden = true;
    $('app').hidden = false;
    const nombre = user.alias || user.username;
    $('saludo').textContent = `Hola, ${nombre} 👋`;
    $('quien').innerHTML = `<strong>${escapar(nombre)}</strong><span>${escapar(user.username)} · ${ROL_NOMBRE[user.role] || user.role}</span>`;
    document.querySelectorAll('[data-solo]').forEach((el) => { el.hidden = !puede[el.dataset.solo](); });
    document.querySelectorAll('[data-perm]').forEach((el) => { el.hidden = !el.dataset.perm.split('|').some(puede.hacer); });
    $('nuevaCat').hidden = !puede.hacer('categories');
    pintarObra(me.maintenance);
    // Martín (Pixel Cuyo) no necesita el botón para escribirse a sí mismo.
    const link = urlConsulta();
    $('consultarMartin').hidden = puede.super();
    $('consultaCaja').hidden = puede.super();
    $('consultarMartin').href = link;
    $('consultarMartin2').href = link;
    $('consultarMartin3').href = link;
    $('consultarMartin3').hidden = puede.super();
    pintarAvisos();
    await cargar();
    irA(location.hash.slice(1) || 'inicio');
  }

  function pintarObra(obra) {
    enObra = obra;
    $('cartelObra').hidden = !obra;
    $('menuObra').innerHTML = obra
      ? '<span aria-hidden="true">🚀</span> Abrir la web al público'
      : '<span aria-hidden="true">🧵</span> Poner la web en construcción';
  }

  async function cargar() {
    const [c, p] = await Promise.all([api('GET', '/api/categories'), api('GET', '/api/products')]);
    categorias = c.categories;
    productos = p.products;
    pintarTodo();
  }

  function pintarTodo() {
    pintarInicio();
    pintarFiltros();
    pintarGrilla();
    pintarCategorias();
  }

  // ---------- 📖 guía del panel ----------
  // Cada tema tiene data-perm: solo aparecen los de lo que cada uno puede hacer.
  function abrirGuia() {
    $('guiaBuscar').value = '';
    filtrarGuia();
    $('dlgGuia').showModal();
  }
  const sinTildes = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  function filtrarGuia() {
    const q = sinTildes($('guiaBuscar').value.trim());
    let hay = 0;
    $('guia').querySelectorAll('.guia__tema').forEach((t) => {
      if (t.dataset.perm && !t.dataset.perm.split('|').some(puede.hacer)) return;
      const ok = !q || sinTildes(t.textContent).includes(q);
      t.style.display = ok ? '' : 'none';
      t.open = !!q && ok;
      if (ok) hay++;
    });
    $('guiaVacia').hidden = hay > 0;
  }
  $('guiaBuscar').addEventListener('input', filtrarGuia);
  $('menuGuia').addEventListener('click', abrirGuia);
  $('inicioGuia').addEventListener('click', abrirGuia);
  // Al abrir un tema se cierran los demás, para que no quede una lista larguísima.
  $('guia').addEventListener('toggle', (e) => {
    if (!e.target.open || $('guiaBuscar').value) return;
    $('guia').querySelectorAll('.guia__tema[open]').forEach((t) => { if (t !== e.target) t.open = false; });
  }, true);

  // ---------- 🔔 avisos y 💬 consulta a Martín ----------
  const WA_MARTIN = '5492617206192';
  const urlConsulta = () => `https://wa.me/${WA_MARTIN}?text=${encodeURIComponent(`¡Hola Martín! Soy ${yo.alias || yo.username} de Carmesí. Te quería consultar: `)}`;

  let avisos = [];
  async function pintarAvisos() {
    try { avisos = (await api('GET', '/api/avisos')).avisos; } catch (_) { return; }
    $('avisosN').hidden = !avisos.length;
    $('avisosN').textContent = avisos.length;
    $('listaAvisos').innerHTML = avisos.map((a, i) => `
      <li class="aviso-item">
        <span class="aviso-item__icono" aria-hidden="true">${a.icono}</span>
        <div>
          <strong>${escapar(a.titulo)}</strong>
          <p>${escapar(a.texto)}</p>
          ${a.descargar ? `<button type="button" class="btn btn--bordo" data-aviso-excel="${i}">⬇️ Bajar en Excel</button>` : ''}
        </div>
      </li>`).join('') || '<li class="vacio">No tenés avisos. 👌</li>';
  }
  // Se revisa cada media hora mientras el panel está abierto.
  setInterval(() => { if (yo) pintarAvisos(); }, 30 * 60e3);

  $('abrirAvisos').addEventListener('click', async () => {
    await pintarAvisos();
    $('dlgAvisos').showModal();
  });

  $('listaAvisos').addEventListener('click', (e) => {
    const b = e.target.closest('[data-aviso-excel]');
    if (!b) return;
    const a = avisos[Number(b.dataset.avisoExcel)];
    bajarExcel(a.descargar.from, a.descargar.to);
  });

  // La descarga la arma el servidor (archivo .xlsx).
  function bajarExcel(desde, hasta) {
    const a = document.createElement('a');
    a.href = `/api/activity/export?from=${desde}&to=${hasta}`;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
    avisar('Bajando el Excel…');
  }

  // ---------- navegación (barra de abajo) ----------
  const TITULOS = { inicio: 'Inicio', productos: 'Productos', categorias: 'Categorías', mas: 'Más' };

  function irA(pantalla) {
    if (!TITULOS[pantalla] || (pantalla === 'categorias' && !puede.hacer('categories'))) pantalla = 'inicio';
    document.querySelectorAll('[data-pantalla]').forEach((s) => { s.hidden = s.dataset.pantalla !== pantalla; });
    document.querySelectorAll('[data-ir]').forEach((b) => {
      if (b.dataset.ir === pantalla) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    $('tituloPantalla').textContent = TITULOS[pantalla];
    if (location.hash.slice(1) !== pantalla) history.replaceState(null, '', `#${pantalla}`);
    window.scrollTo(0, 0);
  }

  document.querySelector('.barra').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ir]');
    if (b) irA(b.dataset.ir);
  });

  // ---------- inicio ----------
  function pintarInicio() {
    const sinStock = productos.filter((p) => p.soldOut).length;
    const ocultos = productos.filter((p) => p.hidden).length;
    const cajas = [
      { n: productos.length, t: 'Productos', filtro: 'todos' },
      { n: sinStock, t: 'Sin stock', filtro: 'sinstock', alerta: sinStock > 0 },
      { n: ocultos, t: 'Ocultos', filtro: 'ocultos' },
      { n: categorias.length, t: 'Categorías', ir: 'categorias' },
    ];
    $('numeros').innerHTML = cajas.map((c) => `
      <button type="button" class="numero${c.alerta ? ' numero--alerta' : ''}" ${c.filtro ? `data-filtrar="${c.filtro}"` : `data-ir-a="${c.ir}"`}>
        <strong>${c.n}</strong><span>${c.t}</span>
      </button>`).join('');
    if (puede.hacer('activity')) pintarUltimos();
  }

  async function pintarUltimos() {
    try {
      const { items } = await api('GET', '/api/activity?limit=5');
      $('listaUltimos').innerHTML = items.map((a) => `
        <li><strong>${escapar(a.who.replace(/ \(.*\)$/, ''))}</strong> ${ACCION[a.action] || a.action} ${escapar(a.name)}
          ${a.changes.length ? `<span>${escapar(a.changes.join(' · '))}</span>` : ''}
          <time>${hace(a.at)}</time></li>`).join('') || '<li class="vacio">Todavía no hay cambios.</li>';
    } catch (_) { /* si falla, no se muestra */ }
  }

  function hace(at) {
    const min = Math.round((Date.now() - at) / 60000);
    if (min < 1) return 'recién';
    if (min < 60) return `hace ${min} min`;
    if (min < 1440) return `hace ${Math.round(min / 60)} h`;
    return new Date(at).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
  }

  $('numeros').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.irA) return irA(b.dataset.irA);
    filtro = b.dataset.filtrar;
    pintarFiltros();
    pintarGrilla();
    irA('productos');
  });

  $('inicioAgregar').addEventListener('click', () => abrirAsistente({ modo: 'nuevo' }));

  // ---------- productos: filtros y grilla ----------
  let filtro = 'todos';
  $('buscar').addEventListener('input', pintarGrilla);

  function pintarFiltros() {
    const opciones = [{ id: 'todos', nombre: 'Todo' }, ...categorias.map((c) => ({ id: String(c.id), nombre: c.name })),
      { id: 'sinstock', nombre: 'Sin stock' }, { id: 'ocultos', nombre: 'Ocultos' }];
    if (!opciones.some((o) => o.id === filtro)) filtro = 'todos';
    $('filtros').innerHTML = opciones.map((o) =>
      `<button type="button" class="chip" data-filtro="${o.id}" aria-pressed="${o.id === filtro}">${escapar(o.nombre)}</button>`).join('');
  }

  $('filtros').addEventListener('click', (e) => {
    const b = e.target.closest('[data-filtro]');
    if (!b) return;
    filtro = b.dataset.filtro;
    pintarFiltros();
    pintarGrilla();
  });

  function pintarGrilla() {
    const q = $('buscar').value.trim().toLowerCase();
    const lista = productos.filter((p) =>
      (filtro === 'todos' || (filtro === 'sinstock' ? p.soldOut : filtro === 'ocultos' ? p.hidden : String(p.categoryId) === filtro)) &&
      (!q || `${p.name} ${p.color}`.toLowerCase().includes(q)));
    $('grilla').innerHTML = lista.map((p) => `
      <button type="button" class="tarjeta${p.hidden ? ' tarjeta--oculta' : ''}" data-ficha="${p.id}">
        <span class="tarjeta__foto">
          <img src="${p.thumb || ''}" alt="" loading="lazy">
          ${p.soldOut ? '<em class="marca marca--stock">Sin stock</em>' : ''}
          ${p.hidden ? '<em class="marca marca--oculto">Oculto</em>' : ''}
          ${p.oldPrice ? `<em class="marca marca--oferta">-${descuento(p.price, p.oldPrice)}%</em>` : ''}
        </span>
        <strong>${escapar(p.name)}</strong>
        <span>${escapar(p.color)}${p.color ? ' · ' : ''}${p.oldPrice ? `<s>${plata(p.oldPrice)}</s> ` : ''}${plata(p.price)}</span>
      </button>`).join('') ||
      `<p class="vacio">${productos.length ? 'No hay productos acá.' : 'Todavía no hay productos. Tocá “＋ Agregar” para cargar el primero.'}</p>`;
  }

  $('grilla').addEventListener('click', (e) => {
    const t = e.target.closest('[data-ficha]');
    if (t) abrirFicha(Number(t.dataset.ficha));
  });

  $('nuevoProducto').addEventListener('click', () => abrirAsistente({ modo: 'nuevo' }));

  // ---------- ficha de un producto ----------
  const nombreCat = (id) => (categorias.find((c) => c.id === id) || {}).name || '';
  let enFicha = null;

  function abrirFicha(id) {
    enFicha = productos.find((p) => p.id === id);
    if (!enFicha) return;
    pintarFicha();
    if (!$('dlgFicha').open) $('dlgFicha').showModal();
  }

  function pintarFicha() {
    const p = enFicha;
    const edita = puede.hacer('products_edit');
    const deSuCat = productos.filter((x) => x.categoryId === p.categoryId);
    const i = deSuCat.findIndex((x) => x.id === p.id);
    $('fichaTitulo').textContent = p.name;
    $('fichaCuerpo').innerHTML = `
      <div class="carrusel" data-carrusel>
        ${[p.photo, ...(p.gallery || [])].filter(Boolean).map((src) => `<img class="ficha__foto" src="${src}" alt="">`).join('')}
      </div>
      ${(p.gallery || []).length ? `<div class="puntos">${[p.photo, ...p.gallery].map((_, i) => `<span${i ? '' : ' class="on"'}></span>`).join('')}</div>` : ''}
      <p class="ficha__fotos">📷 ${1 + (p.gallery || []).length} de ${MAX_FOTOS} fotos${(p.gallery || []).length < MAX_FOTOS - 1 && edita ? ' · sumá más con ✏️ Editar' : ''}</p>
      <p class="ficha__datos">${escapar(p.color)}${p.color ? ' · ' : ''}${p.oldPrice ? `<s>${plata(p.oldPrice)}</s> ` : ''}<strong>${plata(p.price)}</strong>${p.oldPrice ? ` <em class="oferta-chip">Oferta -${descuento(p.price, p.oldPrice)}%</em>` : ''}</p>
      <p class="ficha__cat">${escapar(nombreCat(p.categoryId))}</p>
      ${p.description ? `<p class="ficha__desc">${escapar(p.description)}</p>` : (edita ? '<p class="ficha__sin-desc">Sin descripción. Tocá ✏️ Editar para agregar medidas, material o detalles.</p>' : '')}
      ${edita ? `
        <label class="switch"><input type="checkbox" data-sw="soldOut" ${p.soldOut ? 'checked' : ''}><span></span> Sin stock <small>se ve, pero no se puede pedir</small></label>
        <label class="switch"><input type="checkbox" data-sw="hidden" ${p.hidden ? 'checked' : ''}><span></span> Oculto <small>no aparece en la web</small></label>
        <div class="ficha__botones">
          <button type="button" class="btn btn--bordo" data-accion="editar">✏️ Editar</button>
          <button type="button" class="btn btn--borde" data-accion="variante">🎨 Otro color</button>
        </div>
        ${p.hidden ? '' : '<button type="button" class="btn btn--borde btn--ancho" data-accion="link">🔗 Copiar link para compartir</button>'}
        <div class="ficha__orden">
          <span>Lugar en ${escapar(nombreCat(p.categoryId))}: ${i + 1} de ${deSuCat.length}</span>
          <button type="button" class="mini" data-accion="subir" aria-label="Más arriba" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="mini" data-accion="bajar" aria-label="Más abajo" ${i === deSuCat.length - 1 ? 'disabled' : ''}>↓</button>
        </div>` : ''}
      ${puede.hacer('products_delete') ? '<button type="button" class="btn btn--borrar btn--ancho" data-accion="borrar">Borrar producto</button>' : ''}`;
  }

  // Puntitos del carrusel según la foto que se ve.
  $('fichaCuerpo').addEventListener('scroll', (e) => {
    const c = e.target.closest && e.target.closest('[data-carrusel]');
    if (!c) return;
    const i = Math.round(c.scrollLeft / c.clientWidth);
    c.parentElement.querySelectorAll('.puntos span').forEach((p, k) => p.classList.toggle('on', k === i));
  }, true);

  $('fichaCuerpo').addEventListener('change', async (e) => {
    const sw = e.target.closest('[data-sw]');
    if (!sw) return;
    sw.disabled = true;
    try {
      const { product } = await api('PATCH', `/api/products/${enFicha.id}`, { [sw.dataset.sw]: sw.checked });
      Object.assign(enFicha, product);
      pintarTodo();
      avisar(sw.dataset.sw === 'soldOut'
        ? (product.soldOut ? 'Marcado sin stock' : 'Marcado con stock')
        : (product.hidden ? 'Oculto de la web' : 'Visible en la web'));
    } catch (err) {
      sw.checked = !sw.checked;
      avisar(err.message);
    } finally { sw.disabled = false; }
  });

  $('fichaCuerpo').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-accion]');
    if (!b) return;
    const p = enFicha;
    try {
      if (b.dataset.accion === 'link') {
        const { url, enObra } = await api('GET', `/api/products/${p.id}/link`);
        try { await navigator.clipboard.writeText(url); } catch (_) {
          // Si el celular no deja copiar solo, se muestra el link listo para copiar a mano.
          b.outerHTML = `<input class="link-copiar" readonly value="${escapar(url)}" onclick="this.select()">`;
          return avisar('Mantené apretado el link para copiarlo');
        }
        avisar(enObra ? 'Link copiado ✓ (va a funcionar cuando se abra la web)' : 'Link copiado ✓ Pegalo en WhatsApp o Instagram');
      }
      if (b.dataset.accion === 'editar') { $('dlgFicha').close(); abrirAsistente({ modo: 'editar', p }); }
      if (b.dataset.accion === 'variante') { $('dlgFicha').close(); abrirAsistente({ modo: 'variante', p }); }
      if (b.dataset.accion === 'subir' || b.dataset.accion === 'bajar') {
        await api('POST', `/api/products/${p.id}/move`, { dir: b.dataset.accion === 'subir' ? 'up' : 'down' });
        productos = (await api('GET', '/api/products')).products;
        enFicha = productos.find((x) => x.id === p.id);
        pintarTodo();
        pintarFicha();
      }
      if (b.dataset.accion === 'borrar') {
        if (!confirm(`¿Borrar "${p.name}${p.color ? ` ${p.color}` : ''}"? No se puede deshacer.`)) return;
        await api('DELETE', `/api/products/${p.id}`);
        $('dlgFicha').close();
        await cargar();
        avisar('Producto borrado');
      }
    } catch (err) { avisar(err.message); }
  });

  // ---------- asistente: foto → datos → cómo queda ----------
  const dlgA = $('dlgAsistente');
  let as = null; // { modo, id, foto: {photo, thumb} | null, fotoActual, paso, categoryId }

  function abrirAsistente({ modo, p }) {
    if (!categorias.length) { avisar('Primero creá una categoría'); irA('categorias'); return; }
    const base = p || {};
    const filtroCat = categorias.find((c) => String(c.id) === filtro);
    as = {
      modo,
      id: modo === 'editar' ? base.id : null,
      foto: null,
      fotoActual: modo === 'editar' ? base.photo : null,
      extras: modo === 'editar' ? (base.gallery || []).slice() : [],
      categoryId: base.categoryId || (filtroCat ? filtroCat.id : categorias[0].id),
    };
    $('asistTitulo').textContent = modo === 'editar' ? 'Editar producto' : modo === 'variante' ? 'Otro color' : 'Nuevo producto';
    $('aNombre').value = base.name || '';
    $('aColor').value = modo === 'editar' ? base.color : '';
    // Otro color del mismo modelo: la descripción (medidas, material) suele ser la misma.
    $('aDesc').value = base.description || '';
    contarDesc();
    $('aPrecio').value = base.price ? Number(base.price).toLocaleString('es-AR') : '';
    $('aPrecioAntes').value = base.oldPrice ? Number(base.oldPrice).toLocaleString('es-AR') : '';
    $('aOferta').checked = !!base.oldPrice;
    pintarOferta();
    $('aSinStock').checked = modo === 'editar' ? base.soldOut : false;
    $('aOculto').checked = modo === 'editar' ? base.hidden : false;
    $('guardarOtro').hidden = modo === 'editar';
    $('paso1Ayuda').textContent = modo === 'variante'
      ? `Sacale la foto a la ${base.name} del color nuevo. El nombre, el precio y la categoría ya quedan cargados. Después podés sumar hasta 3 fotos más.`
      : '📸 Cada producto lleva hasta 4 fotos. Empezá por la principal (de frente, buena luz y fondo liso); en el paso siguiente sumás las otras.';
    $('nombresUsados').innerHTML = [...new Set(productos.map((x) => x.name))].map((n) => `<option value="${escapar(n)}">`).join('');
    mostrarError($('errorPaso2'), null);
    mostrarError($('errorPaso3'), null);
    verFoto(as.fotoActual);
    reiniciarFondo();
    paso(modo === 'editar' ? 2 : 1);
    if (!dlgA.open) dlgA.showModal();
  }

  function paso(n) {
    as.paso = n;
    [1, 2, 3].forEach((k) => { $(`paso${k}`).hidden = k !== n; });
    $('asistPasos').querySelectorAll('span').forEach((s, k) => s.classList.toggle('hecho', k < n));
    $('asistPasos').hidden = as.modo === 'editar';
    if (n === 2) { pintarChips(); pintarTira(); }
    if (n === 3) pintarVista();
    dlgA.scrollTop = 0;
  }

  $('asistAtras').addEventListener('click', () => {
    const primero = as.modo === 'editar' ? 2 : 1;
    if (as.paso > primero) paso(as.paso - 1);
    else dlgA.close();
  });

  const fotoDe = () => (as.foto ? as.foto.photo : as.fotoActual);

  function verFoto(src) {
    $('fotoVista').hidden = !src;
    if (src) $('fotoVista').src = src;
    $('fotoTexto').hidden = !!src;
    $('paso1Seguir').hidden = !src;
    $('miniFoto').hidden = !src;
    if (src) $('miniFotoImg').src = src;
    if (as) pintarTira();
  }

  // La foto se achica en el celu antes de subirla (más rápido y no llena el servidor).
  async function achicar(file, lado, calidad) {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('No se pudo leer la foto. Probá con otra.'));
      i.src = URL.createObjectURL(file);
    });
    const escala = Math.min(1, lado / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * escala);
    c.height = Math.round(img.naturalHeight * escala);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(img.src);
    return c.toDataURL('image/jpeg', calidad);
  }

  // 📷 abre la cámara directo; 🖼️ abre la galería.
  dlgA.addEventListener('click', (e) => {
    const b = e.target.closest('[data-foto]');
    if (b) $(b.dataset.foto === 'camara' ? 'fotoCamara' : 'fotoInput').click();
  });

  // ✨ Quitar fondo: recorta la cartera y la pone sobre el crema de las demás fotos.
  let fotoAntesDelFondo = null;

  function cargarHerramientaFondo() {
    if (window.CarmesiFondo) return Promise.resolve(window.CarmesiFondo);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/js/quitar-fondo.js?v=1';
      s.onload = () => resolve(window.CarmesiFondo);
      s.onerror = () => reject(new Error('No se pudo cargar la herramienta. Revisá la conexión.'));
      document.head.appendChild(s);
    });
  }

  const cargarImagen = (src) => new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('No se pudo leer la foto.'));
    i.src = src;
  });

  function aCanvas(origen, w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(origen, 0, 0, w, h);
    return c;
  }

  function estadoFondo(texto) {
    $('fondoEstado').hidden = !texto;
    $('fondoEstado').textContent = texto || '';
  }

  $('quitarFondo').addEventListener('click', async () => {
    const src = fotoDe();
    if (!src) return;
    const botones = [$('quitarFondo'), $('paso2Seguir'), $('cambiarFoto')];
    botones.forEach((b) => { b.disabled = true; });
    estadoFondo(window.CarmesiFondo ? '✨ Quitando el fondo…' : '✨ Preparando la herramienta (la primera vez tarda un poquito)…');
    try {
      const herramienta = await cargarHerramientaFondo();
      await herramienta.preparar();
      estadoFondo('✨ Quitando el fondo…');
      const resultado = await herramienta.quitarFondo(await cargarImagen(src));
      fotoAntesDelFondo = { foto: as.foto };
      as.foto = {
        photo: resultado.toDataURL('image/jpeg', 0.85),
        thumb: aCanvas(resultado, 480, 600).toDataURL('image/jpeg', 0.8),
      };
      verFoto(as.foto.photo);
      $('quitarFondo').hidden = true;
      $('deshacerFondo').hidden = false;
      estadoFondo('¡Listo! Si no te gusta cómo quedó, tocá Deshacer.');
    } catch (err) {
      estadoFondo(err.message);
    } finally {
      botones.forEach((b) => { b.disabled = false; });
    }
  });

  $('deshacerFondo').addEventListener('click', () => {
    if (!fotoAntesDelFondo) return;
    as.foto = fotoAntesDelFondo.foto;
    fotoAntesDelFondo = null;
    verFoto(fotoDe());
    $('quitarFondo').hidden = false;
    $('deshacerFondo').hidden = true;
    estadoFondo('');
  });

  function reiniciarFondo() {
    fotoAntesDelFondo = null;
    $('quitarFondo').hidden = false;
    $('deshacerFondo').hidden = true;
    estadoFondo('');
  }

  async function fotoElegida(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const desdePaso1 = as.paso === 1;
    try {
      $('fotoTexto').hidden = false;
      $('fotoTexto').textContent = 'Preparando foto…';
      as.foto = { photo: await achicar(file, 1280, 0.82), thumb: await achicar(file, 600, 0.8) };
      reiniciarFondo();
      verFoto(as.foto.photo);
      // Con la foto lista pasa solo al paso siguiente.
      if (desdePaso1) paso(2);
    } catch (err) {
      avisar(err.message);
      verFoto(fotoDe());
    } finally {
      $('fotoTexto').innerHTML = '<span class="foto-grande__icono" aria-hidden="true">📷</span>Tocá para sacar la foto';
      $('fotoTexto').hidden = !!fotoDe();
    }
  }
  $('fotoCamara').addEventListener('change', fotoElegida);
  $('fotoInput').addEventListener('change', fotoElegida);

  $('paso1Seguir').addEventListener('click', () => paso(2));

  // Colores ya usados (los más comunes primero) para elegir con un toque.
  function pintarChips() {
    const cuenta = {};
    productos.forEach((p) => { if (p.color) cuenta[p.color] = (cuenta[p.color] || 0) + 1; });
    const colores = Object.keys(cuenta).sort((a, b) => cuenta[b] - cuenta[a]).slice(0, 10);
    const actual = $('aColor').value.trim().toLowerCase();
    $('chipsColor').innerHTML = colores.map((c) =>
      `<button type="button" class="chip" data-color="${escapar(c)}" aria-pressed="${c.toLowerCase() === actual}">${escapar(c)}</button>`).join('');
    $('chipsCat').innerHTML = categorias.map((c) =>
      `<button type="button" class="chip" data-cat="${c.id}" aria-pressed="${c.id === as.categoryId}">${escapar(c.name)}</button>`).join('') +
      (puede.hacer('categories') ? '<button type="button" class="chip chip--nueva" data-cat-nueva>＋ Nueva</button>' : '');
  }

  $('chipsColor').addEventListener('click', (e) => {
    const b = e.target.closest('[data-color]');
    if (!b) return;
    $('aColor').value = b.dataset.color;
    pintarChips();
  });
  $('aColor').addEventListener('input', () => {
    const v = $('aColor').value.trim().toLowerCase();
    $('chipsColor').querySelectorAll('[data-color]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.color.toLowerCase() === v)));
  });

  $('chipsCat').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.cat) { as.categoryId = Number(b.dataset.cat); pintarChips(); return; }
    if (b.hasAttribute('data-cat-nueva')) {
      const nombre = prompt('Nombre de la categoría nueva');
      if (!nombre || !nombre.trim()) return;
      try {
        const { category } = await api('POST', '/api/categories', { name: nombre });
        categorias = (await api('GET', '/api/categories')).categories;
        as.categoryId = category.id;
        pintarChips();
        pintarFiltros();
        pintarCategorias();
        avisar('Categoría creada ✓');
      } catch (err) { avisar(err.message); }
    }
  });

  function contarDesc() {
    $('aDescN').textContent = `${$('aDesc').value.length} / 1000`;
  }
  $('aDesc').addEventListener('input', contarDesc);

  // El precio se ve con puntos mientras se escribe: 22000 → 22.000
  $('aPrecio').addEventListener('input', () => {
    const n = $('aPrecio').value.replace(/\D/g, '').slice(0, 9);
    $('aPrecio').value = n ? Number(n).toLocaleString('es-AR') : '';
  });

  // Oferta: el precio anterior se ve tachado al lado del nuevo.
  $('aPrecioAntes').addEventListener('input', () => {
    const n = $('aPrecioAntes').value.replace(/\D/g, '').slice(0, 9);
    $('aPrecioAntes').value = n ? Number(n).toLocaleString('es-AR') : '';
    pintarOferta();
  });
  $('aPrecio').addEventListener('input', () => pintarOferta());
  $('aOferta').addEventListener('change', () => {
    pintarOferta();
    if ($('aOferta').checked) $('aPrecioAntes').focus();
  });
  function pintarOferta() {
    const on = $('aOferta').checked;
    $('ofertaCampo').hidden = !on;
    const precio = Number($('aPrecio').value.replace(/\D/g, ''));
    const antes = Number($('aPrecioAntes').value.replace(/\D/g, ''));
    $('ofertaAyuda').textContent = !on || !antes || !precio ? 'Ej: antes $28.000 y ahora $22.000. En la web se ve el de antes tachado.'
      : antes <= precio ? '⚠️ Tiene que ser más alto que el precio de ahora'
      : `En la web se va a ver: ${plata(antes)} tachado → ${plata(precio)} (-${descuento(precio, antes)}%)`;
  }

  function datosAsistente() {
    return {
      name: $('aNombre').value.replace(/\s+/g, ' ').trim(),
      color: $('aColor').value.replace(/\s+/g, ' ').trim(),
      description: $('aDesc').value.trim(),
      categoryId: as.categoryId,
      price: $('aPrecio').value.replace(/\D/g, ''),
      oldPrice: $('aOferta').checked ? $('aPrecioAntes').value.replace(/\D/g, '') : '',
      soldOut: $('aSinStock').checked,
      hidden: $('aOculto').checked,
      gallery: as.extras.slice(),
    };
  }

  // ---------- fotos extra: hasta 4 por producto (la principal + 3) ----------
  const MAX_FOTOS = 4;
  const totalFotos = () => (fotoDe() ? 1 : 0) + as.extras.length;

  function pintarTira() {
    const n = totalFotos();
    $('fotosN').textContent = `${n} de ${MAX_FOTOS}`;
    const principal = fotoDe() ? `<div class="tira__foto tira__foto--principal"><img src="${fotoDe()}" alt=""><span>Principal</span></div>` : '';
    const extras = as.extras.map((src, i) => `
      <div class="tira__foto">
        <img src="${src}" alt="">
        <button type="button" class="tira__quitar" data-quitar-extra="${i}" aria-label="Sacar esta foto">✕</button>
      </div>`).join('');
    const sumar = n < MAX_FOTOS ? `
      <div class="tira__sumar">
        <span>＋ Foto ${n + 1}</span>
        <button type="button" class="mini" data-extra="camara">📷</button>
        <button type="button" class="mini" data-extra="galeria">🖼️</button>
      </div>` : '';
    $('tiraFotos').innerHTML = principal + extras + sumar;
  }

  $('tiraFotos').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.extra) return $(b.dataset.extra === 'camara' ? 'extraCamara' : 'extraGaleria').click();
    if (b.dataset.quitarExtra !== undefined) {
      as.extras.splice(Number(b.dataset.quitarExtra), 1);
      pintarTira();
    }
  });

  async function extraElegida(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file || totalFotos() >= MAX_FOTOS) return;
    try {
      as.extras.push(await achicar(file, 1280, 0.82));
      pintarTira();
      if (totalFotos() === MAX_FOTOS) avisar('¡Listo, 4 de 4 fotos! 📸');
    } catch (err) { avisar(err.message); }
  }
  $('extraCamara').addEventListener('change', extraElegida);
  $('extraGaleria').addEventListener('change', extraElegida);

  $('irAFotos').addEventListener('click', () => {
    paso(2);
    setTimeout(() => $('tiraFotos').scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
  });

  $('paso2Seguir').addEventListener('click', () => {
    const d = datosAsistente();
    const falta = !fotoDe() ? 'Falta la foto' : !d.name ? 'Poné el nombre' : !d.price ? 'Poné el precio'
      : $('aOferta').checked && !d.oldPrice ? 'Poné el precio anterior (o destildá "Está en oferta")'
      : d.oldPrice && Number(d.oldPrice) <= Number(d.price) ? 'El precio anterior tiene que ser más alto que el de ahora' : null;
    mostrarError($('errorPaso2'), falta);
    if (!falta) paso(3);
  });

  function pintarVista() {
    const d = datosAsistente();
    $('vistaPrevia').innerHTML = `
      <div class="vista__foto"><img src="${fotoDe()}" alt="">${d.soldOut ? '<em class="marca marca--stock">Sin stock</em>' : ''}${totalFotos() > 1 ? `<em class="marca marca--fotos">📷 ${totalFotos()}</em>` : ''}</div>
      <p class="vista__nombre">${escapar(d.name)}</p>
      <p class="vista__color">${escapar(d.color)}</p>
      <p class="vista__precio">${d.oldPrice ? `<s>${plata(d.oldPrice)}</s> ` : ''}${plata(d.price)}${d.oldPrice ? ` <em class="oferta-chip">-${descuento(d.price, d.oldPrice)}%</em>` : ''}</p>
      ${d.description ? `<p class="vista__desc"><span>Al tocarla, ven también:</span>${escapar(d.description)}</p>` : ''}
      <span class="vista__boton">${d.soldOut ? 'Sin stock' : 'Agregar al pedido'}</span>
      ${d.hidden ? '<p class="ayuda">Está marcado como oculto: no se va a ver en la web hasta que lo muestres.</p>' : ''}`;
    const n = totalFotos();
    $('recordarFotos').hidden = n >= MAX_FOTOS;
    $('recordarN').textContent = `${n} de ${MAX_FOTOS}`;
  }

  async function guardar(otroColor) {
    const botones = [$('guardar'), $('guardarOtro')];
    botones.forEach((b) => { b.disabled = true; });
    $('guardar').textContent = 'Guardando…';
    try {
      const datos = { ...datosAsistente(), ...(as.foto || {}) };
      const { product } = as.modo === 'editar'
        ? await api('PUT', `/api/products/${as.id}`, datos)
        : await api('POST', '/api/products', datos);
      await cargar();
      const fotos = 1 + (product.gallery || []).length;
      avisar(as.modo === 'editar' ? 'Cambios guardados ✓'
        : fotos < MAX_FOTOS ? `Producto agregado ✓ (${fotos} de ${MAX_FOTOS} fotos: podés sumar más desde Editar)` : 'Producto agregado ✓ con 4 fotos');
      if (otroColor) abrirAsistente({ modo: 'variante', p: product });
      else dlgA.close();
    } catch (err) {
      mostrarError($('errorPaso3'), err);
    } finally {
      botones.forEach((b) => { b.disabled = false; });
      $('guardar').textContent = 'Guardar';
    }
  }

  $('guardar').addEventListener('click', () => guardar(false));
  $('guardarOtro').addEventListener('click', () => guardar(true));

  // ---------- categorías ----------
  function pintarCategorias() {
    const editable = puede.hacer('categories');
    $('listaCats').innerHTML = categorias.map((c, i) => {
      const foto = (productos.find((p) => p.categoryId === c.id) || {}).thumb;
      return `
      <li class="cat">
        <button type="button" class="cat__ver" data-ver-cat="${c.id}">
          <span class="cat__foto">${foto ? `<img src="${foto}" alt="" loading="lazy">` : '🗂️'}</span>
          <span class="cat__nombre">${escapar(c.name)}<small>${c.count} ${c.count === 1 ? 'producto' : 'productos'}</small></span>
        </button>
        ${editable ? `<span class="cat__acciones">
          <button type="button" class="mini" data-subir="${c.id}" aria-label="Subir" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="mini" data-bajar="${c.id}" aria-label="Bajar" ${i === categorias.length - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" class="mini" data-renombrar="${c.id}">Renombrar</button>
          ${c.count ? '' : `<button type="button" class="mini mini--borrar" data-borrar="${c.id}">Borrar</button>`}
        </span>` : ''}
      </li>`;
    }).join('') || '<li class="vacio">Todavía no hay categorías. Creá la primera arriba.</li>';
  }

  $('nuevaCat').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('POST', '/api/categories', { name: e.target.name.value });
      e.target.reset();
      await cargar();
      avisar('Categoría agregada ✓');
    } catch (err) { avisar(err.message); }
  });

  $('listaCats').addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.verCat) {
      filtro = t.dataset.verCat;
      pintarFiltros();
      pintarGrilla();
      irA('productos');
      return;
    }
    try {
      const mover = t.dataset.subir || t.dataset.bajar;
      if (mover) await api('POST', `/api/categories/${mover}/move`, { dir: t.dataset.subir ? 'up' : 'down' });
      if (t.dataset.renombrar) {
        const c = categorias.find((x) => x.id === Number(t.dataset.renombrar));
        const nombre = prompt('Nuevo nombre de la categoría', c.name);
        if (!nombre || nombre.trim() === c.name) return;
        await api('PUT', `/api/categories/${c.id}`, { name: nombre });
        avisar('Nombre cambiado ✓');
      }
      if (t.dataset.borrar) {
        const c = categorias.find((x) => x.id === Number(t.dataset.borrar));
        if (!confirm(`¿Borrar la categoría "${c.name}"?`)) return;
        await api('DELETE', `/api/categories/${c.id}`);
        avisar('Categoría borrada');
      }
      await cargar();
    } catch (err) { avisar(err.message); }
  });

  // ---------- más ----------
  $('salir').addEventListener('click', async () => {
    await api('POST', '/api/logout').catch(() => {});
    history.replaceState(null, '', '#inicio');
    mostrarLogin();
  });

  $('menuNegocio').addEventListener('click', async () => {
    try {
      const s = await api('GET', '/api/settings');
      $('formNegocio').whatsapp.value = s.whatsapp;
      $('formNegocio').instagram.value = s.instagram;
      mostrarError($('errorNegocio'), null);
      $('dlgNegocio').showModal();
    } catch (err) { avisar(err.message); }
  });

  $('formNegocio').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('PUT', '/api/settings', { whatsapp: e.target.whatsapp.value, instagram: e.target.instagram.value });
      $('dlgNegocio').close();
      avisar('Datos guardados ✓');
    } catch (err) { mostrarError($('errorNegocio'), err); }
  });

  $('menuClave').addEventListener('click', () => {
    $('formClave').reset();
    mostrarError($('errorClave'), null);
    $('dlgClave').showModal();
  });

  $('formClave').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('PUT', '/api/me/password', { current: e.target.current.value, password: e.target.password.value });
      $('dlgClave').close();
      avisar('Contraseña cambiada ✓');
    } catch (err) { mostrarError($('errorClave'), err); }
  });

  // ---------- usuarios ----------
  // Solo Pixel Cuyo recibe las contraseñas: cuadros para copiar usuario y contraseña.
  function credenciales(u) {
    const clave = u.password
      ? `<span class="copiable">
           <input type="password" readonly value="${escapar(u.password)}" aria-label="Contraseña de ${escapar(u.username)}">
           <button type="button" class="mini" data-ver-clave aria-label="Mostrar contraseña">👁</button>
           <button type="button" class="mini" data-copiar>Copiar</button>
         </span>`
      : `<span class="ayuda">${u.id === yo.id ? 'Se guarda la próxima vez que entres.' : 'Todavía no está guardada: tocá “Nueva contraseña” para ponerle una.'}</span>`;
    return `
      <div class="cred">
        <label>Usuario
          <span class="copiable">
            <input readonly value="${escapar(u.username)}" aria-label="Usuario">
            <button type="button" class="mini" data-copiar>Copiar</button>
          </span>
        </label>
        <label>Contraseña ${clave}</label>
        ${u.password ? `<button type="button" class="mini mini--todo" data-copiar-todo="${escapar(u.username)}" data-clave="${escapar(u.password)}">📋 Copiar todo para enviar</button>` : ''}
      </div>`;
  }

  async function copiar(texto) {
    try { await navigator.clipboard.writeText(texto); }
    catch (_) {
      // Navegadores viejos: copia con un campo temporal.
      const t = document.createElement('textarea');
      t.value = texto;
      document.body.appendChild(t);
      t.select();
      document.execCommand('copy');
      t.remove();
    }
    avisar('Copiado ✓');
  }

  async function pintarUsuarios() {
    const { users } = await api('GET', '/api/users');
    $('listaUsuarios').innerHTML = users.map((u) => `
      <li class="usuario">
        <span class="usuario__nombre">${escapar(u.alias || u.username)}
          <small>${escapar(u.username)} · ${ROL_NOMBRE[u.role] || u.role}${u.id === yo.id ? ' · vos' : ''}</small>
        </span>
        ${'password' in u ? credenciales(u) : ''}
        ${u.editable ? `
          <button type="button" class="mini" data-blanquear="${u.id}" data-nombre="${escapar(u.username)}">Nueva contraseña</button>
          ${u.role !== 'super' ? `<button type="button" class="mini mini--borrar" data-borrar-usuario="${u.id}" data-nombre="${escapar(u.username)}">Borrar</button>` : ''}` : ''}
      </li>`).join('');
  }

  // WhatsApp de Pixel Cuyo para pedir perfiles extra.
  const WA_PIXEL_CUYO = '5492617206192';
  const NOMBRE_ROL = { admin: 'subadministrador', vendedor: 'vendedor' };

  async function pintarCupos() {
    const { quotas } = await api('GET', '/api/quotas');
    const fila = (rol, titulo) => {
      const q = quotas[rol];
      const libres = Math.max(0, q.limite - q.usados);
      return `<li>
        <strong>${titulo}: ${q.usados} de ${q.limite}</strong>
        <span>${libres ? `Te quedan ${libres} sin costo.` : 'No te quedan lugares libres.'}
          Cada ${NOMBRE_ROL[rol]} más: <b>${plata(q.precio)}</b> (pago único).</span>
      </li>`;
    };
    $('cupos').innerHTML = (puede.hacer('admins') ? fila('admin', 'Administradores (contándote a vos)') : '') +
      (puede.hacer('users') ? fila('vendedor', 'Vendedores') : '');
    $('cupos').hidden = puede.super();
  }

  $('menuUsuarios').addEventListener('click', async () => {
    $('formUsuario').reset();
    mostrarError($('errorUsuarios'), null);
    $('pedirCupo').hidden = true;
    $('selRol').innerHTML = (puede.hacer('admins') ? '<option value="admin">Subadministrador/a</option>' : '') +
      (puede.hacer('users') ? '<option value="vendedor" selected>Vendedor/a</option>' : '');
    $('ayudaRoles').textContent = puede.super()
      ? 'Lo que puede hacer cada nivel y los cupos los elegís en Más → Niveles y permisos.'
      : 'Subadministrador/a: maneja la tienda como vos. Vendedor/a: carga productos y stock.';
    try {
      await Promise.all([pintarUsuarios(), pintarCupos()]);
      $('dlgUsuarios').showModal();
    } catch (err) { avisar(err.message); }
  });

  $('formUsuario').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api('POST', '/api/users', { username: f.username.value, alias: f.alias.value, password: f.password.value, role: f.role.value });
      f.reset();
      mostrarError($('errorUsuarios'), null);
      $('pedirCupo').hidden = true;
      await Promise.all([pintarUsuarios(), pintarCupos()]);
      avisar('Usuario creado ✓');
    } catch (err) {
      mostrarError($('errorUsuarios'), err);
      // Sin lugar libre: botón para pedirle el perfil extra a Pixel Cuyo por WhatsApp.
      const cupo = err.data && err.data.cupo;
      $('pedirCupo').hidden = !cupo;
      if (cupo) {
        const texto = `¡Hola Pixel Cuyo! Soy ${yo.alias || yo.username} de Carmesí. Quiero sumar 1 perfil más de ${NOMBRE_ROL[cupo.role]} en el panel (${plata(cupo.precio)}, pago único).`;
        $('pedirCupo').href = `https://wa.me/${WA_PIXEL_CUYO}?text=${encodeURIComponent(texto)}`;
      }
    }
  });

  $('listaUsuarios').addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.hasAttribute('data-copiar')) return copiar(t.closest('.copiable').querySelector('input').value);
    if (t.hasAttribute('data-ver-clave')) {
      const input = t.closest('.copiable').querySelector('input');
      input.type = input.type === 'password' ? 'text' : 'password';
      t.textContent = input.type === 'password' ? '👁' : '🙈';
      return;
    }
    if (t.dataset.copiarTodo) {
      return copiar(`Panel de Carmesí: ${location.origin}/panel\nUsuario: ${t.dataset.copiarTodo}\nContraseña: ${t.dataset.clave}`);
    }
    try {
      if (t.dataset.blanquear) {
        const clave = prompt(`Contraseña nueva para ${t.dataset.nombre} (mínimo 6 caracteres)`);
        if (!clave) return;
        await api('PUT', `/api/users/${t.dataset.blanquear}/password`, { password: clave });
        avisar('Contraseña cambiada ✓');
      }
      if (t.dataset.borrarUsuario) {
        if (!confirm(`¿Borrar el usuario ${t.dataset.nombre}? Ya no va a poder entrar.`)) return;
        await api('DELETE', `/api/users/${t.dataset.borrarUsuario}`);
        await pintarUsuarios();
        avisar('Usuario borrado');
      }
    } catch (err) { avisar(err.message); }
  });

  // ---------- historial ----------
  const ACCION = { create: 'creó', update: 'cambió', delete: 'borró', export: 'descargó' };
  const TIPO = { product: 'el producto', category: 'la categoría', user: 'el usuario', site: '' };

  // Almanaque: un mes a la vista, los días con cambios marcados; se guardan 6 meses.
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const hoy0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  let alm = null; // { mes: Date (día 1), dia: Date, dias: Set de 'aaaa-m-d', retencion }
  const claveDia = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

  async function pintarAlmanaque() {
    const desde = new Date(alm.mes);
    const hasta = new Date(alm.mes.getFullYear(), alm.mes.getMonth() + 1, 1);
    const { stamps, days } = await api('GET', `/api/activity/stamps?from=${desde.getTime()}&to=${hasta.getTime()}`);
    alm.retencion = days;
    alm.dias = new Set(stamps.map((t) => claveDia(new Date(t))));
    const limite = new Date(hoy0().getTime() - days * 864e5);
    $('almMes').textContent = `${MESES[alm.mes.getMonth()]} ${alm.mes.getFullYear()}`;
    $('almAntes').disabled = desde <= limite;
    $('almDespues').disabled = hasta > hoy0();
    const vacios = (desde.getDay() + 6) % 7; // la semana arranca el lunes
    const total = new Date(alm.mes.getFullYear(), alm.mes.getMonth() + 1, 0).getDate();
    let html = '<span class="alm__sem">L</span><span class="alm__sem">M</span><span class="alm__sem">M</span><span class="alm__sem">J</span><span class="alm__sem">V</span><span class="alm__sem">S</span><span class="alm__sem">D</span>';
    html += '<span></span>'.repeat(vacios);
    for (let n = 1; n <= total; n++) {
      const d = new Date(alm.mes.getFullYear(), alm.mes.getMonth(), n);
      const futuro = d > hoy0();
      html += `<button type="button" class="alm__dia${alm.dias.has(claveDia(d)) ? ' alm__dia--con' : ''}${claveDia(d) === claveDia(hoy0()) ? ' alm__dia--hoy' : ''}"
        data-dia="${d.getTime()}" aria-pressed="${claveDia(d) === claveDia(alm.dia)}" ${futuro || d < limite ? 'disabled' : ''}>${n}</button>`;
    }
    $('almGrilla').innerHTML = html;
  }

  async function pintarDia() {
    const desde = alm.dia.getTime();
    const hasta = new Date(alm.dia.getFullYear(), alm.dia.getMonth(), alm.dia.getDate() + 1).getTime();
    const { items } = await api('GET', `/api/activity?from=${desde}&to=${hasta}&limit=500`);
    $('almTitulo').textContent = alm.dia.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
    $('listaHistorial').innerHTML = items.map((a) => `
      <li>
        <p><strong>${escapar(a.who)}</strong> ${ACCION[a.action] || a.action} ${TIPO[a.kind] ?? ''} <strong>${escapar(a.name)}</strong></p>
        ${a.changes.length ? `<ul>${a.changes.map((c) => `<li>${escapar(c)}</li>`).join('')}</ul>` : ''}
        <time>${new Date(a.at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</time>
      </li>`).join('') || '<li class="vacio">Ese día no hubo cambios.</li>';
  }

  $('menuHistorial').addEventListener('click', async () => {
    const hoy = hoy0();
    alm = { mes: new Date(hoy.getFullYear(), hoy.getMonth(), 1), dia: hoy, dias: new Set() };
    try {
      await Promise.all([pintarAlmanaque(), pintarDia()]);
      $('dlgHistorial').showModal();
    } catch (err) { avisar(err.message); }
  });

  $('excelMes').addEventListener('click', () => {
    bajarExcel(alm.mes.getTime(), new Date(alm.mes.getFullYear(), alm.mes.getMonth() + 1, 1).getTime());
  });
  $('excelTodo').addEventListener('click', () => bajarExcel(0, Date.now() + 864e5));

  $('almAntes').addEventListener('click', () => { alm.mes = new Date(alm.mes.getFullYear(), alm.mes.getMonth() - 1, 1); pintarAlmanaque().catch((e) => avisar(e.message)); });
  $('almDespues').addEventListener('click', () => { alm.mes = new Date(alm.mes.getFullYear(), alm.mes.getMonth() + 1, 1); pintarAlmanaque().catch((e) => avisar(e.message)); });
  $('almGrilla').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-dia]');
    if (!b) return;
    alm.dia = new Date(Number(b.dataset.dia));
    $('almGrilla').querySelectorAll('[data-dia]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    try { await pintarDia(); } catch (err) { avisar(err.message); }
  });

  // ---------- niveles y permisos (solo Pixel Cuyo) ----------
  let nivelesRoles = null;

  function pintarNiveles(permissions) {
    $('tablaNiveles').innerHTML = permissions.map((p) => `
      <tr>
        <td>${escapar(p.label)}</td>
        <td aria-label="Pixel Cuyo: sí">✅</td>
        ${['admin', 'vendedor'].map((rol) => `
          <td><input type="checkbox" data-rol="${rol}" data-permiso="${p.key}" ${nivelesRoles[rol][p.key] ? 'checked' : ''}
                     aria-label="${rol === 'admin' ? 'Admin' : 'Vendedor'}: ${escapar(p.label)}"></td>`).join('')}
      </tr>`).join('') + ['Ver las contraseñas', 'Cupos y precios de perfiles', 'Cambiar estos permisos', 'Web en construcción / abrirla'].map((t) => `
      <tr class="niveles__fijo"><td>${t}</td><td>✅</td><td>🔒</td><td>🔒</td></tr>`).join('');
  }

  $('menuNiveles').addEventListener('click', async () => {
    try {
      const { permissions, roles } = await api('GET', '/api/permissions');
      nivelesRoles = roles;
      pintarNiveles(permissions);
      const { quotas } = await api('GET', '/api/quotas');
      for (const rol of ['admin', 'vendedor']) {
        for (const k of ['gratis', 'precio', 'extra']) $('formCupos').elements[`${rol}_${k}`].value = quotas[rol][k];
        $(`usados_${rol}`).textContent = `${quotas[rol].usados} creados · límite ${quotas[rol].limite}`;
      }
      $('dlgNiveles').showModal();
    } catch (err) { avisar(err.message); }
  });

  $('tablaNiveles').addEventListener('change', async (e) => {
    const c = e.target.closest('[data-permiso]');
    if (!c) return;
    c.disabled = true;
    try {
      const { roles } = await api('PUT', '/api/permissions', { [c.dataset.rol]: { [c.dataset.permiso]: c.checked } });
      nivelesRoles = roles;
      avisar('Permiso guardado ✓');
    } catch (err) {
      c.checked = !c.checked;
      avisar(err.message);
    } finally { c.disabled = false; }
  });

  $('formCupos').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const cuerpo = {};
    for (const rol of ['admin', 'vendedor']) {
      cuerpo[rol] = {};
      for (const k of ['gratis', 'precio', 'extra']) cuerpo[rol][k] = Number(String(f[`${rol}_${k}`].value).replace(/\D/g, ''));
    }
    try {
      const { quotas } = await api('PUT', '/api/quotas', cuerpo);
      for (const rol of ['admin', 'vendedor']) $(`usados_${rol}`).textContent = `${quotas[rol].usados} creados · límite ${quotas[rol].limite}`;
      avisar('Cupos guardados ✓');
    } catch (err) { avisar(err.message); }
  });

  // ---------- web en construcción (solo Pixel Cuyo) ----------
  $('menuObra').addEventListener('click', async () => {
    const abrir = enObra;
    if (!confirm(abrir ? '¿Abrir la web? Todos van a ver los productos.' : '¿Poner la web en construcción? Los clientes no van a ver los productos.')) return;
    try {
      const { maintenance } = await api('PUT', '/api/maintenance', { on: !abrir });
      pintarObra(maintenance);
      avisar(maintenance ? 'Web en construcción 🧵' : 'Web abierta al público 🚀');
    } catch (err) { avisar(err.message); }
  });

  // Cerrar diálogos con la X o tocando afuera
  document.querySelectorAll('dialog').forEach((d) => {
    d.addEventListener('click', (e) => {
      if (e.target === d || e.target.closest('[data-cerrar]')) d.close();
    });
  });

  // ---------- arranque ----------
  api('GET', '/api/me').then((me) => entrar(me.user, me)).catch(() => mostrarLogin());
})();
