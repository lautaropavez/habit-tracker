# UX_UI — Habit Tracker

Criterios visuales y de UX. Se derivan del producto real (`css/styles.css`, `index.html`, `js/app.js` en el commit `3e50e7a`); no son un design system nuevo. Estado del producto: [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md).

## 1. Alcance y autoridad

- Los valores de este documento describen la **línea base actual**. Sirven para mantener consistencia.
- **No autorizan rediseños globales** por preferencia estética, ni de un agente ni de nadie. Cambiar la línea base (paleta, escala tipográfica, layout general) es una decisión humana explícita.
- Un cambio visible acotado sigue siendo NORMAL (`WORKFLOW.md`).
- Hoy la verificación visual es humana, en iPhone (Safari). `qa-visual` es trabajo futuro (`ROADMAP.md`).

## 2. Mobile-first y responsive

- Diseñar primero para iPhone en vertical. El `<meta viewport>` usa `width=device-width, initial-scale=1.0` y no bloquea el zoom: mantenerlo.
- Rango de referencia: de 320 a 430 px de ancho sin scroll horizontal. Viewports de referencia para revisar: 390×844, 430×932, 768×1024 y 1440×900.
- Línea base: no hay `@media queries`; el layout es fluido (`flex`, `grid` con columnas fraccionarias). El `body` no tiene ancho máximo, así que en pantallas anchas el contenido se estira. Es una limitación conocida, no una decisión de diseño.
- Contenedor de página: `padding` de 20 px y 80 px de margen inferior para no tapar contenido con el botón flotante.
- Todo elemento nuevo debe seguir funcionando con nombres largos (envolver o truncar sin romper el layout).

## 3. Jerarquía y spacing

- Orden visual: título de página, pestañas, contenido de la vista, botón flotante `+`.
- Tarjeta de hábito: icono (28 px), nombre (18 px, peso 600), frecuencia (12 px, gris), acciones, estadísticas.
- Spacing observado: 4, 8, 10, 12, 15, 16 y 20 px. Reutilizar esos valores.
- Radios: 6 px controles y celdas, 8 y 10 px contenedores medianos, 12 px modal, círculo para el botón flotante.

## 4. Tipografía

- Fuente del sistema: `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`. No agregar fuentes externas.
- Escala observada: 24 (título), 20 (título de modal), 18 (nombres), 16 (inputs, botones primarios, valores), 14 (cuerpo, etiquetas, botones), 13 (días), 12 (secundario), 11 y 10 y 9 (etiquetas de estadísticas y del gráfico).
- **Inputs y selects a 16 px**: evita el zoom automático de iOS Safari. No reducirlos.
- Texto nuevo: no bajar de 12 px. Los tamaños de 9 a 11 px existentes son deuda conocida, no precedente.

## 5. Color y contraste

Paleta observada: fondo `#1a1a1a`, superficie `#2a2a2a`, superficie elevada `#3a3a3a`, texto `#e0e0e0`, texto secundario `#888`, acento `#4CAF50`, peligro `#ff4444`, más los 10 colores de hábito de `js/app.js`. Solo existe tema oscuro.

- Objetivo para código nuevo: contraste WCAG AA (4.5:1 para texto normal, 3:1 para texto grande y componentes de interfaz).
- No comunicar estado únicamente con color.
- **Brechas conocidas** (relaciones aproximadas, calculadas a mano y no medidas con una herramienta; verificarlas antes de actuar): `#888` sobre `#2a2a2a` ≈ 4,1:1; `#666` sobre `#1a1a1a` ≈ 3:1 (etiquetas de 10 px); texto blanco sobre `#4CAF50` ≈ 2,8:1; texto blanco sobre `#ff4444` ≈ 3,4:1. Corregirlas es un cambio visible con su propia posta.

## 6. Touch targets

- Objetivo para controles nuevos: al menos 44 × 44 pt.
- Cumplen o rozan el objetivo hoy: botón flotante `+` (60 px), botones de icono del modal, selector de color (40 px de alto) y botones primarios y secundarios del modal (≈ 43 px).
- Por debajo del objetivo (estimación por padding y tamaño de fuente): `.btn` de acciones de hábito (≈ 33 px de alto), pestañas (≈ 37 px), botones de navegación del calendario (≈ 33 px). Deuda conocida.

## 7. Componentes existentes

Reutilizar antes de crear uno nuevo:

- Pestañas segmentadas, tarjeta de hábito con borde izquierdo del color del hábito, botones `.btn` (`check`, `edit`, `delete`), `.btn-primary` y `.btn-secondary`.
- Cajas de estadística, calendario mensual, gráfico de barras de siete días, botón flotante, modal, campos de formulario y selectores (iconos en 6 columnas, colores en 5, frecuencia en lista).
- Un componente nuevo se justifica solo si ninguno existente sirve, y debe respetar radios, spacing, paleta y tipografía de este documento.

## 8. Modales

- Overlay `rgba(0,0,0,0.9)`, contenido centrado con ancho máximo de 400 px y alto máximo del 90 % de la ventana, con scroll interno.
- Acciones al pie: Cancelar (secundario) a la izquierda y Guardar o Confirmar (primario) a la derecha, con el mismo ancho.
- La confirmación destructiva hoy usa `confirm()` nativo. Cambiarla sería una decisión de UX, no un detalle técnico.
- Toda pantalla de confirmación o de preview futura (por ejemplo, la de importación) sigue estos criterios, muestra el texto de datos del usuario solo con `textContent` (`SECURITY.md`) y deja clara la acción irreversible.

## 9. Estados

- **Vacío:** bloque `.empty-state` centrado, gris, con una instrucción breve («Presiona + para agregar uno»).
- **Solo lectura por corrupción:** banner visible (`#storageWarning`, que reutiliza `.empty-state`) y controles mutantes con `disabled` nativo.
- **Futuro:** días futuros del calendario con opacidad reducida y sin acción.
- Un error debe verse con un mensaje en texto; nunca fallar en silencio ni mostrar un éxito falso.

## 10. Accesibilidad

- Línea base: `lang="es"` en `<html>`; sin atributos `aria-*` en el código; sin estilos `:focus` propios; los botones de icono (✏️, 🗑️) no tienen texto alternativo.
- Criterios para código nuevo: nombre accesible en todo botón de icono (texto o `aria-label`), foco visible, sin desactivar el zoom, respeto de `prefers-reduced-motion` en animaciones nuevas, y el estado no depende solo del color.
- Corregir la línea base existente es trabajo con posta propia, no un cambio incidental.

## 11. Consistencia

Un cambio visual debe verse como parte de la misma app: mismos radios, spacing, paleta, tipografía y patrones de botones. Si necesita romper alguno de estos valores, se registra como decisión humana.
