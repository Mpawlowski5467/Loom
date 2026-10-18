"""Refuse state-changing requests sent from other sites (CSRF defense).

The local API has no auth by design. A page on any other site can still make
the user's browser send "simple" requests to it (a POST with a ``text/plain``
body, or no body at all) without a CORS preflight. CORS only stops that page
from *reading* the reply; the server still acts on it. Unchecked, any website
the user visits could overwrite or archive a vault.

Browsers always send ``Origin`` on cross-origin POST/PUT/PATCH/DELETE. Such a
request is refused unless its origin is the API's own (the bundled SPA) or a
configured ``LOOM_CORS_ORIGINS`` entry (the Vite dev server). Requests with no
``Origin`` (curl, scripts, tests) pass, unless the browser marks them
cross-site through ``Sec-Fetch-Site``. Reads are left to CORS.
"""

from __future__ import annotations

from urllib.parse import urlsplit

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import RequestResponseEndpoint

from core.config import settings

_UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


def is_cross_site_write(request: Request) -> bool:
    """Whether ``request`` is a state-changing call from an untrusted origin."""
    if request.method not in _UNSAFE_METHODS:
        return False
    origin = request.headers.get("origin")
    if origin is None:
        return request.headers.get("sec-fetch-site") == "cross-site"
    allowed = settings.cors_origins
    if "*" in allowed or origin in allowed:
        return False
    # Same-origin: the SPA served by this app, reached on whatever host/port
    # TrustedHostMiddleware accepted. "null" (sandboxed frames, file://) has
    # no netloc, so it never matches.
    host = request.headers.get("host", "").lower()
    return not host or urlsplit(origin).netloc.lower() != host


async def reject_cross_site_writes(
    request: Request, call_next: RequestResponseEndpoint
) -> Response:
    """Middleware: answer 403 to cross-site state-changing requests."""
    if is_cross_site_write(request):
        return JSONResponse(
            status_code=403,
            content={
                "error": "Cross-site request refused. Add the calling page's origin "
                "to LOOM_CORS_ORIGINS if it should be allowed.",
                "type": "Forbidden",
            },
        )
    return await call_next(request)
