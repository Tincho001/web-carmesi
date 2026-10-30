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

  // Login: ver la contraseña mientras se escribe, y ayuda si se la olvidó.
  $('verClave').addEventListener('click', () => {
    const input = $('loginForm').password;
    const ver = input.type === 'password';
    input.type = ver ? 'text' : 'password';
    $('verClave').textContent = ver ? '🙈' : '👁';
    $('verClave').setAttribute('aria-label', ver ? 'Ocultar la contraseña' : 'Mostrar la contraseña');
  });
  $('loginAyuda').href = `https://wa.me/5492617206192?text=${encodeURIComponent('¡Hola Martín! No puedo entrar al panel de Carmesí, ¿me ayudás con la contraseña?')}`;

  const ROL_NOMBRE = { super: 'Pixel Cuyo (control total)', admin: 'Administradora', vendedor: 'Vendedor/a' };
  // Lo que puede hacer quien entró: lo manda el servidor según los permisos de su nivel.
  let permisos = {};
  const puede = {
    super: () => yo.role === 'super',
    admin: () => yo.role === 'admin',
    hacer: (clave) => yo.role === 'super' || !!permisos[clave],
  };
  let enObra = false;

  async function entrar(user, me) {
    yo = user;
    if (!me) me = await api('GET', '/api/me');
    permisos = me.perms || {};
    pasosHechos = me.pasos || [];
    $('login').hidden = true;
    $('app').hidden = false;
    const nombre = user.alias || user.username;
    $('saludo').textContent = `Hola, ${nombre} 👋`;
    $('quien').innerHTML = `<strong>${escapar(nombre)}</strong><span>${escapar(user.username)} · ${ROL_NOMBRE[user.role] || user.role}</span>`;
    document.querySelectorAll('[data-solo]').forEach((el) => { el.hidden = !puede[el.dataset.solo](); });
    document.querySelectorAll('[data-perm]').forEach((el) => { el.hidden = !el.dataset.perm.split('|').some(puede.hacer); });
    $('nuevaCat').hidden = !puede.hacer('categories');
    pintarObra(me.maintenance);
    // Pixel Cuyo viendo como otra persona: franja arriba para volver.
    $('comoBanda').hidden = !me.como;
    document.body.classList.toggle('viendo-como', !!me.como);
    if (me.como) $('comoNombre').textContent = `${me.como.alias} (${ROL_NOMBRE[me.como.role] || me.como.role})`;
    $('salir').innerHTML = me.como ? '<span aria-hidden="true">↩️</span> Volver a mi panel' : '<span aria-hidden="true">🚪</span> Salir';
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
    pintarArranque();
    revisarNovedades();
    pintarCambiosMenu();
    irA(location.hash.slice(1) || 'inicio');
  }

  function pintarObra(obra) {
    enObra = obra;
    // "Publicar web" arriba de todo en Más: solo para las administradoras, mientras está en construcción.
    $('menuPublicar').hidden = !(obra && yo && yo.role === 'admin');
    $('cartelObra').hidden = !obra;
    $('menuObra').innerHTML = obra
      ? '<span aria-hidden="true">🚀</span> Abrir la web al público'
      : '<span aria-hidden="true">🧵</span> Poner la web en construcción';
  }

  async function cargar() {
    const [c, p, a] = await Promise.all([
      api('GET', '/api/categories'),
      api('GET', '/api/products'),
      puede.hacer('products_edit') ? api('GET', '/api/avisame') : { avisos: [] },
    ]);
    categorias = c.categories;
    productos = p.products;
    esperando = a.avisos;
    pintarTodo();
  }

  // ---------- 🔔 clientes que esperan que vuelva un producto ----------
  let esperando = [];
  const pendientesDe = (id) => esperando.filter((a) => a.productId === id && !a.notifiedAt);
  const telLindo = (t) => t.replace(/^549(\d{3})(\d{3})(\d+)$/, '$1 $2 $3');
  function mensajeVolvio(a, p) {
    const hola = a.nombre ? `¡Hola ${a.nombre}!` : '¡Hola!';
    return `https://wa.me/${a.telefono}?text=${encodeURIComponent(`${hola} Te escribo de Carmesí Bags 😊 Volvió a entrar la ${p.name}${p.color ? ' ' + p.color : ''} que querías. ¿Te la reservo?\n${a.url}`)}`;
  }
  function esperandoHtml(p) {
    const lista = esperando.filter((a) => a.productId === p.id);
    if (!lista.length) return '';
    const pend = lista.filter((a) => !a.notifiedAt);
    return `
      <div class="esperan">
        <strong>🔔 ${pend.length ? `${pend.length} ${pend.length === 1 ? 'persona espera' : 'personas esperan'} que vuelva` : 'Personas que avisaste'}</strong>
        ${pend.length && p.soldOut ? '<p class="ayuda">Cuando vuelva a entrar, apagá "Sin stock" y avisales desde acá.</p>' : ''}
        <ul>${lista.map((a) => `
          <li class="${a.notifiedAt ? 'esperan--avisada' : ''}">
            <span><b>${escapar(a.nombre || 'Sin nombre')}</b><small>${telLindo(a.telefono)} · ${new Date(a.createdAt).toLocaleDateString('es-AR')}</small></span>
            ${a.notifiedAt
              ? `<em>Avisada ✓</em><button type="button" class="mini mini--borrar" data-alerta-borrar="${a.id}" aria-label="Sacar de la lista">✕</button>`
              : `<a class="mini mini--wa" href="${mensajeVolvio(a, p)}" target="_blank" rel="noopener" data-alerta-avisar="${a.id}">💬 Avisar</a>`}
          </li>`).join('')}
        </ul>
      </div>`;
  }

  function pintarTodo() {
    pintarInicio();
    pintarFiltros();
    pintarGrilla();
    pintarCategorias();
  }

  // ---------- 📊 lo más visto ----------
  async function pintarStats(dias) {
    $('statsDias').querySelectorAll('[data-dias]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.dias === String(dias))));
    $('listaStats').innerHTML = '<li class="vacio">Cargando…</li>';
    try {
      const s = await api('GET', `/api/stats?dias=${dias}`);
      const suma = (k) => s.productos.reduce((t, x) => t + x[k], 0);
      $('statsTotal').innerHTML = `
        <span><b>${suma('vista')}</b>vistas</span><span><b>${suma('agregado')}</b>al pedido</span>
        <span><b>${suma('whatsapp')}</b>consultas</span><span><b>${suma('pedido')}</b>en pedidos</span>`;
      const filas = s.productos.map((x) => ({ x, p: productos.find((p) => p.id === x.productId) })).filter((f) => f.p).slice(0, 20);
      $('listaStats').innerHTML = filas.map(({ x, p }, i) => `
        <li>
          <span class="stats__n">${i + 1}</span>
          <img src="${p.thumb || ''}" alt="">
          <span class="stats__info"><b>${escapar(p.name)}</b><small>${escapar(p.color)}</small>
            <span class="stats__nums">👀 ${x.vista} · 🛒 ${x.agregado} · 💬 ${x.whatsapp} · 📤 ${x.pedido}</span></span>
        </li>`).join('') || '<li class="vacio">Todavía no hay datos. Se empiezan a contar cuando la gente visita la web.</li>';
    } catch (err) { $('listaStats').innerHTML = `<li class="vacio">${escapar(err.message)}</li>`; }
  }
  $('menuStats').addEventListener('click', () => { $('dlgStats').showModal(); pintarStats(30); });
  $('statsDias').addEventListener('click', (e) => { const b = e.target.closest('[data-dias]'); if (b) pintarStats(Number(b.dataset.dias)); });

  // ---------- 📣 anuncio en la web (tarjeta y barrita para los clientes) ----------
  let anuncioFoto = '';   // URL de la que ya está, data: de una nueva, o '' sin foto
  function opcionesDestino() {
    const ops = [['', 'Sin botón / a ningún lado'], ['nuevos', '✨ Los productos nuevos'], ['whatsapp', '💬 Tu WhatsApp'],
      ...categorias.map((c) => [`categoria:${c.id}`, `🗂️ Categoría: ${c.name}`]),
      ...productos.filter((p) => !p.hidden).map((p) => [`producto:${p.id}`, `👜 ${p.name}${p.color ? ' ' + p.color : ''}`])];
    return ops.map(([v, t]) => `<option value="${escapar(v)}">${escapar(t)}</option>`).join('');
  }
  function pintarFotoAnuncio() {
    $('aFotoPrevia').hidden = !anuncioFoto;
    if (anuncioFoto) $('aFotoPrevia').src = anuncioFoto;
    $('aFotoQuitar').hidden = !anuncioFoto;
  }
  $('menuAnuncio').addEventListener('click', async () => {
    try {
      const a = await api('GET', '/api/anuncios');
      const f = $('formAnuncio');
      f.querySelectorAll('select.destinos').forEach((s) => { s.innerHTML = opcionesDestino(); });
      f.tActivo.checked = a.tarjeta.activo;
      f.tTitulo.value = a.tarjeta.titulo;
      f.tTexto.value = a.tarjeta.texto;
      f.tBoton.value = a.tarjeta.boton;
      f.tDestino.value = a.tarjeta.destino;
      f.tDesde.value = a.tarjeta.desde;
      f.tHasta.value = a.tarjeta.hasta;
      f.bActivo.checked = a.barra.activo;
      f.bTexto.value = a.barra.texto;
      f.bDestino.value = a.barra.destino;
      f.bDesde.value = a.barra.desde;
      f.bHasta.value = a.barra.hasta;
      anuncioFoto = a.tarjeta.foto;
      pintarFotoAnuncio();
      mostrarError($('errorAnuncio'), null);
      $('dlgAnuncio').showModal();
    } catch (err) { avisar(err.message); }
  });
  $('aFotoCamara').addEventListener('click', () => $('aFotoCamaraInput').click());
  $('aFotoGaleria').addEventListener('click', () => $('aFotoGaleriaInput').click());
  $('aFotoQuitar').addEventListener('click', () => { anuncioFoto = ''; pintarFotoAnuncio(); });
  async function fotoAnuncioElegida(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try { anuncioFoto = await achicar(file, 900, 0.82); pintarFotoAnuncio(); } catch (err) { avisar(err.message); }
  }
  $('aFotoCamaraInput').addEventListener('change', fotoAnuncioElegida);
  $('aFotoGaleriaInput').addEventListener('change', fotoAnuncioElegida);
  $('formAnuncio').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const boton = f.querySelector('[type="submit"]');
    boton.disabled = true;
    try {
      await api('PUT', '/api/anuncios', {
        tarjeta: { activo: f.tActivo.checked, titulo: f.tTitulo.value, texto: f.tTexto.value, foto: anuncioFoto.startsWith('data:') ? anuncioFoto : anuncioFoto ? 'igual' : '', boton: f.tBoton.value, destino: f.tDestino.value, desde: f.tDesde.value, hasta: f.tHasta.value },
        barra: { activo: f.bActivo.checked, texto: f.bTexto.value, destino: f.bDestino.value, desde: f.bDesde.value, hasta: f.bHasta.value },
      });
      $('dlgAnuncio').close();
      avisar('Anuncio guardado ✓ Miralo con "Ver web"');
    } catch (err) { mostrarError($('errorAnuncio'), err); } finally { boton.disabled = false; }
  });

  // ---------- 📝 textos de la web ----------
  $('menuTextos').addEventListener('click', async () => {
    try {
      const t = await api('GET', '/api/textos');
      const f = $('formTextos');
      f.sobreTitulo.value = t.sobreTitulo;
      f.sobre.value = t.sobre;
      f.cinta.value = t.cinta.join('\n');
      mostrarError($('errorTextos'), null);
      $('dlgTextos').showModal();
    } catch (err) { avisar(err.message); }
  });
  $('formTextos').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api('PUT', '/api/textos', {
        sobreTitulo: f.sobreTitulo.value,
        sobre: f.sobre.value,
        cinta: f.cinta.value.split('\n').map((x) => x.trim()).filter(Boolean),
      });
      avisar('Textos guardados ✓ Ya se ven en la web');
      marcarPaso('textos');
      $('dlgTextos').close();
    } catch (err) { mostrarError($('errorTextos'), err); }
  });
  $('textosFaq').addEventListener('click', () => { $('dlgTextos').close(); $('menuFaq').click(); });

  // ---------- ❓ preguntas frecuentes ----------
  function filaFaq(x = { q: '', a: '' }) {
    const d = document.createElement('div');
    d.className = 'faq__item';
    d.innerHTML = `
      <div class="faq__top"><strong>Pregunta</strong><button type="button" class="mini mini--borrar" data-faq-borrar aria-label="Borrar esta pregunta">✕</button></div>
      <input name="q" maxlength="120" placeholder="Ej: ¿Hacen envíos?" value="${escapar(x.q)}">
      <textarea name="a" rows="3" maxlength="600" placeholder="La respuesta, como se la dirías a quien te pregunta">${escapar(x.a)}</textarea>`;
    return d;
  }
  $('menuFaq').addEventListener('click', async () => {
    try {
      const { preguntas } = await api('GET', '/api/faq');
      $('listaFaq').replaceChildren(...preguntas.map(filaFaq));
      mostrarError($('errorFaq'), null);
      $('dlgFaq').showModal();
    } catch (err) { avisar(err.message); }
  });
  $('faqSumar').addEventListener('click', () => {
    const f = filaFaq();
    $('listaFaq').appendChild(f);
    f.querySelector('input').focus();
  });
  $('listaFaq').addEventListener('click', (e) => {
    const b = e.target.closest('[data-faq-borrar]');
    if (b && confirm('¿Borrar esta pregunta?')) b.closest('.faq__item').remove();
  });
  $('formFaq').addEventListener('submit', async (e) => {
    e.preventDefault();
    const preguntas = [...$('listaFaq').querySelectorAll('.faq__item')].map((d) => ({ q: d.querySelector('[name="q"]').value.trim(), a: d.querySelector('[name="a"]').value.trim() }));
    const incompleta = preguntas.find((x) => !x.q !== !x.a);
    if (incompleta) return mostrarError($('errorFaq'), new Error('Hay una pregunta sin respuesta (o al revés). Completala o borrala.'));
    try {
      await api('PUT', '/api/faq', { preguntas: preguntas.filter((x) => x.q) });
      $('dlgFaq').close();
      avisar('Preguntas guardadas ✓');
      marcarPaso('faq');
    } catch (err) { mostrarError($('errorFaq'), err); }
  });

  // ---------- 🚀 para arrancar: primeros pasos, se tildan solos ----------
  let pasosHechos = [];
  const PASOS = [
    { id: 'guia', icono: '📖', titulo: 'Mirá la guía', texto: 'Todo lo que podés hacer, explicado paso a paso.', boton: 'Abrir guía', hacer: () => abrirGuia() },
    { id: 'clave', icono: '🔑', titulo: 'Poné tu propia contraseña', texto: 'Una que te acuerdes fácil (mínimo 6 letras o números).', boton: 'Cambiar', hacer: () => $('menuClave').click() },
    { id: 'app', icono: '📲', titulo: 'Poné el panel en tu celu', texto: 'Un ícono de Carmesí para entrar con un toque.', boton: 'Ver cómo', hacer: () => abrirApp() },
    { id: 'productos', icono: '👜', titulo: 'Revisá tus productos', texto: 'Mirá que estén bien los nombres, fotos y precios.', boton: 'Ver productos', perm: 'products_edit', hacer: () => { marcarPaso('productos'); irA('productos'); } },
    { id: 'textos', icono: '📝', titulo: 'Revisá el texto de la tienda', texto: 'El "Carmesí Bags" de abajo y la cinta de frases.', boton: 'Revisar', perm: 'settings', hacer: () => $('menuTextos').click() },
    { id: 'faq', icono: '❓', titulo: 'Revisá las preguntas frecuentes', texto: 'Sobre todo envíos y formas de pago.', boton: 'Revisar', perm: 'settings', hacer: () => $('menuFaq').click() },
  ];
  const misPasos = () => PASOS.filter((p) => !p.perm || puede.hacer(p.perm));
  function pintarArranque() {
    const lista = misPasos();
    const hechos = lista.filter((p) => pasosHechos.includes(p.id)).length;
    // A Pixel Cuyo no le hace falta, y cuando está todo hecho desaparece.
    $('arranque').hidden = puede.super() || hechos === lista.length;
    if ($('arranque').hidden) return;
    $('arranque').innerHTML = `
      <div class="arranque__cabeza">
        <strong>🚀 Para arrancar</strong>
        <span>${hechos} de ${lista.length}</span>
      </div>
      <div class="arranque__barra"><span style="width:${Math.round((hechos / lista.length) * 100)}%"></span></div>
      <ul>${lista.map((p) => {
        const ok = pasosHechos.includes(p.id);
        return `
        <li class="${ok ? 'hecho' : ''}">
          <span class="arranque__icono" aria-hidden="true">${ok ? '✅' : p.icono}</span>
          <span class="arranque__txt"><b>${p.titulo}</b><small>${p.texto}</small></span>
          ${ok ? '' : `<button type="button" class="mini" data-paso="${p.id}">${p.boton}</button>`}
        </li>`;
      }).join('')}</ul>`;
  }
  $('arranque').addEventListener('click', (e) => {
    const b = e.target.closest('[data-paso]');
    if (b) PASOS.find((p) => p.id === b.dataset.paso).hacer();
  });
  async function marcarPaso(id) {
    if (!yo || pasosHechos.includes(id)) return;
    try { pasosHechos = (await api('POST', '/api/me/pasos', { paso: id })).pasos; } catch (_) { return; }
    pintarArranque();
    if (misPasos().every((p) => pasosHechos.includes(p.id))) avisar('¡Listo! 🎉 Ya tenés todo para arrancar');
  }

  // ---------- ✏️ cambios en la web: las administradoras piden (3 por mes), Pixel Cuyo lee ----------
  const ESTADO_CAMBIO = { nuevo: '📨 Recibido', visto: '👀 Visto por Martín', hecho: '✅ Hecho' };
  const fechaCorta = (ms) => new Date(ms).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
  let cambiosMios = null;
  async function pintarCambiosMenu() {
    if (puede.super()) {
      try {
        const r = await api('GET', '/api/cambios');
        $('cambiosN').hidden = !r.nuevos;
        $('cambiosN').textContent = r.nuevos;
      } catch (_) { /* nada */ }
      return;
    }
    if (!puede.admin()) return;
    try { cambiosMios = await api('GET', '/api/cambios'); } catch (_) { return; }
    // Usados los 3 del mes, la opción desaparece hasta el mes que viene.
    $('menuCambios').hidden = cambiosMios.quedan === 0;
    $('cambiosQuedan').textContent = `${cambiosMios.quedan} de ${cambiosMios.limite}`;
  }
  function pintarCambiosForm() {
    const c = cambiosMios;
    $('cambiosQuedanTxt').innerHTML = c.quedan === 1 ? 'Este mes te queda <b>1 cambio</b>.' : `Este mes te quedan <b>${c.quedan} cambios</b>.`;
    $('misCambios').innerHTML = c.cambios.length ? `
      <h3 class="subtitulo">Tus pedidos de este mes</h3>
      <ul class="cambios">${c.cambios.map((x) => `
        <li class="cambio cambio--${x.estado}">
          <p>${escapar(x.texto)}</p>
          <small>${fechaCorta(x.fecha)} · <b>${ESTADO_CAMBIO[x.estado] || x.estado}</b></small>
        </li>`).join('')}</ul>` : '';
  }
  $('menuCambios').addEventListener('click', async () => {
    await pintarCambiosMenu();
    if (!cambiosMios) return;
    $('formCambios').reset();
    mostrarError($('errorCambios'), null);
    pintarCambiosForm();
    $('dlgCambios').showModal();
  });
  $('formCambios').addEventListener('submit', async (e) => {
    e.preventDefault();
    const boton = e.target.querySelector('[type="submit"]');
    boton.disabled = true;
    try {
      const { quedan } = await api('POST', '/api/cambios', { texto: e.target.texto.value });
      $('dlgCambios').close();
      avisar(quedan ? `¡Listo! Martín ya recibió tu pedido 💛 (te quedan ${quedan} este mes)` : '¡Listo! Martín ya recibió tu pedido 💛 Ya usaste los 3 de este mes.');
      pintarCambiosMenu();
    } catch (err) { mostrarError($('errorCambios'), err); } finally { boton.disabled = false; }
  });

  let cambiosSugeridos = [];
  // Copiar al portapapeles (si el navegador no deja, se copia a la vieja usanza).
  async function copiarTexto(texto) {
    try { await navigator.clipboard.writeText(texto); return true; } catch (_) {
      const t = document.createElement('textarea');
      t.value = texto;
      t.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(t);
      t.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
      t.remove();
      return ok;
    }
  }
  async function pintarCambiosSugeridos() {
    const { cambios, usados, limite } = await api('GET', '/api/cambios');
    cambiosSugeridos = cambios;
    $('cupoMes').innerHTML = `
      <span>Este mes usó <b>${usados} de ${limite}</b> cambios</span>
      ${usados ? '<button type="button" class="mini" id="resetearCupo">🔄 Resetear cupo del mes</button>' : ''}`;
    $('copiarPendientes').hidden = cambios.filter((x) => x.estado !== 'hecho').length < 2;
    const nombreMes = (m) => new Date(m + '-15T12:00:00').toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
    let mes = '';
    $('listaCambios').innerHTML = cambios.map((x) => {
      const titulo = x.mes !== mes ? `<li class="cambios__mes">${nombreMes(x.mes)}</li>` : '';
      mes = x.mes;
      return `${titulo}
        <li class="cambio cambio--${x.estado}">
          <div class="cambio__top"><b>${escapar(x.quien)}</b><small>${new Date(x.fecha).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></div>
          <p>${escapar(x.texto)}</p>
          <div class="cambio__acciones">
            <span class="cambio__estado">${ESTADO_CAMBIO[x.estado] || x.estado}</span>
            <button type="button" class="mini" data-cambio-copiar="${x.id}">📋 Copiar</button>
            ${x.cuenta ? `<button type="button" class="mini" data-cambio-cupo="${x.id}" data-cuenta="0">↩️ Devolver cupo</button>` : `<span class="cambio__libre">Cupo devuelto</span>`}
            ${x.estado !== 'visto' && x.estado !== 'hecho' ? `<button type="button" class="mini" data-cambio="${x.id}" data-estado="visto">👀 Visto</button>` : ''}
            ${x.estado !== 'hecho' ? `<button type="button" class="mini" data-cambio="${x.id}" data-estado="hecho">✅ Hecho</button>` : `<button type="button" class="mini" data-cambio="${x.id}" data-estado="visto">Deshacer</button>`}
            <button type="button" class="mini mini--borrar" data-cambio-borrar="${x.id}" aria-label="Borrar este pedido">✕</button>
          </div>
        </li>`;
    }).join('') || '<li class="vacio">Todavía no te pidieron cambios. 👌</li>';
  }
  // Todos los que no están hechos, uno debajo del otro y numerados.
  $('copiarPendientes').addEventListener('click', async () => {
    const pend = cambiosSugeridos.filter((x) => x.estado !== 'hecho').slice().reverse();
    const texto = pend.map((x, i) => `${i + 1}. ${x.texto}`).join('\n\n');
    if (!(await copiarTexto(texto))) return avisar('No se pudo copiar');
    avisar(`${pend.length} pedidos copiados ✓`);
  });
  $('cupoMes').addEventListener('click', async (e) => {
    if (!e.target.closest('#resetearCupo')) return;
    if (!confirm('¿Resetear el cupo de este mes? Los pedidos quedan en la lista, pero vuelve a tener los 3 cambios.')) return;
    try {
      await api('POST', '/api/cambios/resetear-mes');
      await pintarCambiosSugeridos();
      avisar('Cupo reseteado ✓ Vuelve a tener 3 cambios este mes');
    } catch (err) { avisar(err.message); }
  });
  $('menuCambiosSugeridos').addEventListener('click', async () => {
    try { await pintarCambiosSugeridos(); $('dlgCambiosSugeridos').showModal(); } catch (err) { avisar(err.message); }
  });
  $('listaCambios').addEventListener('click', async (e) => {
    const copiar = e.target.closest('[data-cambio-copiar]');
    if (copiar) {
      const x = cambiosSugeridos.find((c) => String(c.id) === copiar.dataset.cambioCopiar);
      if (!(await copiarTexto(x.texto))) return avisar('No se pudo copiar. Mantené apretado el texto para copiarlo.');
      copiar.textContent = '✓ Copiado';
      avisar('Pedido copiado ✓');
      setTimeout(() => { copiar.textContent = '📋 Copiar'; }, 1800);
      return;
    }
    const est = e.target.closest('[data-estado]');
    const borrar = e.target.closest('[data-cambio-borrar]');
    const cupo = e.target.closest('[data-cambio-cupo]');
    try {
      if (cupo) await api('PATCH', `/api/cambios/${cupo.dataset.cambioCupo}`, { cuenta: cupo.dataset.cuenta === '1' });
      else if (est) await api('PATCH', `/api/cambios/${est.dataset.cambio}`, { estado: est.dataset.estado });
      else if (borrar) {
        if (!confirm('¿Borrar este pedido? Si era de este mes, se le devuelve el cupo.')) return;
        await api('DELETE', `/api/cambios/${borrar.dataset.cambioBorrar}`);
      } else return;
      await pintarCambiosSugeridos();
      pintarCambiosMenu();
      pintarAvisos();
    } catch (err) { avisar(err.message); }
  });
  // Al abrir uno desde la campanita.
  $('listaAvisos').addEventListener('click', (e) => {
    if (!e.target.closest('[data-aviso-cambios]')) return;
    $('dlgAvisos').close();
    $('menuCambiosSugeridos').click();
  });

  // ---------- 👀 ver como (solo Pixel Cuyo) ----------
  const ICONO_ROL = { admin: '👑', vendedor: '🛍️' };
  $('verComo').addEventListener('click', async () => {
    try {
      const { users } = await api('GET', '/api/users');
      const otros = users.filter((u) => u.role !== 'super');
      $('listaComo').innerHTML = otros.map((u) => `
        <li><button type="button" class="como-opcion" data-como="${u.id}">
          <span aria-hidden="true">${ICONO_ROL[u.role] || '👤'}</span>
          <span><b>${escapar(u.alias || u.username)}</b><small>${escapar(u.username)} · ${ROL_NOMBRE[u.role] || u.role}</small></span>
        </button></li>`).join('') || '<li class="vacio">Todavía no hay otros usuarios.</li>';
      if (!otros.some((u) => u.role === 'vendedor')) $('listaComo').insertAdjacentHTML('beforeend', '<li class="ayuda">Para ver como vendedor, primero creá un usuario vendedor en ⋯ Más → 👥 Usuarios.</li>');
      $('dlgVerComo').showModal();
    } catch (err) { avisar(err.message); }
  });
  $('listaComo').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-como]');
    if (!b) return;
    try {
      await api('POST', '/api/como', { userId: Number(b.dataset.como) });
      location.hash = '#inicio';
      location.reload();
    } catch (err) { avisar(err.message); }
  });
  async function volverDeComo() {
    await api('POST', '/api/como/salir').catch(() => {});
    location.hash = '#inicio';
    location.reload();
  }
  $('comoSalir').addEventListener('click', volverDeComo);

  // ---------- 📲 el panel como app ----------
  let pedidoInstalar = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); pedidoInstalar = e; $('instalarApp').hidden = false; });
  function elegirSistema(s) {
    $('appSistema').querySelectorAll('[data-sistema]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sistema === s)));
    document.querySelectorAll('.app-pasos').forEach((o) => { o.hidden = o.dataset.para !== s; });
  }
  function abrirApp() {
    elegirSistema(/iphone|ipad|ipod/i.test(navigator.userAgent) ? 'iphone' : 'android');
    $('dlgApp').showModal();
  }
  $('menuApp').addEventListener('click', abrirApp);
  $('appSistema').addEventListener('click', (e) => { const b = e.target.closest('[data-sistema]'); if (b) elegirSistema(b.dataset.sistema); });
  $('instalarApp').addEventListener('click', async () => {
    if (!pedidoInstalar) return;
    pedidoInstalar.prompt();
    const r = await pedidoInstalar.userChoice.catch(() => ({}));
    pedidoInstalar = null;
    $('instalarApp').hidden = true;
    if (r.outcome === 'accepted') { $('dlgApp').close(); marcarPaso('app'); avisar('¡Listo! Ya tenés Carmesí en tu celu 💛'); }
  });
  $('appListo').addEventListener('click', () => { $('dlgApp').close(); marcarPaso('app'); });
  // Si ya lo abrió como app, ese paso está hecho.
  if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) setTimeout(() => marcarPaso('app'), 3000);

  // ---------- 🎉 novedades: al entrar aparece lo que todavía no leyó ----------
  let novedades = { items: [], primeraVez: false };
  let enVentana = [];        // las que se están mostrando
  let leerAlCerrar = false;  // "¡Entendido!" = leídas; la ✕ = quedan en la campanita
  // Texto simple: **negrita** y renglones con "- " como lista.
  function textoNovedad(t) {
    const nombre = yo.alias || yo.username;
    let html = '', lista = false;
    for (const linea of t.replace(/\{nombre\}/g, nombre).split('\n')) {
      const l = escapar(linea.trim()).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
      if (l.startsWith('- ')) { if (!lista) { html += '<ul>'; lista = true; } html += `<li>${l.slice(2)}</li>`; continue; }
      if (lista) { html += '</ul>'; lista = false; }
      if (l) html += `<p>${l}</p>`;
    }
    return html + (lista ? '</ul>' : '');
  }
  const fechaNoticia = (ms) => new Date(ms).toLocaleDateString('es-AR', { day: 'numeric', month: 'long' });
  const tarjetaNoticia = (n) => `
      <li class="novedad${n.leido ? '' : ' novedad--nueva'}${n.fijada ? ' novedad--fijada' : ''}">
        ${n.fijada ? '<span class="novedad__pin">📌 Fijada</span>' : ''}
        <span class="novedad__icono" aria-hidden="true">${escapar(n.icono)}</span>
        <div>
          <strong>${escapar(n.titulo.replace(/\{nombre\}/g, yo.alias || yo.username))}</strong>
          <small>${fechaNoticia(n.fecha)}${n.deMartin && !puede.super() ? ' · de Martín' : ''}${n.leido ? '' : ' · <em>Nuevo</em>'}</small>
          ${puede.super() && n.para ? `<span class="novedad__para">👥 ${escapar(n.para)}</span>` : ''}
          ${textoNovedad(n.texto)}
        </div>
      </li>`;
  // modo "nuevas": la ventanita al entrar; "todas": la bandeja completa desde Más.
  function mostrarNovedades(modo, lista) {
    const primeraVez = modo === 'nuevas' && novedades.primeraVez && !vistaPrevia && !puede.super();
    // La primera vez, en orden (la bienvenida arriba); después, lo más nuevo arriba.
    lista = primeraVez ? lista.slice() : lista.slice().reverse();
    // Las fijadas, siempre arriba de todo.
    lista = [...lista.filter((n) => n.fijada), ...lista.filter((n) => !n.fijada)];
    if (!lista.length) return false;
    enVentana = lista;
    leerAlCerrar = modo === 'todas';
    $('novedadesTitulo').textContent = primeraVez ? '👋 ¡Bienvenida/o!' : '📬 Noticias y mejoras';
    $('novedadesSub').textContent = modo === 'nuevas'
      ? (lista.length === 1 ? 'Hay algo nuevo en tu panel:' : `Hay ${lista.length} cosas nuevas en tu panel:`)
      : 'Todo lo que se fue sumando al panel, lo más nuevo arriba.';
    $('novedadesPie').hidden = modo !== 'nuevas';
    $('listaNovedades').innerHTML = lista.map(tarjetaNoticia).join('');
    $('dlgNovedades').showModal();
    return true;
  }
  const sinLeer = () => novedades.items.filter((n) => !n.leido);
  function pintarNovedadesN() {
    const n = sinLeer().length;
    $('novedadesN').hidden = !n;
    $('novedadesN').textContent = n;
    pintarCampanita();
  }
  async function marcarNoticias(lista, accion) {
    const keys = lista.filter((n) => (accion === 'leido' ? !n.leido : !n.popup)).map((n) => n.key);
    if (!keys.length) return;
    try { await api('POST', '/api/novedades/estado', { keys, accion }); } catch (_) { return; }
    lista.forEach((n) => { n[accion] = true; if (accion === 'leido') n.popup = true; });
    pintarNovedadesN();
  }
  async function revisarNovedades() {
    try { novedades = await api('GET', '/api/novedades'); } catch (_) { return revisarCuota(); }
    pintarNovedadesN();
    // A Martín también le salta, así ve lo mismo que el equipo sin entrar "como" otra persona.
    // Cada noticia salta una sola vez; el aviso de la cuota sale después, cuando cierra la ventanita.
    const nuevas = novedades.items.filter((n) => !n.popup && !n.leido);
    if (mostrarNovedades('nuevas', nuevas)) {
      marcarNoticias(nuevas, 'popup');
      $('dlgNovedades').addEventListener('close', revisarCuota, { once: true });
    } else revisarCuota();
  }

  // ---------- 💳 aviso de la cuota (solo administradoras, una vez por día) ----------
  let cuotaDePrueba = false;
  function mostrarCuota(c) {
    const cuando = c.faltan === 0 ? '<b>hoy</b>' : c.faltan === 1 ? '<b>mañana</b>' : `en <b>${c.faltan} días</b>`;
    $('cuotaTitulo').textContent = c.faltan === 0 ? '¡Hoy vence la cuota de la web!' : 'Se acerca el pago de la web';
    $('cuotaTexto').innerHTML = `El <b>día ${c.dia}</b> vence la cuota mensual (${cuando}). ${c.faltan === 0 ? 'Aboná hoy' : 'Aboná antes de esa fecha'} para seguir usando la tienda online y el panel sin cortes 😊`;
    $('cuotaMonto').hidden = !c.monto;
    $('cuotaMonto').textContent = c.monto ? `Monto: ${c.monto}` : '';
    $('cuotaDatos').hidden = !c.alias && !c.titular;
    $('cuotaAlias').value = c.alias || '';
    $('cuotaAlias').parentElement.hidden = !c.alias;
    $('cuotaTitular').textContent = c.titular ? `A nombre de ${c.titular}` : (c.datos || '');
    if (c.datos && !c.alias && !c.titular) $('cuotaDatos').hidden = false;
    $('cuotaWa').href = `https://wa.me/${WA_MARTIN}?text=${encodeURIComponent(`¡Hola Martín! Soy ${yo.alias || yo.username} de Carmesí. Te escribo por la cuota de la web del día ${c.dia}: `)}`;
    $('dlgCuota').showModal();
  }
  async function revisarCuota() {
    if (puede.super()) return;
    let c;
    try { c = await api('GET', '/api/cuota'); } catch (_) { return; }
    if (c.mostrar) mostrarCuota(c);
  }
  $('cuotaOk').addEventListener('click', () => $('dlgCuota').close());
  // Botoncito 📋 para copiar el alias (en el aviso y en los ajustes).
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copiar]');
    if (!b) return;
    const input = $(b.dataset.copiar);
    if (!input.value) return avisar('No hay nada para copiar');
    try { await navigator.clipboard.writeText(input.value); } catch (_) {
      input.select();
      return avisar('Mantené apretado para copiar');
    }
    b.textContent = '✓ Copiado';
    avisar('Alias copiado ✓');
    setTimeout(() => { b.textContent = '📋 Copiar'; }, 1800);
  });
  // Se cierre como se cierre, hasta mañana no vuelve a salir.
  $('dlgCuota').addEventListener('close', () => {
    if (cuotaDePrueba) { cuotaDePrueba = false; return; }
    api('POST', '/api/cuota/visto').catch(() => {});
  });

  $('menuCuota').addEventListener('click', async () => {
    try {
      const c = await api('GET', '/api/cuota/config');
      const f = $('formCuota');
      f.activo.checked = c.activo;
      f.dia.value = c.dia;
      f.aviso.value = c.aviso;
      f.monto.value = c.monto;
      f.alias.value = c.alias || '';
      f.titular.value = c.titular || '';
      // Datos cargados antes en un solo campo: se muestran para pasarlos a alias y titular.
      $('cuotaViejo').hidden = !c.datos;
      $('cuotaViejo').textContent = c.datos ? `Antes tenías cargado: "${c.datos}". Pasalo a Alias y A nombre de, y guardá.` : '';
      mostrarError($('errorCuota'), null);
      $('dlgCuotaConfig').showModal();
    } catch (err) { avisar(err.message); }
  });
  $('formCuota').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api('PUT', '/api/cuota/config', { activo: f.activo.checked, dia: f.dia.value, aviso: f.aviso.value, monto: f.monto.value, alias: f.alias.value, titular: f.titular.value });
      $('dlgCuotaConfig').close();
      avisar('Aviso de la cuota guardado ✓');
    } catch (err) { mostrarError($('errorCuota'), err); }
  });
  // Pixel Cuyo puede ver cómo le aparece a Valentina (con lo que está guardado).
  $('cuotaPrueba').addEventListener('click', async () => {
    try {
      const c = await api('GET', '/api/cuota?prueba=1');
      cuotaDePrueba = true;
      $('dlgCuotaConfig').close();
      mostrarCuota(c);
    } catch (err) { avisar(err.message); }
  });
  $('novedadesOk').addEventListener('click', () => { leerAlCerrar = true; $('dlgNovedades').close(); });
  // Con "¡Entendido!" (o abriendo la bandeja) quedan leídas; con la ✕ quedan esperando en la campanita.
  $('dlgNovedades').addEventListener('close', () => {
    if (leerAlCerrar && !vistaPrevia) marcarNoticias(enVentana, 'leido');
    else if (!leerAlCerrar && !vistaPrevia && enVentana.some((n) => !n.leido)) avisar('Te quedó guardada en la 🔔 campanita');
    vistaPrevia = false;
  });
  $('menuNovedades').addEventListener('click', () => {
    if (!mostrarNovedades('todas', novedades.items)) avisar('Todavía no hay noticias');
  });
  // En la campanita: las noticias sin leer arriba; al abrirla quedan leídas.
  function pintarBandeja() {
    const lista = sinLeer().slice().reverse();
    const fijadas = novedades.items.filter((n) => n.fijada);
    const mostrar = [...fijadas, ...lista.filter((n) => !n.fijada)];
    $('bandeja').hidden = !mostrar.length;
    $('bandejaLista').innerHTML = mostrar.map(tarjetaNoticia).join('');
    return lista;
  }
  $('bandejaTodas').addEventListener('click', () => { $('dlgAvisos').close(); $('menuNovedades').click(); });

  // ---------- 📣 noticias que escribe Pixel Cuyo ----------
  let vistaPrevia = false;
  const PARA = { todos: 'Todos', admin: 'Administradoras', vendedor: 'Vendedores' };
  async function pintarNoticiasEnviadas() {
    const { noticias } = await api('GET', '/api/noticias');
    $('listaNoticias').innerHTML = noticias.map((n) => `
      <li class="cambio">
        <div class="cambio__top"><b>${escapar(n.icono)} ${escapar(n.titulo)}</b><small>${fechaNoticia(n.fecha)}</small></div>
        <small>Para: ${PARA[n.para] || n.para} · ${n.lectores.length ? n.lectores.map((l) => `${escapar(l.nombre)} ${l.leyo ? '✓' : '·'}`).join('  ') : 'todavía no hay usuarios para esta noticia'}</small>
        <div class="cambio__acciones"><span class="cambio__estado">${n.lectores.filter((l) => l.leyo).length} de ${n.lectores.length} la leyeron</span>
          <button type="button" class="mini mini--borrar" data-noticia-borrar="${n.id}" aria-label="Borrar esta noticia">✕</button></div>
      </li>`).join('') || '<li class="vacio">Todavía no mandaste ninguna.</li>';
  }
  $('menuNoticia').addEventListener('click', async () => {
    $('formNoticia').reset();
    mostrarError($('errorNoticia'), null);
    try { await pintarNoticiasEnviadas(); } catch (_) { /* igual se puede escribir */ }
    $('dlgNoticia').showModal();
  });
  $('noticiaPrevia').addEventListener('click', () => {
    const f = $('formNoticia');
    if (!f.titulo.value.trim() || !f.texto.value.trim()) return mostrarError($('errorNoticia'), new Error('Escribí el título y el mensaje para ver cómo queda'));
    vistaPrevia = true;
    mostrarNovedades('nuevas', [{ key: 'previa', icono: f.icono.value, titulo: f.titulo.value, texto: f.texto.value, fecha: Date.now(), deMartin: true, leido: false }]);
  });
  $('formNoticia').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api('POST', '/api/noticias', { icono: f.icono.value, titulo: f.titulo.value, texto: f.texto.value, para: f.para.value });
      f.reset();
      await pintarNoticiasEnviadas();
      avisar('Noticia enviada ✓ Le va a aparecer cuando entre al panel');
    } catch (err) { mostrarError($('errorNoticia'), err); }
  });
  $('listaNoticias').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-noticia-borrar]');
    if (!b || !confirm('¿Borrar esta noticia? Desaparece de la bandeja de todos.')) return;
    try { await api('DELETE', `/api/noticias/${b.dataset.noticiaBorrar}`); await pintarNoticiasEnviadas(); } catch (err) { avisar(err.message); }
  });

  // ---------- 📖 guía del panel ----------
  // Cada tema tiene data-perm: solo aparecen los de lo que cada uno puede hacer.
  function abrirGuia() {
    marcarPaso('guia');
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
      if (t.dataset.solo && !puede[t.dataset.solo]()) return;
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
  // El número de la campanita: avisos + noticias sin leer.
  function pintarCampanita() {
    const n = avisos.length + sinLeer().length;
    $('avisosN').hidden = !n;
    $('avisosN').textContent = n;
  }
  async function pintarAvisos() {
    try { avisos = (await api('GET', '/api/avisos')).avisos; } catch (_) { return; }
    pintarCampanita();
    $('listaAvisos').innerHTML = avisos.map((a, i) => `
      <li class="aviso-item">
        <span class="aviso-item__icono" aria-hidden="true">${a.icono}</span>
        <div>
          <strong>${escapar(a.titulo)}</strong>
          <p>${escapar(a.texto)}</p>
          ${a.descargar ? `<button type="button" class="btn btn--bordo" data-aviso-excel="${i}">⬇️ Bajar en Excel</button>` : ''}
          ${a.producto ? `<button type="button" class="btn btn--bordo" data-aviso-producto="${a.producto}">Ver producto</button>` : ''}
          ${a.cambios ? '<button type="button" class="btn btn--bordo" data-aviso-cambios>Ver cambios</button>' : ''}
        </div>
      </li>`).join('') || (sinLeer().length || novedades.items.some((n) => n.fijada) ? '' : '<li class="vacio">No tenés avisos. 👌</li>');
  }
  // Se revisa cada media hora mientras el panel está abierto.
  setInterval(() => { if (yo) pintarAvisos(); }, 30 * 60e3);

  $('abrirAvisos').addEventListener('click', async () => {
    await pintarAvisos();
    const nuevas = pintarBandeja();
    $('dlgAvisos').showModal();
    // Abrió la campanita: las noticias que ve quedan leídas (el "Nuevo" se ve esta vez).
    if (nuevas.length) marcarNoticias(nuevas, 'leido');
  });

  $('listaAvisos').addEventListener('click', (e) => {
    const prod = e.target.closest('[data-aviso-producto]');
    if (prod) { $('dlgAvisos').close(); return abrirFicha(Number(prod.dataset.avisoProducto)); }
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
    const clientes = esperando.filter((a) => !a.notifiedAt).length;
    if (clientes) cajas.splice(2, 0, { n: clientes, t: 'Esperando stock', filtro: 'sinstock', alerta: true });
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
          <time>${hace(a.at)}</time>${botonBorrarCambio(a)}</li>`).join('') || '<li class="vacio">Todavía no hay cambios.</li>';
    } catch (_) { /* si falla, no se muestra */ }
  }

  // Solo Pixel Cuyo: una ✕ en cada cambio para borrarlo del historial de todos.
  const botonBorrarCambio = (a) => (puede.super()
    ? `<button type="button" class="cambio__borrar" data-borrar-cambio="${a.id}" aria-label="Borrar este cambio del historial" title="Borrar del historial">✕</button>`
    : '');
  async function borrarCambio(b) {
    if (!confirm('¿Borrar este cambio del historial? Se borra para todos (inicio, historial y Excel) y no se puede deshacer.')) return;
    try {
      await api('DELETE', `/api/activity/${b.dataset.borrarCambio}`);
      const li = b.closest('li');
      li.style.transition = 'opacity .25s';
      li.style.opacity = '0';
      setTimeout(() => {
        pintarUltimos();
        if ($('dlgHistorial').open) { pintarDia(); pintarAlmanaque(); }
      }, 250);
      avisar('Cambio borrado del historial');
    } catch (err) { avisar(err.message); }
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-borrar-cambio]');
    if (b) borrarCambio(b);
  });

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
          ${pendientesDe(p.id).length ? `<em class="marca marca--esperan">🔔 ${pendientesDe(p.id).length}</em>` : ''}
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
        ${esperandoHtml(p)}
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

  // Avisar a un cliente: se abre su WhatsApp con el mensaje listo y queda marcada como avisada.
  $('fichaCuerpo').addEventListener('click', async (e) => {
    const av = e.target.closest('[data-alerta-avisar]');
    const borrar = e.target.closest('[data-alerta-borrar]');
    const id = Number((av || borrar || {}).dataset?.alertaAvisar || (borrar && borrar.dataset.alertaBorrar));
    if (!id) return;
    try {
      if (av) {
        await api('POST', `/api/avisame/${id}`);
        esperando.find((a) => a.id === id).notifiedAt = Date.now();
      } else {
        await api('DELETE', `/api/avisame/${id}`);
        esperando = esperando.filter((a) => a.id !== id);
      }
      pintarFicha();
      pintarTodo();
      pintarAvisos();
    } catch (err) { avisar(err.message); }
  });

  $('fichaCuerpo').addEventListener('change', async (e) => {
    const sw = e.target.closest('[data-sw]');
    if (!sw) return;
    sw.disabled = true;
    try {
      const { product } = await api('PATCH', `/api/products/${enFicha.id}`, { [sw.dataset.sw]: sw.checked });
      Object.assign(enFicha, product);
      pintarTodo();
      const esperan = pendientesDe(enFicha.id).length;
      if (sw.dataset.sw === 'soldOut') pintarFicha();
      avisar(sw.dataset.sw === 'soldOut'
        ? (product.soldOut ? 'Marcado sin stock' : esperan ? `Marcado con stock ✓ ${esperan === 1 ? 'Hay 1 persona esperando' : `Hay ${esperan} personas esperando`}: avisales acá abajo 👇` : 'Marcado con stock')
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
    if (!$('comoBanda').hidden) return volverDeComo();
    await api('POST', '/api/logout').catch(() => {});
    history.replaceState(null, '', '#inicio');
    mostrarLogin();
  });

  $('menuNegocio').addEventListener('click', async () => {
    try {
      const s = await api('GET', '/api/settings');
      $('formNegocio').whatsapp.value = s.whatsapp;
      $('formNegocio').instagram.value = s.instagram;
      $('formNegocio').tiktok.value = s.tiktok;
      mostrarError($('errorNegocio'), null);
      $('dlgNegocio').showModal();
    } catch (err) { avisar(err.message); }
  });

  $('formNegocio').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('PUT', '/api/settings', { whatsapp: e.target.whatsapp.value, instagram: e.target.instagram.value, tiktok: e.target.tiktok.value });
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
      marcarPaso('clave');
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
        <time>${new Date(a.at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</time>${botonBorrarCambio(a)}
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

  // ---------- 🚀 publicar la web: confirmar → carga con % → felicitaciones ----------
  let simulacion = false;
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  function abrirPublicar(esSimulacion) {
    simulacion = esSimulacion;
    $('publicarSim').hidden = !simulacion;
    $('dlgPublicar').showModal();
  }
  $('menuPublicar').addEventListener('click', () => abrirPublicar(false));
  $('menuPublicarPrueba').addEventListener('click', () => abrirPublicar(true));
  // La carga no se cierra con Esc ni tocando afuera.
  $('dlgPublicando').addEventListener('cancel', (e) => e.preventDefault());

  const PASOS_CARGA = [
    [0, 'Revisando tus productos…'],
    [22, 'Preparando las fotos…'],
    [45, 'Ordenando las categorías…'],
    [63, 'Abriendo las puertas de la tienda…'],
    [82, 'Avisándole a Google…'],
    [97, '¡Listo! ✨'],
  ];
  // Cuenta de 0 a 100 en unos segundos (y espera a que el servidor confirme antes de llegar al final).
  async function cargar100(trabajo) {
    const total = 5200;
    const inicio = performance.now();
    let hecho = false, error = null;
    trabajo.then(() => { hecho = true; }, (e) => { error = e; hecho = true; });
    for (;;) {
      if (error) throw error;
      const t = Math.min(1, (performance.now() - inicio) / total);
      let p = Math.round(100 * (1 - Math.pow(1 - t, 2.2)));
      if (!hecho) p = Math.min(p, 96);
      $('publicandoNum').textContent = p;
      $('publicandoBarra').style.width = p + '%';
      $('publicandoTxt').textContent = PASOS_CARGA.filter(([desde]) => p >= desde).pop()[1];
      if (p >= 100) return;
      await espera(40);
    }
  }
  $('publicarSi').addEventListener('click', async () => {
    $('dlgPublicar').close();
    $('publicandoNum').textContent = '0';
    $('publicandoBarra').style.width = '0%';
    $('dlgPublicando').showModal();
    try {
      await cargar100(simulacion ? espera(1500) : api('POST', '/api/publicar'));
      await espera(500);
      $('dlgPublicando').close();
      if (!simulacion) pintarObra(false);
      mostrarFelicitaciones();
    } catch (err) {
      $('dlgPublicando').close();
      avisar(err.message);
    }
  });

  function mostrarFelicitaciones() {
    const nombre = simulacion ? 'Valen' : (yo.alias || yo.username).split(' ')[0];
    $('felicitacionesTitulo').textContent = `¡Felicitaciones, ${nombre}!`;
    $('felicitacionesSim').hidden = !simulacion;
    $('dlgFelicitaciones').showModal();
    $('dlgFelicitaciones').scrollTop = 0;
    papelitos();
  }
  $('felicitacionesCopiar').addEventListener('click', async () => {
    const ok = await copiarTexto('https://carmesibags.com.ar');
    avisar(ok ? 'Link copiado ✓ ¡Compartilo en tus redes!' : 'carmesibags.com.ar');
  });

  // Papelitos de festejo en los colores de Carmesí (si el celu pide menos movimiento, no se tiran).
  function papelitos() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const c = $('papelitos');
    const ctx = c.getContext('2d');
    const w = c.width = window.innerWidth;
    const h = c.height = window.innerHeight;
    const colores = ['#5e1a22', '#8b1925', '#f3ebe2', '#d4af7a', '#c9a24d', '#e8c9c0'];
    const piezas = Array.from({ length: 140 }, () => ({
      x: Math.random() * w, y: -20 - Math.random() * h * 0.6,
      vx: (Math.random() - 0.5) * 1.6, vy: 1.6 + Math.random() * 2.6,
      r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.2,
      t: 5 + Math.random() * 6, color: colores[Math.floor(Math.random() * colores.length)],
      forma: Math.random() < 0.3 ? 'circulo' : 'tira',
    }));
    const inicio = performance.now();
    (function cuadro(ahora) {
      const pasado = ahora - inicio;
      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = pasado > 4500 ? Math.max(0, 1 - (pasado - 4500) / 1500) : 1;
      // Por tiempo (no por cuadro), así cae igual en un celu lento.
      const k = pasado / 16;
      for (const p of piezas) {
        const x = p.x + p.vx * k + Math.sin(pasado / 400 + p.r) * 12;
        const y = p.y + p.vy * k;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(p.r + p.vr * k);
        ctx.fillStyle = p.color;
        if (p.forma === 'circulo') { ctx.beginPath(); ctx.arc(0, 0, p.t / 2.4, 0, Math.PI * 2); ctx.fill(); }
        else ctx.fillRect(-p.t / 2, -p.t / 5, p.t, p.t / 2.5);
        ctx.restore();
      }
      if (pasado < 6000 && $('dlgFelicitaciones').open) requestAnimationFrame(cuadro);
      else ctx.clearRect(0, 0, w, h);
    })(inicio);
  }

  // Cerrar diálogos con la X o tocando afuera (menos los que tienen data-fijo, como la carga)
  document.querySelectorAll('dialog').forEach((d) => {
    d.addEventListener('click', (e) => {
      if (d.hasAttribute('data-fijo')) return;
      if (e.target === d || e.target.closest('[data-cerrar]')) d.close();
    });
  });

  // ---------- arranque ----------
  api('GET', '/api/me').then((me) => entrar(me.user, me)).catch(() => mostrarLogin());
})();
