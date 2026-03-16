"""Tests for the rules engine: parsing, validation, and workflow lookup."""

from pathlib import Path

import pytest

from core.defaults import (
    POLICIES,
    SCHEMAS,
    WORKFLOWS,
)
from rules.engine import RulesEngine
from rules.models import PolicyRule, SchemaRule, WorkflowRule
from rules.parser import parse_policy, parse_schema, parse_workflow

# -- Fixtures -----------------------------------------------------------------


@pytest.fixture()
def rules_dir(tmp_path: Path) -> Path:
    """Create a vault rules/ directory populated with default rule files."""
    rules = tmp_path / "rules"
    schemas_dir = rules / "schemas"
    policies_dir = rules / "policies"
    workflows_dir = rules / "workflows"

    schemas_dir.mkdir(parents=True)
    policies_dir.mkdir(parents=True)
    workflows_dir.mkdir(parents=True)

    for filename, content in SCHEMAS.items():
        (schemas_dir / filename).write_text(content)

    for filename, content in POLICIES.items():
        (policies_dir / filename).write_text(content)

    for filename, content in WORKFLOWS.items():
        (workflows_dir / filename).write_text(content)

    return tmp_path


@pytest.fixture()
def engine(rules_dir: Path) -> RulesEngine:
    """Return a loaded RulesEngine backed by default rule files."""
    eng = RulesEngine(rules_dir)
    eng.load()
    return eng


# -- Schema parsing -----------------------------------------------------------


class TestParseSchema:
    """Tests for parse_schema against default schema files."""

    def test_project_schema_fields(self, rules_dir: Path) -> None:
        schema = parse_schema(rules_dir / "rules" / "schemas" / "project.md")
        assert schema.note_type == "project"
        assert "id" in schema.required_fields
        assert "title" in schema.required_fields
        assert "type" in schema.required_fields
        assert "tags" in schema.required_fields
        assert "status" in schema.required_fields

    def test_project_schema_sections(self, rules_dir: Path) -> None:
        schema = parse_schema(rules_dir / "rules" / "schemas" / "project.md")
        section_names = [s.replace("## ", "") for s in schema.sections]
        assert "Overview" in section_names
        assert "Goals" in section_names
        assert "Status" in section_names
        assert "Related" in section_names

    def test_topic_schema_has_expected_sections(self, rules_dir: Path) -> None:
        schema = parse_schema(rules_dir / "rules" / "schemas" / "topic.md")
        assert schema.note_type == "topic"
        section_names = [s.replace("## ", "") for s in schema.sections]
        assert "Summary" in section_names
        assert "Details" in section_names

    def test_capture_schema_has_source_field(self, rules_dir: Path) -> None:
        schema = parse_schema(rules_dir / "rules" / "schemas" / "capture.md")
        assert "source" in schema.required_fields

    def test_daily_schema_type(self, rules_dir: Path) -> None:
        schema = parse_schema(rules_dir / "rules" / "schemas" / "daily.md")
        assert schema.note_type == "daily"

    def test_person_schema_type(self, rules_dir: Path) -> None:
        schema = parse_schema(rules_dir / "rules" / "schemas" / "person.md")
        assert schema.note_type == "person"

    def test_field_types_populated(self, rules_dir: Path) -> None:
        schema = parse_schema(rules_dir / "rules" / "schemas" / "project.md")
        assert schema.field_types.get("tags") == "list"
        assert schema.field_types.get("links") == "list"
        assert schema.field_types.get("history") == "list"

    def test_all_schemas_parse(self, rules_dir: Path) -> None:
        schemas_dir = rules_dir / "rules" / "schemas"
        for path in schemas_dir.glob("*.md"):
            schema = parse_schema(path)
            assert isinstance(schema, SchemaRule)
            assert len(schema.required_fields) > 0

    def test_template_contains_original_text(self, rules_dir: Path) -> None:
        schema = parse_schema(rules_dir / "rules" / "schemas" / "project.md")
        assert "Schema: Project" in schema.template


# -- Policy parsing -----------------------------------------------------------


class TestParsePolicy:
    """Tests for parse_policy against default policy files."""

    def test_linking_policy_name(self, rules_dir: Path) -> None:
        policy = parse_policy(rules_dir / "rules" / "policies" / "linking.md")
        assert policy.name == "Linking"

    def test_linking_policy_conditions(self, rules_dir: Path) -> None:
        policy = parse_policy(rules_dir / "rules" / "policies" / "linking.md")
        assert len(policy.conditions) == 5
        assert any("wikilink" in c.lower() for c in policy.conditions)

    def test_archival_policy_conditions(self, rules_dir: Path) -> None:
        policy = parse_policy(rules_dir / "rules" / "policies" / "archival.md")
        assert policy.name == "Archival"
        assert len(policy.conditions) == 5

    def test_summarization_policy_conditions(self, rules_dir: Path) -> None:
        policy = parse_policy(rules_dir / "rules" / "policies" / "summarization.md")
        assert policy.name == "Summarization"
        assert len(policy.conditions) == 5

    def test_naming_policy_conditions(self, rules_dir: Path) -> None:
        policy = parse_policy(rules_dir / "rules" / "policies" / "naming.md")
        assert policy.name == "Naming"
        assert len(policy.conditions) == 5
        assert any("kebab-case" in c.lower() for c in policy.conditions)

    def test_all_policies_parse(self, rules_dir: Path) -> None:
        policies_dir = rules_dir / "rules" / "policies"
        for path in policies_dir.glob("*.md"):
            policy = parse_policy(path)
            assert isinstance(policy, PolicyRule)
            assert policy.name

    def test_agent_defaults_to_none(self, rules_dir: Path) -> None:
        policy = parse_policy(rules_dir / "rules" / "policies" / "linking.md")
        assert policy.agent is None


# -- Workflow parsing ---------------------------------------------------------


class TestParseWorkflow:
    """Tests for parse_workflow against default workflow files."""

    def test_capture_to_thread_name(self, rules_dir: Path) -> None:
        wf = parse_workflow(rules_dir / "rules" / "workflows" / "capture-to-thread.md")
        assert wf.name == "Capture to Thread"

    def test_capture_to_thread_steps(self, rules_dir: Path) -> None:
        wf = parse_workflow(rules_dir / "rules" / "workflows" / "capture-to-thread.md")
        assert len(wf.steps) == 5
        agents = [s.agent for s in wf.steps]
        assert agents == ["sentinel", "weaver", "spider", "scribe", "archivist"]

    def test_capture_to_thread_trigger(self, rules_dir: Path) -> None:
        wf = parse_workflow(rules_dir / "rules" / "workflows" / "capture-to-thread.md")
        assert "captures" in wf.trigger.lower()

    def test_daily_standup_steps(self, rules_dir: Path) -> None:
        wf = parse_workflow(rules_dir / "rules" / "workflows" / "daily-standup.md")
        assert len(wf.steps) == 5
        agents = [s.agent for s in wf.steps]
        assert "standup" in agents
        assert "weaver" in agents
        assert "spider" in agents

    def test_workflow_step_input_from_chains(self, rules_dir: Path) -> None:
        wf = parse_workflow(rules_dir / "rules" / "workflows" / "capture-to-thread.md")
        assert wf.steps[0].input_from is None
        assert wf.steps[1].input_from == "sentinel"
        assert wf.steps[2].input_from == "weaver"

    def test_all_workflows_parse(self, rules_dir: Path) -> None:
        workflows_dir = rules_dir / "rules" / "workflows"
        for path in workflows_dir.glob("*.md"):
            wf = parse_workflow(path)
            assert isinstance(wf, WorkflowRule)
            assert len(wf.steps) > 0


# -- Engine loading -----------------------------------------------------------


class TestEngineLoad:
    """Tests for RulesEngine.load()."""

    def test_loads_all_schemas(self, engine: RulesEngine) -> None:
        assert len(engine.schemas) == 5
        assert "project" in engine.schemas
        assert "topic" in engine.schemas
        assert "person" in engine.schemas
        assert "daily" in engine.schemas
        assert "capture" in engine.schemas

    def test_loads_all_policies(self, engine: RulesEngine) -> None:
        assert len(engine.policies) == 4
        names = {p.name for p in engine.policies}
        assert names == {"Linking", "Archival", "Summarization", "Naming"}

    def test_loads_all_workflows(self, engine: RulesEngine) -> None:
        assert len(engine.workflows) == 2
        names = {w.name for w in engine.workflows}
        assert names == {"Capture to Thread", "Daily Standup"}

    def test_missing_rules_dir_loads_empty(self, tmp_path: Path) -> None:
        engine = RulesEngine(tmp_path / "nonexistent")
        engine.load()
        assert engine.schemas == {}
        assert engine.policies == []
        assert engine.workflows == []

    def test_partial_rules_dir(self, tmp_path: Path) -> None:
        """Engine loads whatever subdirectories exist, skips missing ones."""
        rules = tmp_path / "rules" / "schemas"
        rules.mkdir(parents=True)
        (rules / "project.md").write_text(SCHEMAS["project.md"])

        engine = RulesEngine(tmp_path)
        engine.load()
        assert "project" in engine.schemas
        assert engine.policies == []
        assert engine.workflows == []


# -- Schema validation -------------------------------------------------------


class TestValidateNote:
    """Tests for RulesEngine.validate_note()."""

    def test_valid_project_note(self, engine: RulesEngine) -> None:
        frontmatter = {
            "id": "thr_abc123",
            "title": "My Project",
            "type": "project",
            "tags": ["test"],
            "created": "2026-01-01T00:00:00Z",
            "modified": "2026-01-01T00:00:00Z",
            "author": "user",
            "status": "active",
            "links": [],
            "history": [],
        }
        violations = engine.validate_note(frontmatter, "project")
        assert violations == []

    def test_missing_required_fields(self, engine: RulesEngine) -> None:
        frontmatter = {"title": "Incomplete"}
        violations = engine.validate_note(frontmatter, "project")
        assert any("id" in v for v in violations)
        assert any("type" in v for v in violations)
        assert any("tags" in v for v in violations)

    def test_null_field_reported(self, engine: RulesEngine) -> None:
        frontmatter = {
            "id": None,
            "title": "Test",
            "type": "project",
            "tags": [],
            "created": "2026-01-01T00:00:00Z",
            "modified": "2026-01-01T00:00:00Z",
            "author": "user",
            "status": "active",
            "links": [],
            "history": [],
        }
        violations = engine.validate_note(frontmatter, "project")
        assert any("null" in v.lower() for v in violations)

    def test_wrong_type_for_list_field(self, engine: RulesEngine) -> None:
        frontmatter = {
            "id": "thr_abc123",
            "title": "Test",
            "type": "project",
            "tags": "not-a-list",
            "created": "2026-01-01T00:00:00Z",
            "modified": "2026-01-01T00:00:00Z",
            "author": "user",
            "status": "active",
            "links": [],
            "history": [],
        }
        violations = engine.validate_note(frontmatter, "project")
        assert any("list" in v.lower() for v in violations)

    def test_unknown_note_type(self, engine: RulesEngine) -> None:
        violations = engine.validate_note({}, "nonexistent")
        assert len(violations) == 1
        assert "no schema" in violations[0].lower()

    def test_capture_requires_source(self, engine: RulesEngine) -> None:
        frontmatter = {
            "id": "thr_abc123",
            "title": "Test Capture",
            "type": "capture",
            "tags": [],
            "created": "2026-01-01T00:00:00Z",
            "modified": "2026-01-01T00:00:00Z",
            "author": "user",
            "status": "active",
            "links": [],
            "history": [],
        }
        violations = engine.validate_note(frontmatter, "capture")
        assert any("source" in v for v in violations)

    def test_valid_capture_note(self, engine: RulesEngine) -> None:
        frontmatter = {
            "id": "thr_abc123",
            "title": "Test Capture",
            "type": "capture",
            "tags": [],
            "created": "2026-01-01T00:00:00Z",
            "modified": "2026-01-01T00:00:00Z",
            "author": "user",
            "source": "manual",
            "status": "active",
            "links": [],
            "history": [],
        }
        violations = engine.validate_note(frontmatter, "capture")
        assert violations == []


# -- Policy checking ----------------------------------------------------------


class TestCheckPolicy:
    """Tests for RulesEngine.check_policy()."""

    def test_allowed_by_default(self, engine: RulesEngine) -> None:
        assert engine.check_policy("weaver", "create", {}) is True

    def test_action_matching_policy_allowed(self, engine: RulesEngine) -> None:
        # "link" appears in the linking policy conditions.
        assert engine.check_policy("spider", "link", {}) is True

    def test_no_policies_allows_everything(self, tmp_path: Path) -> None:
        engine = RulesEngine(tmp_path)
        engine.load()
        assert engine.check_policy("any_agent", "any_action", {}) is True

    def test_deny_policy_blocks(self) -> None:
        """A policy with action='deny' should block matching actions."""
        engine = RulesEngine(Path("/unused"))
        engine.policies = [
            PolicyRule(
                name="test-deny",
                action="deny",
                conditions=["delete files permanently"],
            ),
        ]
        assert engine.check_policy("weaver", "delete", {}) is False

    def test_deny_does_not_block_unrelated_action(self) -> None:
        engine = RulesEngine(Path("/unused"))
        engine.policies = [
            PolicyRule(
                name="test-deny",
                action="deny",
                conditions=["delete files permanently"],
            ),
        ]
        assert engine.check_policy("weaver", "create", {}) is True


# -- Workflow lookup ----------------------------------------------------------


class TestGetWorkflow:
    """Tests for RulesEngine.get_workflow()."""

    def test_find_capture_workflow(self, engine: RulesEngine) -> None:
        wf = engine.get_workflow("captures")
        assert wf is not None
        assert wf.name == "Capture to Thread"

    def test_find_by_partial_trigger(self, engine: RulesEngine) -> None:
        wf = engine.get_workflow("new file appears")
        assert wf is not None
        assert wf.name == "Capture to Thread"

    def test_case_insensitive_trigger(self, engine: RulesEngine) -> None:
        wf = engine.get_workflow("CAPTURES")
        assert wf is not None

    def test_no_match_returns_none(self, engine: RulesEngine) -> None:
        assert engine.get_workflow("nonexistent trigger") is None

    def test_find_daily_standup_workflow(self, engine: RulesEngine) -> None:
        wf = engine.get_workflow("end of day")
        assert wf is not None
        assert wf.name == "Daily Standup"

    def test_manual_trigger_matches_standup(self, engine: RulesEngine) -> None:
        wf = engine.get_workflow("manual user request")
        assert wf is not None
        # Both workflows have "Manual user request" — first match wins.
        assert wf.name in {"Capture to Thread", "Daily Standup"}
