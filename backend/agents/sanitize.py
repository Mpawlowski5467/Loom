"""Light prompt-injection hygiene for untrusted note content.

Note bodies can contain arbitrary pasted text — often pulled in from external
research by the Shuttle layer — so any note body placed into an LLM prompt is
untrusted. ``scrub_untrusted`` neutralizes the most common injection patterns.

This is defense-in-depth, not a complete solution: callers should also wrap the
scrubbed text in clearly-labeled delimiters and instruct the model to treat the
contents as data, never as instructions.
"""

from __future__ import annotations

import re

# Strip ASCII control characters (keep tab and newline).
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

# Canonical "ignore the previous instructions" override family. Conservative:
# requires an override verb + a scope word + an instruction noun on one line.
_OVERRIDE = re.compile(
    r"(?im)^[^\n]*\b(?:ignore|disregard|forget|override)\b[^\n]*"
    r"\b(?:previous|above|prior|earlier|all|foregoing|the)\b[^\n]*"
    r"\b(?:instruction|prompt|message|rule|context|system)s?\b[^\n]*$"
)

# Role-spoofing line prefixes that try to impersonate the chat transcript.
_ROLE_SPOOF = re.compile(r"(?im)^\s*(?:system|assistant|developer)\s*:\s*")

_REDACTED = "[removed: possible injected instruction]"


def scrub_untrusted(text: str) -> str:
    """Neutralize common prompt-injection patterns in untrusted text.

    Strips control characters, blanks out override directives, and removes
    role-impersonation prefixes. Normal prose and markdown pass through intact.
    """
    if not text:
        return text
    cleaned = _CONTROL.sub("", text)
    cleaned = _OVERRIDE.sub(_REDACTED, cleaned)
    cleaned = _ROLE_SPOOF.sub("", cleaned)
    return cleaned
