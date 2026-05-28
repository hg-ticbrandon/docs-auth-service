---
title: Troubleshooting
description: Problemas comunes en producción y cómo diagnosticarlos.
---

## El servicio no arranca en Cloud Run

**Síntoma:** Cloud Run muestra "Failed to start" o el `startupProbe` falla.

**Diagnóstico:**

1. Ver logs del deploy:
   ```bash
   gcloud run services logs read auth-service --region=us-central1 --limit=100
   ```
2. Buscar errores comunes:
   - `Can't reach database server`: verificar `--add-cloudsql-instances` y la SA tiene `roles/cloudsql.client`.
   - `No se encontraron claves RSA para JWT`: verificar que `JWT_PRIVATE_KEY` y `JWT_PUBLIC_KEY` están como secretos montados.
   - `Cannot find module 'X'`: bug en el Dockerfile, no incluyó un archivo.

## Health check `/health/ready` da 503

**Causas posibles:**

- **DB inalcanzable:** Cloud SQL caído, connection string mal, SA sin permiso.
  ```bash
  gcloud sql instances describe hagemsa-postgresql
  ```
- **RSA keys mal cargadas:** los PEMs en Secret Manager están corruptos o vacíos.
  ```bash
  gcloud secrets versions access latest --secret=jwt-private-key | openssl rsa -check -noout
  ```

## Logins funcionan pero los backends rechazan los JWT

**Síntoma:** `POST /api/auth/login` devuelve un JWT bonito, pero al usarlo en otro backend → 401.

**Posibles causas:**

1. **JWKS apunta a otra URL.** El backend cachea claves de `auth-staging.hagemsa.com` pero el JWT viene de `auth.hagemsa.com`. Verificar `AUTH_JWKS_URL` en el backend.
2. **Issuer/audience mismatch.** El JWT trae `iss: https://auth.hagemsa.com` pero el backend espera `iss: https://auth.hagemsa.local`.
3. **BlacklistChecker fail-closed.** El backend no manda `X-Internal-Secret` → `/api/internal/jti/.../revoked` devuelve 401 → backend rechaza con "Sesión revocada". Ver [errores comunes en integración](/integracion/errores-comunes/#401-sesión-revocada-cuando-el-jwt-recién-emitido).

## "Sesión revocada" para JWTs recién emitidos

Casi siempre es el problema del shared secret entre Auth Service y el backend. Ver guía detallada en [errores comunes](/integracion/errores-comunes/).

## Tabla `sessions.revoked_jtis` crece sin parar

**Causa:** el cron job de cleanup no está corriendo o falla.

**Diagnóstico:**

```bash
# Ver logs del CleanupService
gcloud run services logs read auth-service --region=us-central1 \
  --filter='jsonPayload.context="CleanupService"' --limit=50
```

Si no ves entradas de "Cleanup OK" cada hora, el cron está roto.

**Workaround manual:**

```sql
DELETE FROM sessions.revoked_jtis WHERE expires_at < now();
```

## Login muy lento (> 1s)

**Causas comunes:**

1. **Argon2 con parámetros de memoria muy altos** para el tier de Cloud Run elegido. Si Cloud Run tiene 512MB y Argon2 pide 256MB por verificación, hay contención. Bajar memoria de Argon2 o subir tier de Cloud Run.
2. **DB lejos.** Cloud Run en `us-central1` pero Cloud SQL en otra región → +50ms por query.
3. **Cold start.** Primera request tras min-instances=0 → Cloud Run levanta un nuevo contenedor (~1-3s).

## Cloud SQL: max_connections excedidos

**Síntoma:** `FATAL: sorry, too many clients already` en los logs.

**Diagnóstico:**

```sql
SELECT count(*) FROM pg_stat_activity WHERE datname = 'db_auth_service';
```

**Causas:**

- Conexiones leaked en el código (Prisma debería manejarlo bien, pero verificar).
- Cloud Run con muchas instancias × pool size de Prisma > max_connections de Cloud SQL.

**Solución:**

- Subir `max_connections` en Cloud SQL.
- Bajar `connection_limit` en Prisma (`DATABASE_URL?connection_limit=5`).

## Rotación de claves JWT

Cuando rotás `jwt-private-key`:

1. Subir nueva versión al secret.
2. Redeploy del Auth Service → carga la nueva privada y la nueva pública con un `kid` diferente.
3. El JWKS expone el nuevo `kid`.
4. JWTs viejos siguen verificándose hasta que sus `exp` pasen — pero solo si los backends aún cachean la clave vieja. Si refrescaron el cache, los viejos JWTs fallan inmediatamente.

**Para minimizar disrupción:** rotar fuera de hora pico. Si necesitás zero-downtime, exponer ambas claves en JWKS por una ventana (no implementado aún — TODO).

## Reverir a una versión anterior

```bash
# Listar revisiones
gcloud run revisions list --service=auth-service --region=us-central1

# Apuntar todo el tráfico a una revisión específica
gcloud run services update-traffic auth-service \
  --to-revisions=<revision-id>=100 \
  --region=us-central1
```

## Recursos útiles

- **Logs en vivo:** `gcloud run services logs tail auth-service --region=us-central1`
- **Connectar a Cloud SQL:** ver [Migrations](/operaciones/migrations/)
- **Status page de GCP:** [status.cloud.google.com](https://status.cloud.google.com/)
