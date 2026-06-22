# Security Policy

Loom is **local-first, single-user software**. Its threat model assumes it runs on
a machine you control, reachable only by you. Read this before exposing it to a
network.

## Threat model & supported deployment

- **Supported:** running Loom on `localhost` — `npm run dev` / `uvicorn` during
  development, or `docker compose up` (which binds the published port to
  `127.0.0.1` by default).
- **Not supported:** exposing the API to a LAN or the internet **without** a
  reverse proxy that adds authentication and TLS. The API has **no auth layer**
  of its own.

If you bind the port beyond loopback (e.g. `0.0.0.0:8000` in `docker-compose.yml`,
or a `-p 8000:8000` Docker run), anyone who can reach that address can read,
create, edit, and archive **every note in your vault** and read your provider
configuration. Rate limiting (slowapi) is the only speed bump, and it is not an
access control. Do not do this on an untrusted network.

To expose Loom intentionally, put it behind something like nginx/Caddy/Traefik
with auth + TLS, and only then change the compose port binding.

## Optional API token

For users who do expose the port, an optional shared-token gate adds a single
speed bump. Set the `LOOM_API_TOKEN` environment variable (e.g. in
`docker-compose.yml` or your shell before `uvicorn`):

```bash
export LOOM_API_TOKEN="$(openssl rand -hex 32)"
```

When it is **unset or empty** (the default), behaviour is unchanged — the API
stays open, which is the supported localhost posture. When it is **set**, every
`/api` request other than the `/api/health` and `/api/ready` probes must present
the token, as either header:

```
Authorization: Bearer <token>
X-Loom-Token: <token>
```

A missing or mismatched token gets a `401`; the comparison is constant-time. The
health and readiness probes stay open so container/orchestration checks keep
working.

**This is a speed bump, not access control for untrusted networks.** It is a
single static secret with no rotation, no per-user identity, and no TLS of its
own — anyone who learns the token (or sniffs it off a plaintext connection) has
full access. There is also no login UI: the bundled frontend does not send the
token, so with a token set the SPA only works behind a proxy that injects the
header. Treat it as defense-in-depth *behind* a real reverse proxy with auth +
TLS, never as a replacement for one.

## Known limitations (intentional for v1, documented)

- **No API authentication.** Safe on localhost; unsafe when exposed (see above).
  An optional `LOOM_API_TOKEN` shared-token gate (above) is a speed bump for
  exposed ports, not a real auth layer.
- **Provider API keys are encrypted at rest, but this is defense-in-depth, not
  auth.** Keys in `~/.loom/config.yaml` are encrypted with Fernet (AES-128-CBC +
  HMAC) under a machine-local master key, written with the `enc:v1:` prefix;
  legacy plaintext values are transparently re-encrypted on first load. The
  master key (`~/.loom/.secret.key`) sits next to the data, so this protects
  against casual disclosure of the config file (backups, screen-shares), **not**
  against an attacker who can read the whole `~/.loom` directory. If you use
  Docker, keys may also pass through `.env` (git-ignored) at startup. OS-keychain
  storage is still not implemented.
- **LLM traces record message content.** The trace store (`/api/traces`, mirrored
  to `.loom/traces/`) records the messages and responses sent to providers so you
  can inspect raw calls. Provider keys are sent as HTTP headers and are **not**
  recorded in traces, but note content is — treat the trace store as sensitive.

## Reporting a vulnerability

Loom is an open beta maintained by a solo developer. If you find a security issue,
please open a GitHub issue describing it (omit any secrets), or contact the
maintainer directly. There is no formal SLA, but reports are appreciated and will
be addressed as the project moves toward 1.0.
