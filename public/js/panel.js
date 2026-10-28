(function () {
  const $ = (id) => document.getElementById(id);
  const plata = (n) => '$' + Number(n).toLocaleString('es-AR');
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
    if (!r.ok) throw new Error(data.error || 'Algo salió mal. Probá de nuevo.');
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
  const puede = {
    manage: () => yo.role === 'super' || yo.role === 'admin',
    super: () => yo.role === 'super',
  };
  let enObra = false;

  async function entrar(user, obra) {
    yo = user;
    $('login').hidden = true;
    $('app').hidden = false;
    $('quien').textContent = `Entraste como ${user.alias || user.username} · ${ROL_NOMBRE[user.role] || user.role}`;
    document.querySelectorAll('[data-solo]').forEach((el) => { el.hidden = !puede[el.dataset.solo](); });
    // Los vendedores cargan productos y stock, pero no tocan categorías ni borran.
    $('tabBtnCategorias').hidden = !puede.manage();
    if (obra === undefined) obra = (await api('GET', '/api/me')).maintenance;
    pintarObra(obra);
    await cargar();
  }

  function pintarObra(obra) {
    enObra = obra;
    $('cartelObra').hidden = !obra;
    $('menuObra').textContent = obra ? '🚀 Abrir la web al público' : '🧵 Poner la web en construcción';
  }

  async function cargar() {
    const [c, p] = await Promise.all([api('GET', '/api/categories'), api('GET', '/api/products')]);
    categorias = c.categories;
    productos = p.products;
    pintarCategorias();
    pintarProductos();
  }

  // ---------- pestañas ----------
  document.querySelector('.pestanas').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    document.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    $('tabProductos').hidden = b.dataset.tab !== 'productos';
    $('tabCategorias').hidden = b.dataset.tab !== 'categorias';
  });

  // ---------- productos ----------
  $('buscar').addEventListener('input', pintarProductos);
  $('filtroCat').addEventListener('change', pintarProductos);

  function pintarProductos() {
    const sel = $('filtroCat');
    const elegido = sel.value;
    sel.innerHTML = '<option value="">Todas las categorías</option>' +
      categorias.map((c) => `<option value="${c.id}">${escapar(c.name)} (${c.count})</option>`).join('');
    sel.value = categorias.some((c) => String(c.id) === elegido) ? elegido : '';

    const q = $('buscar').value.trim().toLowerCase();
    const filtrados = productos.filter((p) =>
      (!sel.value || String(p.categoryId) === sel.value) &&
      (!q || `${p.name} ${p.color}`.toLowerCase().includes(q)));
    // Con búsqueda no tiene sentido reordenar (las flechas mueven dentro de la categoría completa).
    const ordenable = !q;

    const html = categorias.map((c) => {
      const lista = filtrados.filter((p) => p.categoryId === c.id);
      if (!lista.length) return '';
      return `<h3 class="grupo">${escapar(c.name)}</h3><ul class="prods">${lista.map((p, i) => `
        <li class="prod${p.hidden ? ' prod--oculto' : ''}">
          <button type="button" class="prod__abrir" data-editar="${p.id}">
            <img src="${p.thumb || ''}" alt="" loading="lazy">
            <span class="prod__info">
              <strong>${escapar(p.name)}</strong>
              <span>${escapar(p.color)}</span>
              <span class="prod__precio">${plata(p.price)}</span>
              <span class="prod__marcas">
                ${p.soldOut ? '<em class="marca marca--stock">Sin stock</em>' : ''}
                ${p.hidden ? '<em class="marca">Oculto</em>' : ''}
              </span>
            </span>
          </button>
          <div class="prod__acciones">
            <button type="button" class="mini" data-stock="${p.id}" title="${p.soldOut ? 'Marcar con stock' : 'Marcar sin stock'}">${p.soldOut ? 'Hay stock' : 'Sin stock'}</button>
            ${ordenable ? `<span class="flechas">
              <button type="button" class="mini" data-subir="${p.id}" aria-label="Subir" ${i === 0 ? 'disabled' : ''}>↑</button>
              <button type="button" class="mini" data-bajar="${p.id}" aria-label="Bajar" ${i === lista.length - 1 ? 'disabled' : ''}>↓</button>
            </span>` : ''}
          </div>
        </li>`).join('')}</ul>`;
    }).join('');
    $('listaProductos').innerHTML = html || `<p class="vacio">${productos.length ? 'No hay productos que coincidan.' : 'Todavía no hay productos. Tocá “+ Nuevo producto”.'}</p>`;
  }

  $('listaProductos').addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    try {
      if (t.dataset.editar) return abrirProducto(productos.find((p) => p.id === Number(t.dataset.editar)));
      if (t.dataset.stock) {
        const p = productos.find((x) => x.id === Number(t.dataset.stock));
        const { product } = await api('PATCH', `/api/products/${p.id}`, { soldOut: !p.soldOut });
        Object.assign(p, product);
        pintarProductos();
        avisar(product.soldOut ? 'Marcado sin stock' : 'Marcado con stock');
      }
      const mover = t.dataset.subir || t.dataset.bajar;
      if (mover) {
        await api('POST', `/api/products/${mover}/move`, { dir: t.dataset.subir ? 'up' : 'down' });
        productos = (await api('GET', '/api/products')).products;
        pintarProductos();
      }
    } catch (err) { avisar(err.message); }
  });

  // ---------- formulario de producto ----------
  const dlgProducto = $('dlgProducto');
  const form = $('formProducto');
  let editando = null;
  let fotoNueva = null;

  $('nuevoProducto').addEventListener('click', () => {
    if (!categorias.length) { avisar('Primero creá una categoría'); return; }
    abrirProducto(null);
  });

  function abrirProducto(p) {
    editando = p;
    fotoNueva = null;
    form.reset();
    mostrarError($('errorProducto'), null);
    $('tituloProducto').textContent = p ? 'Editar producto' : 'Nuevo producto';
    $('selCat').innerHTML = categorias.map((c) => `<option value="${c.id}">${escapar(c.name)}</option>`).join('');
    const filtro = $('filtroCat').value;
    form.name.value = p ? p.name : '';
    form.color.value = p ? p.color : '';
    form.categoryId.value = p ? p.categoryId : (filtro || categorias[0].id);
    form.price.value = p ? p.price : '';
    form.soldOut.checked = p ? p.soldOut : false;
    form.hidden.checked = p ? p.hidden : false;
    verFoto(p ? p.photo : null);
    $('borrarProducto').hidden = !p || !puede.manage();
    dlgProducto.showModal();
  }

  function verFoto(src) {
    $('fotoVista').hidden = !src;
    if (src) $('fotoVista').src = src;
    $('fotoTexto').textContent = src ? 'Tocá para cambiar la foto' : '📷 Tocá para sacar o elegir la foto';
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

  $('fotoInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      $('fotoTexto').textContent = 'Preparando foto…';
      fotoNueva = { photo: await achicar(file, 1280, 0.82), thumb: await achicar(file, 600, 0.8) };
      verFoto(fotoNueva.photo);
    } catch (err) {
      mostrarError($('errorProducto'), err);
      verFoto(editando ? editando.photo : null);
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const datos = {
      name: form.name.value,
      color: form.color.value,
      categoryId: Number(form.categoryId.value),
      price: form.price.value,
      soldOut: form.soldOut.checked,
      hidden: form.hidden.checked,
      ...(fotoNueva || {}),
    };
    if (!editando && !fotoNueva) { mostrarError($('errorProducto'), 'Falta la foto'); return; }
    const boton = $('guardarProducto');
    boton.disabled = true;
    boton.textContent = 'Guardando…';
    try {
      if (editando) await api('PUT', `/api/products/${editando.id}`, datos);
      else await api('POST', '/api/products', datos);
      dlgProducto.close();
      await cargar();
      avisar(editando ? 'Cambios guardados ✓' : 'Producto agregado ✓');
    } catch (err) {
      mostrarError($('errorProducto'), err);
    } finally {
      boton.disabled = false;
      boton.textContent = 'Guardar';
    }
  });

  $('borrarProducto').addEventListener('click', async () => {
    if (!editando || !confirm(`¿Borrar "${editando.name} ${editando.color}"? No se puede deshacer.`)) return;
    try {
      await api('DELETE', `/api/products/${editando.id}`);
      dlgProducto.close();
      await cargar();
      avisar('Producto borrado');
    } catch (err) { mostrarError($('errorProducto'), err); }
  });

  // ---------- categorías ----------
  function pintarCategorias() {
    $('listaCats').innerHTML = categorias.map((c, i) => `
      <li class="cat">
        <span class="cat__nombre">${escapar(c.name)} <small>${c.count} ${c.count === 1 ? 'producto' : 'productos'}</small></span>
        <span class="flechas">
          <button type="button" class="mini" data-subir="${c.id}" aria-label="Subir" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="mini" data-bajar="${c.id}" aria-label="Bajar" ${i === categorias.length - 1 ? 'disabled' : ''}>↓</button>
        </span>
        <button type="button" class="mini" data-renombrar="${c.id}">Renombrar</button>
        <button type="button" class="mini mini--borrar" data-borrar="${c.id}" ${c.count ? 'disabled title="Tiene productos"' : ''}>Borrar</button>
      </li>`).join('') || '<li class="vacio">Todavía no hay categorías.</li>';
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

  // ---------- menú ----------
  $('abrirMenu').addEventListener('click', () => $('dlgMenu').showModal());

  $('salir').addEventListener('click', async () => {
    await api('POST', '/api/logout').catch(() => {});
    $('dlgMenu').close();
    mostrarLogin();
  });

  $('menuNegocio').addEventListener('click', async () => {
    $('dlgMenu').close();
    const s = await api('GET', '/api/settings');
    $('formNegocio').whatsapp.value = s.whatsapp;
    $('formNegocio').instagram.value = s.instagram;
    mostrarError($('errorNegocio'), null);
    $('dlgNegocio').showModal();
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
    $('dlgMenu').close();
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

  $('menuUsuarios').addEventListener('click', async () => {
    $('dlgMenu').close();
    $('formUsuario').reset();
    mostrarError($('errorUsuarios'), null);
    // Solo Pixel Cuyo crea administradores; la dueña crea vendedores.
    $('selRol').innerHTML = (puede.super() ? '<option value="admin">Administrador/a</option>' : '') + '<option value="vendedor" selected>Vendedor/a</option>';
    $('ayudaRoles').textContent = 'Vendedor/a: carga y edita productos y stock, pero no borra ni toca categorías ni datos del negocio.' +
      (puede.super() ? ' Administrador/a: maneja todo el catálogo y crea vendedores.' : '');
    try {
      await pintarUsuarios();
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
      await pintarUsuarios();
      avisar('Usuario creado ✓');
    } catch (err) { mostrarError($('errorUsuarios'), err); }
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
  const ACCION = { create: 'creó', update: 'cambió', delete: 'borró' };
  const TIPO = { product: 'el producto', category: 'la categoría', user: 'el usuario', site: '' };

  $('menuHistorial').addEventListener('click', async () => {
    $('dlgMenu').close();
    try {
      const { items } = await api('GET', '/api/activity');
      $('listaHistorial').innerHTML = items.map((a) => `
        <li>
          <p><strong>${escapar(a.who)}</strong> ${ACCION[a.action] || a.action} ${TIPO[a.kind] ?? ''} <strong>${escapar(a.name)}</strong></p>
          ${a.changes.length ? `<ul>${a.changes.map((c) => `<li>${escapar(c)}</li>`).join('')}</ul>` : ''}
          <time>${new Date(a.at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}</time>
        </li>`).join('') || '<li class="vacio">Todavía no hay cambios.</li>';
      $('dlgHistorial').showModal();
    } catch (err) { avisar(err.message); }
  });

  // ---------- web en construcción (solo Pixel Cuyo) ----------
  $('menuObra').addEventListener('click', async () => {
    const abrir = enObra;
    if (!confirm(abrir ? '¿Abrir la web? Todos van a ver los productos.' : '¿Poner la web en construcción? Los clientes no van a ver los productos.')) return;
    try {
      const { maintenance } = await api('PUT', '/api/maintenance', { on: !abrir });
      pintarObra(maintenance);
      $('dlgMenu').close();
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
  api('GET', '/api/me').then(({ user, maintenance }) => entrar(user, maintenance)).catch(() => mostrarLogin());
})();
