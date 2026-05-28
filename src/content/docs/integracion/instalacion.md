---
title: Instalación
description: Instalar la librería @hagemsa/auth-guard en tu backend.
---

## 1. Instalar la lib

```bash
pnpm add @hagemsa/auth-guard
```

La lib se publica al **Artifact Registry interno** de HAGEMSA. Para acceso:

1. Configurá `~/.npmrc` o `~/.config/pnpm/rc` con el registry interno.
2. Autenticate con `gcloud auth configure-docker` (o el método que use el equipo de plataforma).
3. Pedile al equipo de auth (`cloud.infra@transporteshagemsa.com`) que te dé acceso de lectura al repo `npm/hagemsa` en GCP.

## 2. Variables de entorno

Agregá a tu `.env`:

```bash
# URL del JWKS del Auth Service
AUTH_JWKS_URL=https://auth.hagemsa.com/.well-known/jwks.json

# Issuer y audience que esperás en los JWTs
AUTH_ISSUER=https://auth.hagemsa.com
AUTH_AUDIENCE=hagemsa-backends

# URL base del Auth Service (para consultar /api/internal/*)
AUTH_BASE_URL=https://auth.hagemsa.com

# Shared secret para llamadas a /api/internal/*
# Pedilo al equipo de plataforma. NUNCA hardcodearlo, va a Secret Manager.
AUTH_INTERNAL_SECRET=<secreto-compartido>
```

En **producción** todas estas vienen de **Secret Manager** (GCP), no de un `.env` plano.

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
