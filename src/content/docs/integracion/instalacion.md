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

### 1.2 Autenticarte e instalar

Necesitás el rol `roles/artifactregistry.reader` sobre el repo (pedilo a
`cloud.infra@transporteshagemsa.com`). Después, en cada `install`:

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

> El token de `gcloud auth print-access-token` dura ~1 hora. Si una instalación
> falla con `401`, regeneralo y reintenta.

### 1.3 En CI / Cloud Run

- **Cloud Build / CI:** exportá `GOOGLE_NPM_TOKEN=$(gcloud auth print-access-token)`
  antes del `pnpm install`. La service account del build necesita
  `roles/artifactregistry.reader`.
- **Runtime (Cloud Run):** la lib se empaqueta en tu imagen Docker durante el
  build; en runtime el contenedor **no** necesita acceso al registry.

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
