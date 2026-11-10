# Tablero de anielnutricionista.com

Página para que Aniel vea cómo le va a su web: cuántas personas entran, de dónde llegan, qué miran y cuántas quieren escribirle. Todo en lenguaje simple y pensado para verse en el celular.

**Ver el tablero:** https://ikalinowski.github.io/tablero-aniel/

## Cómo funciona

1. Todos los días a las 6:00 a. m. (hora de Lima), GitHub Actions corre `herramientas/actualizar.js`.
2. Ese script lee Google Analytics 4 con una cuenta de servicio de **solo lectura** y guarda los totales en `datos/resumen.json`.
3. `index.html` lee ese archivo y dibuja el tablero. No usa librerías externas.

Solo se guardan totales (visitas, páginas, ciudades, botones). No hay datos que identifiquen a ninguna persona.

## Configuración (una sola vez)

En **Settings → Secrets and variables → Actions** del repositorio:

| Tipo | Nombre | Valor |
|---|---|---|
| Secret | `GA_LLAVE_JSON` | El contenido completo del archivo JSON de la llave de la cuenta de servicio |
| Variable | `GA_PROPIEDAD` | El ID numérico de la propiedad GA4 de la web |

La cuenta de servicio tiene que estar agregada como **Lector** en Google Analytics → Administrar → Administración de acceso a la propiedad.

Para correrlo a mano: pestaña **Actions → Actualizar tablero → Run workflow**.

## Actualizar desde la PC

```bash
GA_PROPIEDAD=<id> GA_LLAVE=<ruta-a-la-llave.json> node herramientas/actualizar.js
```

La llave nunca se sube al repositorio (`.gitignore` la bloquea).

## Si una parte dice «Aún sin datos»

Las mediciones de la web (secciones vistas, botones, preguntas frecuentes, scroll) necesitan estar registradas como dimensiones personalizadas en Google Analytics. Desde que se registran, se llenan solas con los días.
