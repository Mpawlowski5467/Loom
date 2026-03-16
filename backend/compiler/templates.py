"""Template loading and variable substitution for the Prompt Compiler.

Templates are Markdown files with optional YAML frontmatter and
``{{variable}}`` placeholders, stored in ``prompts/<agent>/`` within the vault.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

from core.exceptions import LoomError

if TYPE_CHECKING:
    from pathlib import Path

_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)
_VARIABLE_RE = re.compile(r"\{\{(\w+)\}\}")


class TemplateNotFoundError(LoomError):
    """Raised when a prompt template file cannot be found."""

    def __init__(self, agent_name: str, template_name: str, path: Path) -> None:
        super().__init__(f"Template '{template_name}' for agent '{agent_name}' not found at {path}")
        self.agent_name = agent_name
        self.template_name = template_name


def load_template(
    vault_root: Path,
    agent_name: str,
    template_name: str,
    variables: dict[str, str],
) -> str:
    """Load a prompt template and substitute variables.

    Templates are located at ``{vault_root}/prompts/{agent_name}/{template_name}.md``.
    YAML frontmatter (if present) is stripped from the output. Placeholders
    of the form ``{{key}}`` are replaced with values from *variables*.
    Placeholders with no matching variable are left unchanged.

    Args:
        vault_root: Root directory of the vault.
        agent_name: Name of the agent (e.g. ``"weaver"``).
        template_name: Template filename without extension (e.g. ``"create"``).
        variables: Mapping of placeholder names to replacement values.

    Returns:
        The rendered template string with variables substituted.

    Raises:
        TemplateNotFoundError: If the template file does not exist.
    """
    template_path = vault_root / "prompts" / agent_name / f"{template_name}.md"
    if not template_path.exists():
        raise TemplateNotFoundError(agent_name, template_name, template_path)

    raw = template_path.read_text(encoding="utf-8")
    body = strip_frontmatter(raw)
    return substitute_variables(body, variables)


def strip_frontmatter(text: str) -> str:
    """Remove YAML frontmatter from a template string.

    Args:
        text: Raw template text potentially starting with ``---`` fenced YAML.

    Returns:
        The text with frontmatter removed.
    """
    match = _FRONTMATTER_RE.match(text)
    if match:
        return text[match.end() :]
    return text


def substitute_variables(template: str, variables: dict[str, str]) -> str:
    """Replace ``{{key}}`` placeholders with values from *variables*.

    Placeholders whose keys are not present in *variables* are left as-is
    so that missing substitutions are visible in the output.

    Args:
        template: Template string with ``{{key}}`` placeholders.
        variables: Mapping of placeholder names to values.

    Returns:
        The template with matching placeholders replaced.
    """

    def _replace(match: re.Match[str]) -> str:
        key = match.group(1)
        return variables.get(key, match.group(0))

    return _VARIABLE_RE.sub(_replace, template)
