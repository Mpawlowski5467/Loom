"""Pydantic models for parsed rule files (schemas, policies, workflows)."""

from pydantic import BaseModel, Field


class SchemaRule(BaseModel):
    """A parsed schema defining the expected structure of a note type.

    Extracted from ``rules/schemas/<type>.md`` files. Contains the required
    and optional frontmatter fields plus expected markdown sections.
    """

    note_type: str
    required_fields: list[str] = Field(default_factory=list)
    optional_fields: list[str] = Field(default_factory=list)
    field_types: dict[str, str] = Field(default_factory=dict)
    sections: list[str] = Field(default_factory=list)
    template: str = ""


class PolicyRule(BaseModel):
    """A parsed behavioral policy that constrains agent actions.

    Extracted from ``rules/policies/<name>.md`` files. Each policy contains
    a list of numbered rules (stored as ``conditions``) that agents must follow.
    """

    name: str
    agent: str | None = None
    action: str = "require"
    conditions: list[str] = Field(default_factory=list)
    description: str = ""


class WorkflowStep(BaseModel):
    """A single step in a multi-agent workflow pipeline.

    Each step assigns an action to a specific agent, optionally depending
    on input from a prior step.
    """

    agent: str
    action: str
    input_from: str | None = None
    conditions: list[str] = Field(default_factory=list)


class WorkflowRule(BaseModel):
    """A parsed multi-step workflow defining an ordered agent pipeline.

    Extracted from ``rules/workflows/<name>.md`` files. Contains a trigger
    condition and an ordered list of agent steps.
    """

    name: str
    trigger: str = ""
    steps: list[WorkflowStep] = Field(default_factory=list)
