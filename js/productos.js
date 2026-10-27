// Catálogo de Carmesí Bags.
// Para cambiar un precio, editá "precio". Para sacar un producto, borrá su línea.
// Para sumar uno nuevo: poné la foto en assets/img/productos/ y agregá una línea igual.
// "agotado: true" lo muestra como sin stock.

window.CARMESI = {
  whatsapp: '5492612554003',
  instagram: 'bags_carmesi',

  categorias: [
    { id: 'carteras', nombre: 'Carteras' },
    { id: 'bolsos', nombre: 'Bolsos' },
    { id: 'organizadores', nombre: 'Organizadores' },
    { id: 'set-materos', nombre: 'Set materos' },
    { id: 'neceseres', nombre: 'Neceseres' },
    { id: 'porta-botella', nombre: 'Porta botella' },
  ],

  productos: [
    { id: 'monos-negro', nombre: 'Cartera Moños', color: 'Negro animal print', categoria: 'carteras', precio: 22000, foto: 'monos-negro.jpg' },
    { id: 'monos-bordo', nombre: 'Cartera Moños', color: 'Bordó', categoria: 'carteras', precio: 22000, foto: 'monos-bordo.jpg' },
    { id: 'monos-caramelo', nombre: 'Cartera Moños', color: 'Caramelo', categoria: 'carteras', precio: 22000, foto: 'monos-caramelo.jpg' },
    { id: 'monos-crema', nombre: 'Cartera Moños', color: 'Crema', categoria: 'carteras', precio: 22000, foto: 'monos-crema.jpg' },
    { id: 'monos-leopardo', nombre: 'Cartera Moños', color: 'Leopardo', categoria: 'carteras', precio: 22000, foto: 'monos-leopardo.jpg' },
    { id: 'hebilla-leopardo-marron', nombre: 'Cartera Hebilla', color: 'Leopardo y marrón', categoria: 'carteras', precio: 29000, foto: 'hebilla-leopardo-marron.jpg' },
    { id: 'hebilla-leopardo-negro', nombre: 'Cartera Hebilla', color: 'Leopardo y negro', categoria: 'carteras', precio: 29000, foto: 'hebilla-leopardo-negro.jpg' },
    { id: 'tachas-marron', nombre: 'Cartera Tachas', color: 'Marrón', categoria: 'carteras', precio: 29000, foto: 'tachas-marron.jpg' },
    { id: 'baguette-leopardo-dorado', nombre: 'Baguette Leopardo', color: 'Cierre dorado', categoria: 'carteras', precio: 29000, foto: 'baguette-leopardo-dorado.jpg' },
    { id: 'solapa-leopardo-negro', nombre: 'Cartera Solapa', color: 'Negro animal print', categoria: 'carteras', precio: 29000, foto: 'solapa-leopardo-negro.jpg' },

    { id: 'tote-cinturon-negro', nombre: 'Bolso Cinturón', color: 'Negro', categoria: 'bolsos', precio: 30000, foto: 'tote-cinturon-negro.jpg' },
    { id: 'tote-cinturon-marron', nombre: 'Bolso Cinturón', color: 'Marrón', categoria: 'bolsos', precio: 30000, foto: 'tote-cinturon-marron.jpg' },
    { id: 'tote-cinturon-leopardo-negro', nombre: 'Bolso Cinturón', color: 'Negro animal print', categoria: 'bolsos', precio: 30000, foto: 'tote-cinturon-leopardo-negro.jpg' },
    { id: 'tote-marron', nombre: 'Tote Clásico', color: 'Marrón', categoria: 'bolsos', precio: 30000, foto: 'tote-marron.jpg' },
    { id: 'set-tote-negro', nombre: 'Set Tote + Neceser', color: 'Negro', categoria: 'bolsos', precio: 32000, foto: 'set-tote-negro.jpg' },
    { id: 'set-tote-marron', nombre: 'Set Tote + Neceser', color: 'Marrón', categoria: 'bolsos', precio: 32000, foto: 'set-tote-marron.jpg' },
    { id: 'set-gamuza-negro', nombre: 'Set Gamuza + Monedero', color: 'Negro', categoria: 'bolsos', precio: 32000, foto: 'set-gamuza-negro.jpg' },
    { id: 'set-gamuza-marron', nombre: 'Set Gamuza + Monedero', color: 'Marrón', categoria: 'bolsos', precio: 32000, foto: 'set-gamuza-marron.jpg' },
    { id: 'set-gamuza-leopardo-negro', nombre: 'Set Gamuza + Monedero', color: 'Negro animal print', categoria: 'bolsos', precio: 32000, foto: 'set-gamuza-leopardo-negro.jpg' },
  ],
};
