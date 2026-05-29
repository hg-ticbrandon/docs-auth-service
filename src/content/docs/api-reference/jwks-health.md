---
title: JWKS y health
description: Endpoints públicos para descubrimiento de claves y probes de salud.
---

## GET /.well-known/jwks.json

Expone las claves públicas con las que el Auth Service firma los JWTs. Acceso público (sin autenticación).

**Response 200:**

```json
{
  "keys": [
    {
      "kty": "RSA",
      "kid": "a1b2c3d4e5f6g7h8",
      "use": "sig",
      "alg": "RS256",
      "n": "<modulus-base64url>",
      "e": "AQAB"
    }
  ]
}
```

**Cómo se usa:**

- Cualquier backend cachea esta respuesta (24h recomendado) y verifica firmas localmente.
- El `kid` (key ID) se deriva del SHA-256 de la clave pública. Cuando el Auth Service rota claves, el `kid` cambia automáticamente.
- La lib `@hagemsa/auth-guard` refresca el cache al detectar cache miss para un `kid` nuevo.

## GET /health

Liveness probe — responde 200 si el proceso está vivo. **No consulta DB ni dependencias externas**, por lo que es seguro para `livenessProbe` de Kubernetes/Cloud Run.

**Response 200:**

```json
{ "status": "ok", "uptime": 254.49 }
```

## GET /health/ready

Readiness probe — responde 200 solo si el servicio puede procesar requests (DB conectada, claves RSA cargadas).

**Response 200:**

```json
{
  "status": "ok",
  "checks": {
    "db": { "ok": true },
    "rsaKeys": { "ok": true }
  }
}
```

**Response 503** (si algo falla):

```json
{
  "status": "error",
  "checks": {
    "db": { "ok": false, "detail": "connection refused" },
    "rsaKeys": { "ok": true }
  }
}
```

**Cómo se usa:**

- `startupProbe` y `readinessProbe` de Cloud Run apuntan acá.
- Cloud Run no enruta tráfico hasta que `/health/ready` responde 200.

## GET /health/info

Diagnóstico sanitizado del runtime. Útil para verificar config en producción sin SSH.

**Response 200:**

```json
{
  "version": "0.1.0",
  "config": {
    "logFormat": "json",
    "swaggerEnabled": true,
    "internalSecretConfigured": true,
    "sendgridConfigured": true,
    "jwtIssuer": "https://auth.hagemsa.com",
    "jwtAccessTtlSeconds": 3600
  }
}
```

**Lo que NO se expone:** secrets, API keys, passwords, connection strings. Solo flags booleanos del tipo `<name>Configured`.

## GET /docs

Swagger UI con todos los endpoints. Disponible si `SWAGGER_ENABLED !== 'false'`.

## GET /docs-json

Spec OpenAPI 3.x en JSON. Útil para generar SDKs o importar a Postman/Insomnia.
