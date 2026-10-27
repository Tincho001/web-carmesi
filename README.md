# Web Carmesí

Catálogo web de **Carmesí Bags** (carteras y bolsos, Mendoza). Los clientes eligen productos, arman su pedido y lo mandan por WhatsApp.

Es un sitio estático (HTML + CSS + JS, sin build): se puede subir tal cual a cualquier hosting.

## Estructura

- `index.html` — la página
- `css/styles.css` — estilos (colores en `:root`)
- `js/productos.js` — **catálogo**: productos, precios, categorías, WhatsApp e Instagram
- `js/app.js` — filtros, detalle, pedido y armado del mensaje de WhatsApp
- `assets/img/productos/` — fotos de productos (máx. 900 px)

## Cambiar precios o productos

Todo se edita en `js/productos.js`:

- Precio: cambiar `precio`.
- Sin stock: agregar `agotado: true`.
- Producto nuevo: subir la foto a `assets/img/productos/` y copiar una línea cambiando `id`, `nombre`, `color`, `categoria`, `precio` y `foto`.

## Ver en local

```bash
python -m http.server 5173
```

y abrir http://localhost:5173
