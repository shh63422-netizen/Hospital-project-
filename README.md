# Hospital Meter Manager — Render Sync Server

This repository is prepared for deployment as a Render Web Service.

## Render settings

- **Service:** Web Service
- **Runtime:** Node
- **Root Directory:** leave blank (this repository is already server-root)
- **Build Command:** `npm install`
- **Start Command:** `npm start`
- **Plan:** Free

The service exposes:

- `GET /` — status page
- `GET /api/health` — health check
- `POST /api/sync` — two-way sync
- `GET /api/pull` — pull-only sync

Render will provide a URL similar to:

`https://hospital-meter-sync.onrender.com`

Use that **base URL** in the Hospital Meter Manager app's Cloud Server URL setting.

## Authentication

`render.yaml` generates a `SYNC_TOKEN` automatically. The Android app must send the same token if its sync client supports token authentication. Do not publish the generated token in GitHub.

## Important storage note

The current server stores JSON data in its local `DATA_DIR`. Render Free service storage is ephemeral, so this setup is suitable for testing/small deployments but should not be treated as durable database storage. For production data persistence, move storage to a persistent database/object store.
