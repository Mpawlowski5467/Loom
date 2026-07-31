"""Shared helpers for the OAuth calendar bridge routers (Google, Outlook).

The two routers run identical localhost authorization-code flows against
different providers; the HTML result page and the loopback-only redirect-URI
construction live here so the security-sensitive parts exist exactly once.
"""

from __future__ import annotations

from fastapi import Request
from fastapi.responses import HTMLResponse

from bridge.oauth import is_loopback_host


def loopback_redirect_uri(request: Request, route_name: str) -> str:
    """Build the registered OAuth callback from the trusted loopback request only."""
    if request.url.scheme not in {"http", "https"} or not is_loopback_host(request.url.hostname):
        raise ValueError("OAuth linking is available only from a loopback Loom URL.")
    return str(request.url_for(route_name))


def oauth_result_page(provider: str, *, success: bool, error_status: int = 400) -> HTMLResponse:
    """Return a constant, non-cacheable page with no OAuth material in it."""
    if success:
        title = f"{provider} connected"
        message = "The connection is ready. You can close this window and return to Loom."
        status_code = 200
    else:
        title = f"{provider} connection failed"
        message = "No credentials were saved. Close this window and try again from Loom."
        status_code = error_status

    html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>{title}</title>
</head>
<body>
  <main>
    <h1>{title}</h1>
    <p>{message}</p>
  </main>
</body>
</html>"""
    return HTMLResponse(
        html,
        status_code=status_code,
        headers={
            "Cache-Control": "no-store",
            "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        },
    )
