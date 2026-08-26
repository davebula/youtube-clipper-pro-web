# Render backend

Deploy this folder as a Render Web Service using the Docker runtime.

Environment variables:

- `FRONTEND_ORIGIN`: the exact deployed frontend URL, without a trailing slash
- `MAX_CLIP_SECONDS`: maximum clip length; default `1800`
- `FILE_TTL_SECONDS`: temporary file lifetime; default `3600`

The service exposes `/health`, job creation and polling endpoints, and temporary MP4 downloads.
