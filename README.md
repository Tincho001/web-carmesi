# Carmesí Bags

Web de Carmesí Bags (carteras y bolsos, Mendoza) con pedido por WhatsApp, y panel para que Valentina cargue categorías y productos desde el celular.

- **Web pública:** `/`. Lee el catálogo de `/api/catalogo`.
- **Panel:** `/panel`. Usuarios `admin` (Pixel Cuyo) y `valentina`. Permite crear, renombrar, ordenar y borrar categorías (solo las vacías), y crear, editar, ordenar, marcar sin stock, ocultar y borrar productos. También se cambian ahí el WhatsApp que recibe los pedidos, el Instagram y la contraseña.
- **Stack:** Node puro (`http`) + SQLite local (`@libsql/client`). El front es HTML/CSS/JS sin build (`public/`).
- **Fotos:** se achican en el celu antes de subirlas (1280 px + miniatura de 600 px) y se guardan en `DATA_DIR/uploads`.
- **Catálogo inicial:** `seed/` (los 19 productos de la muestra). Se carga solo la primera vez que arranca con una base vacía.

## Correr en la PC

```bash
npm install
npm start
```

Abre en http://localhost:3200. La primera vez crea los usuarios y deja las contraseñas en `data/contrasenas-iniciales.txt`.

## Servidor (Hetzner)

- App en `/var/www/carmesi`, datos (base + fotos) en `/var/www/carmesi-data`, proceso pm2 `carmesi`, puerto 3200.
- Deploy automático con GitHub Actions (`.github/workflows/deploy.yml`) en cada push a `main`. Necesita los secrets `SERVER_HOST`, `SERVER_USER` y `SSH_PRIVATE_KEY`.
- nginx: `deploy/nginx-carmesi.conf` + certbot para HTTPS.
- Ver `.env.example`.
