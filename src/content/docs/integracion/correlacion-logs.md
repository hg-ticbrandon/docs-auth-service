---
title: Correlacionar logs entre servicios
description: Qué tiene que hacer tu backend para que el trazaId conecte los logs de todos los servicios que atienden una misma acción del usuario.
---

Todos los backends del ecosistema devuelven un `trazaId` en sus respuestas de error, y la [convención del contrato](/api-reference/convenciones/) dice que sirve para correlacionar logs entre microservicios.

**Eso no pasa solo.** El campo existe en todos los servicios; la correlación existe únicamente si cada uno propaga el id. Esta página dice qué le toca a tu backend.

## El problema, con números

Verificado el 2026-08-17 sobre los cinco backends `bc*`:

- Los cinco declaran `trazaId` en su contrato de errores.
- **Ninguno leía el header entrante ni lo propagaba en sus llamadas salientes.**
- Uno de ellos generaba un id nuevo **en cada excepción**, así que no correlacionaba ni las líneas de una misma request.

Resultado: una acción del usuario que pasa por el frontend, por tu backend y por el Auth Service produce **tres ids distintos**, y no hay forma de saber que eran la misma acción. Rastrear un error reportado por un usuario a través de dos servicios era imposible.

No fue descuido de cinco equipos: esta documentación describía la capacidad del Auth Service y nunca decía qué parte le tocaba al consumidor. Esta página existe para cerrar eso.

## Las tres cosas que tiene que hacer tu backend

### 1. Leer el id de la request entrante y guardarlo

Un middleware que corre antes que todo lo demás, y que deja el id en un `AsyncLocalStorage` para que el resto del servicio lo lea sin pasarlo por parámetro.

El orden de preferencia es el mismo que usa el Auth Service:

1. **`X-Request-Id`**, si viene y tiene formato aceptable. Se valida (entre 8 y 128 caracteres, solo alfanuméricos, `-`, `_` y `:`) porque el valor termina escrito en los logs y en respuestas HTTP: aceptar cualquier cosa abre log-injection.
2. **`X-Cloud-Trace-Context`**, que Cloud Run pone en **toda** request entrante. Es la fuente que hace que haya correlación aunque el llamador no propague nada explícito. El formato es `TRACE_ID/SPAN_ID;o=1`, donde `TRACE_ID` son 32 caracteres hexadecimales.
3. Un UUID nuevo, que es el caso de desarrollo local.

:::tip[Por qué conviene preferir el id de Cloud Trace antes que generar uno propio]
Cuando el id **es** un trace id de Cloud Trace, tu logger puede emitir el campo `logging.googleapis.com/trace` con el valor `projects/<proyecto>/traces/<trace-id>`, y entonces **Cloud Logging agrupa solo las líneas de todos los servicios de esa traza** y ofrece el enlace al visor de trazas.

Con un UUID inventado hay que buscar a mano por substring. Una advertencia: emite ese campo **solo** cuando el id tiene formato de trace id (32 hex minúscula). Con un UUID propio, Cloud Logging enlaza a una traza inexistente y el enlace del visor queda roto.
:::

:::caution[Que el middleware corra antes del body parser importa]
Si lo registras como middleware de módulo (`consumer.apply(...).forRoutes(...)`), Nest lo liga en `registerModules()`, que corre **después** del body parser. Consecuencia: una request con el JSON malformado se atiende **fuera** del contexto, y su respuesta sale sin `X-Request-Id` y con el `trazaId` vacío — justo el tipo de error que alguien va a querer rastrear.

Registrarlo con `app.use(...)` en el `main.ts`, antes de los pipes y los guards, cubre eso y además los paths que no matchean ninguna ruta.
:::

### 2. Usar ese id en tu filtro de excepciones

Tu contrato de errores tiene un `trazaId`. Tómalo del contexto en vez de generarlo:

```ts
// Antes: un id nuevo por excepción, que no correlaciona nada.
const trazaId = randomBytes(16).toString('hex');

// Después: el id de la request.
const trazaId = contextoCorrelacion.get()?.correlationId ?? 'sin-traza';
```

Y devuélvelo también en el header `X-Request-Id` de la response, para que quien reporte un problema pueda copiarlo de la pestaña de red del navegador.

### 3. Propagar el header en tus llamadas salientes

Cada llamada de tu backend a **otro servicio del ecosistema** lleva el header:

```ts
headers['X-Request-Id'] = contextoCorrelacion.get()?.correlationId
```

Sin esto la propagación entra a tu servicio y muere ahí, que es la mitad del problema.

:::danger[No lo mandes a terceros]
El id se propaga **solo dentro del ecosistema**. No lo agregues a las llamadas a SAP, Gotenberg, GCS, APIs de proveedores ni nada externo: es un identificador interno de correlación y filtrarlo a sistemas de terceros es peor que no correlacionar.

Por eso el header se agrega explícitamente en cada gateway y no de forma automática. Parchear el `fetch` global lo mandaría a todos lados.
:::

### Cuando no hay request en curso

El relay de un outbox, un cron o el consumidor de una suscripción de Pub/Sub corren sin contexto HTTP. Ahí **no agregues el header** en vez de inventar un id: uno que no correlaciona con nada es peor que su ausencia, porque parece que sí.

## Qué NO cambia en tu servicio

- **El contrato de tus endpoints.** El header extra es inerte para quien lo recibe: el `forbidNonWhitelisted` del `ValidationPipe` valida body, query y params, no headers.
- **CORS.** Las llamadas entre backends son servidor a servidor, sin preflight.
- **El formato de tu `trazaId`** puede cambiar de un UUID con guiones a 32 caracteres hexadecimales, según de dónde salga el id. El contrato lo declara como string sin restricción de formato; si tu código lo valida con un regex de UUID, ese regex hay que sacarlo.

## Lo que viene

Hoy esto se implementa a mano en cada servicio. Está planeado mover el store, el resolver y el middleware a `@hagemsa/auth-guard`, para que la parte de entrada quede en cero líneas —el módulo la registra solo— y a tu servicio le queden únicamente los puntos 2 y 3, que son los que dependen de tu contrato de errores y de tus gateways.

Cuando esa versión exista, va a estar en [Versiones de @hagemsa/auth-guard](/versiones/auth-guard/). Mientras tanto, lo de esta página es lo que hay que escribir.
