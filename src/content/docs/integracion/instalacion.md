---
title: Instalación
description: Instalar la librería @hagemsa/auth-guard en tu backend.
---

La lib `@hagemsa/auth-guard` se publica al **Artifact Registry interno** de HAGEMSA
(repo npm `hagemsa-npm` en `us-central1`, proyecto `hagemsa-cloud`). No está en
npm público.

### 1.1 Configurar el registry en tu proyecto

Creá un `.npmrc` **en la raíz de tu backend** (no en `~`, así queda versionado y
todo el equipo lo comparte):

```ini
@hagemsa:registry=https://us-central1-npm.pkg.dev/hagemsa-cloud/hagemsa-npm/
//us-central1-npm.pkg.dev/hagemsa-cloud/hagemsa-npm/:_authToken=${GOOGLE_NPM_TOKEN}
//us-central1-npm.pkg.dev/hagemsa-cloud/hagemsa-npm/:always-auth=true
```

El token **no** se hardcodea: se inyecta vía la variable de entorno
`GOOGLE_NPM_TOKEN`, que pnpm expande al instalar. Esto evita commitear secretos.

### 1.2 De dónde sale `GOOGLE_NPM_TOKEN`

`GOOGLE_NPM_TOKEN` **no es un secreto fijo que alguien te pasa**: es un token
OAuth de **corta vida (~1 hora)** que generás vos mismo con el CLI de Google
Cloud (`gcloud`), a partir de tu propia identidad de GCP. Cada vez que vas a
instalar, lo regenerás con `gcloud auth print-access-token`.

**Pasos para poder generarlo (una sola vez):**

1. **Instalá el CLI de gcloud** (Google Cloud SDK):
   <https://cloud.google.com/sdk/docs/install>. Verificá con `gcloud --version`.

2. **Autenticate** con tu cuenta corporativa de Google:

   ```bash
   gcloud auth login
   ```

   Esto abre el navegador. Logueate con la cuenta de HAGEMSA que tenga acceso al
   proyecto. (Usá `gcloud auth login`, **no** `gcloud auth application-default
   login` — este último puede estar bloqueado por política de Workspace.)

3. **Seleccioná el proyecto:**

   ```bash
   gcloud config set project hagemsa-cloud
   ```

4. **Pedí acceso de lectura al registry.** Tu cuenta necesita el rol
   `roles/artifactregistry.reader` sobre el repo `hagemsa-npm` (o el proyecto
   `hagemsa-cloud`). Solicitalo al equipo de plataforma
   (`cloud.infra@transporteshagemsa.com`) indicando tu email de GCP.

Una vez hecho esto, **`gcloud auth print-access-token` imprime el token** que la
lib usa. Para confirmar que funciona:

```bash
gcloud auth print-access-token
# Debe imprimir una cadena larga (ya29....). Si pide login, repetí el paso 2.
```

### 1.3 Autenticarte e instalar

En cada `install`, generá el token y exportalo a `GOOGLE_NPM_TOKEN` justo antes:

```powershell
# Windows / PowerShell
$env:GOOGLE_NPM_TOKEN = (gcloud auth print-access-token)
pnpm add @hagemsa/auth-guard
```

```bash
# Linux / macOS
export GOOGLE_NPM_TOKEN="$(gcloud auth print-access-token)"
pnpm add @hagemsa/auth-guard
```

**Cómo funciona esa línea (no hay magia):** es un solo comando que hace dos cosas:

1. `gcloud auth print-access-token` se ejecuta primero y **genera e imprime** un
   token OAuth nuevo.
2. `$env:GOOGLE_NPM_TOKEN = (...)` (PowerShell) / `export GOOGLE_NPM_TOKEN="$(...)"`
   (bash) **captura** esa salida y la guarda en la variable de entorno
   `GOOGLE_NPM_TOKEN`.

Luego, cuando corrés `pnpm`, este lee tu `.npmrc`, encuentra `${GOOGLE_NPM_TOKEN}`
y lo reemplaza por el valor de esa variable para autenticarse contra el registry.

Puntos importantes:

- La variable vive **solo en esa terminal** (sesión actual). **No** se guarda en
  el sistema ni en ningún archivo. Si cerrás la terminal o abrís otra, la variable
  desaparece y tenés que volver a ejecutar la línea.
- No necesitás crear la variable "a mano" ni guardarla en ningún lado: la línea la
  crea (o sobrescribe) en el momento.
- Si querés ver el valor: en PowerShell `echo $env:GOOGLE_NPM_TOKEN`, en bash
  `echo $GOOGLE_NPM_TOKEN` (debería empezar con `ya29.`).

Para instalaciones posteriores (cuando la lib ya está en tu `package.json`) es el
mismo patrón en una terminal nueva: ejecutás la línea que setea el token y después
`pnpm install`.

> El token dura ~1 hora. Si un `install` falla con `401 Unauthorized`,
> regeneralo (`gcloud auth print-access-token`) y reintentá. No hace falta
> volver a hacer `gcloud auth login` salvo que la sesión de gcloud haya expirado.

:::tip[El token es SOLO para instalar/actualizar — no para producción]
Que el token dure 1 hora **no afecta a tu backend en producción**. El
`GOOGLE_NPM_TOKEN` se usa **únicamente** en el momento de **descargar el
paquete** desde Artifact Registry, es decir cuando corrés `pnpm add` /
`pnpm install` (al agregar la lib o al actualizar su versión).

Una vez instalada, `@hagemsa/auth-guard` es **código en `node_modules`** que se
**empaqueta dentro de tu imagen Docker** durante el build. En **runtime** el
contenedor solo ejecuta ese código ya descargado: **no vuelve a contactar al
registry ni necesita ningún token**.

En runtime la lib solo hace una llamada de red: descargar el **JWKS público**
del Auth Service (`/.well-known/jwks.json`) para verificar firmas — y eso **no
lleva autenticación** (es un endpoint público). Por eso un backend puede correr
semanas sin que el token de 1 hora tenga ninguna relevancia: ya cumplió su
función en el `pnpm install` del build.

**En resumen:**
- `pnpm install` (build / actualizar lib) → **sí** necesita el token (vive segundos).
- Backend corriendo en producción → **no** necesita el token nunca.
:::

### 1.4 En CI / Cloud Run

- **Cloud Build / CI:** exportá `GOOGLE_NPM_TOKEN=$(gcloud auth print-access-token)`
  antes del `pnpm install`. Ahí no hay `gcloud auth login` interactivo: el build
  corre con su **service account**, que ya está autenticada — solo necesita el rol
  `roles/artifactregistry.reader`. El mismo `gcloud auth print-access-token` toma
  la identidad de esa service account.
- **Runtime (Cloud Run):** la lib ya viene empaquetada en tu imagen Docker desde
  el build, así que el contenedor en ejecución **no** necesita el token ni acceso
  al registry. El flujo completo en prod es: Cloud Build usa el token (de su
  service account) para `pnpm install` → compila la imagen con la lib adentro →
  Cloud Run corre esa imagen. El token se consumió en el paso de build; el
  contenedor en producción nunca lo ve.

## 2. Variables de entorno

Agregá a tu `.env`:

```bash
# --- Mínimo: validar JWT + permisos + scopes ---
# URL del JWKS del Auth Service.
AUTH_JWKS_URL=https://auth.hagemsa.com/.well-known/jwks.json
# Issuer y audience que esperás en los JWT (deben coincidir EXACTO con lo que emite el Auth Service).
AUTH_JWT_ISSUER=https://auth.hagemsa.com
AUTH_JWT_AUDIENCE=hagemsa-backends

# --- Solo si activás blacklist (logout instantáneo) ---
# URL base del Auth Service (para consultar /api/internal/*).
AUTH_SERVICE_URL=https://auth.hagemsa.com
# Shared secret para /api/internal/*. Pedilo al equipo de plataforma.
# NUNCA hardcodearlo: va a Secret Manager.
AUTH_INTERNAL_SECRET=<secreto-compartido>
```

> Con las **tres primeras** alcanza para autorizar (los permisos y scopes vienen
> embebidos en el JWT). `AUTH_SERVICE_URL` y `AUTH_INTERNAL_SECRET` solo hacen
> falta si activás `enableBlacklistCheck`. Los nombres de las variables son tuyos
> —vos las mapeás a la config de la lib en `app.module.ts`—; acá usamos estos por
> consistencia con el resto de la doc.

En **producción** los secretos vienen de **Secret Manager** (GCP), no de un `.env` plano.

## 3. Verificar conectividad

Antes de cablear el módulo, validá manualmente que tu backend alcanza al Auth Service:

```bash
# El JWKS debe responder 200 con un objeto { keys: [...] }
curl https://auth.hagemsa.com/.well-known/jwks.json

# El health del Auth Service debe responder 200
curl https://auth.hagemsa.com/health
```

Si esos dos endpoints no responden desde tu entorno, hay un problema de red/firewall que resolver antes.

## Próximo paso

[Configurar el módulo →](/integracion/configuracion/)
