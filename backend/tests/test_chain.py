"""Tests for agents/chain.py — Read-Before-Write chain enforcement."""

from pathlib import Path

import yaml

from agents.chain import ReadChain
from core.notes import build_frontmatter


def _setup_vault(tmp_path: Path) -> Path:
    """Create a minimal vault structure for chain testing."""
    root = tmp_path / "vault"
    root.mkdir()

    # vault.yaml
    vault_config = {"name": "test", "custom_folders": [], "auto_git": False}
    (root / "vault.yaml").write_text(yaml.safe_dump(vault_config), encoding="utf-8")

    # rules/prime.md
    rules = root / "rules"
    rules.mkdir()
    (rules / "prime.md").write_text("# Prime\n\nRule 1: Be good.\n", encoding="utf-8")

    # agents/weaver/
    agent_dir = root / "agents" / "weaver"
    agent_dir.mkdir(parents=True)
    (agent_dir / "memory.md").write_text("# Memory\n\nI remember things.\n", encoding="utf-8")
    (agent_dir / "config.yaml").write_text("name: weaver\nenabled: true\n", encoding="utf-8")

    # threads/ with some notes
    topics = root / "threads" / "topics"
    topics.mkdir(parents=True)

    meta_a = {
        "id": "thr_aaa111",
        "title": "Alpha Topic",
        "type": "topic",
        "tags": ["test"],
        "status": "active",
    }
    (topics / "alpha-topic.md").write_text(
        build_frontmatter(meta_a) + "\n## Overview\n\nAlpha content.\n\nSee [[Beta Topic]].\n",
        encoding="utf-8",
    )

    meta_b = {
        "id": "thr_bbb222",
        "title": "Beta Topic",
        "type": "topic",
        "tags": ["test"],
        "status": "active",
    }
    (topics / "beta-topic.md").write_text(
        build_frontmatter(meta_b) + "\n## Overview\n\nBeta content.\n\nLinks to [[Alpha Topic]].\n",
        encoding="utf-8",
    )

    return root


class TestReadChain:
    def test_full_chain_passes(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        chain = ReadChain(root)
        target = root / "threads" / "topics" / "alpha-topic.md"
        result = chain.execute("weaver", target)

        assert result.success
        assert len(result.steps) == 6

        # Step 1: vault.yaml loaded
        assert result.steps[0].loaded
        assert result.vault_config["name"] == "test"

        # Step 2: prime.md loaded
        assert result.steps[1].loaded
        assert "Rule 1" in result.prime_text

        # Step 3: role rules — no weaver.md exists, so not loaded
        assert not result.steps[2].loaded

        # Step 4: memory loaded
        assert result.steps[3].loaded
        assert "I remember things" in result.memory

        # Step 5: no _index.md, so not loaded
        assert not result.steps[4].loaded

        # Step 6: related notes via wikilinks
        assert result.steps[5].loaded
        assert len(result.related_notes) == 1
        assert result.related_notes[0]["title"] == "Beta Topic"

    def test_missing_prime_fails(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        # Delete prime.md
        (root / "rules" / "prime.md").unlink()

        chain = ReadChain(root)
        target = root / "threads" / "topics" / "alpha-topic.md"
        result = chain.execute("weaver", target)

        assert not result.success
        failed = result.failed_required
        assert len(failed) == 1
        assert failed[0].name == "prime.md"

    def test_missing_vault_yaml_fails(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        (root / "vault.yaml").unlink()

        chain = ReadChain(root)
        target = root / "threads" / "topics"
        result = chain.execute("weaver", target)

        assert not result.success
        failed = result.failed_required
        assert len(failed) == 1
        assert failed[0].name == "vault.yaml"

    def test_missing_both_required_fails(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        (root / "vault.yaml").unlink()
        (root / "rules" / "prime.md").unlink()

        chain = ReadChain(root)
        result = chain.execute("weaver", root / "threads" / "topics")

        assert not result.success
        assert len(result.failed_required) == 2

    def test_role_rules_loaded_when_present(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        (root / "rules" / "weaver.md").write_text(
            "# Weaver Rules\n\nCreate notes carefully.\n", encoding="utf-8"
        )

        chain = ReadChain(root)
        target = root / "threads" / "topics"
        result = chain.execute("weaver", target)

        assert result.success
        assert result.steps[2].loaded
        assert "Create notes carefully" in result.role_rules

    def test_folder_index_loaded(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        topics = root / "threads" / "topics"
        (topics / "_index.md").write_text("# Topics Index\n\nAll topics here.\n", encoding="utf-8")

        chain = ReadChain(root)
        target = topics / "alpha-topic.md"
        result = chain.execute("weaver", target)

        assert result.steps[4].loaded
        assert "All topics here" in result.folder_index

    def test_directory_target(self, tmp_path: Path):
        """Chain works when target_path is a directory, not a file."""
        root = _setup_vault(tmp_path)
        chain = ReadChain(root)
        target = root / "threads" / "topics"
        result = chain.execute("weaver", target)

        assert result.success
        # Step 6 doesn't parse wikilinks from a directory
        assert result.related_notes == []

    def test_context_text_concatenation(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        chain = ReadChain(root)
        target = root / "threads" / "topics" / "alpha-topic.md"
        result = chain.execute("weaver", target)

        ctx = result.context_text
        assert "# Constitution" in ctx
        assert "# Agent Memory" in ctx
        assert "# Related: Beta Topic" in ctx

    def test_related_notes_limit(self, tmp_path: Path):
        """At most MAX_RELATED_NOTES (5) related notes are loaded."""
        root = _setup_vault(tmp_path)
        topics = root / "threads" / "topics"

        # Create a note linking to 7 others
        links = []
        for i in range(7):
            title = f"Related {i}"
            meta = {"id": f"thr_r{i:05d}", "title": title, "type": "topic", "tags": [], "status": "active"}
            fname = f"related-{i}.md"
            (topics / fname).write_text(
                build_frontmatter(meta) + f"\nContent of related {i}.\n", encoding="utf-8"
            )
            links.append(f"[[{title}]]")

        hub_meta = {"id": "thr_hub000", "title": "Hub", "type": "topic", "tags": [], "status": "active"}
        body = "## Links\n\n" + "\n".join(links) + "\n"
        (topics / "hub.md").write_text(build_frontmatter(hub_meta) + "\n" + body, encoding="utf-8")

        chain = ReadChain(root)
        result = chain.execute("weaver", topics / "hub.md")

        # Should cap at 5
        assert len(result.related_notes) <= 5

    def test_unknown_agent_graceful(self, tmp_path: Path):
        """Chain works for an agent with no memory.md or rules file."""
        root = _setup_vault(tmp_path)
        chain = ReadChain(root)
        target = root / "threads" / "topics"
        result = chain.execute("nonexistent", target)

        assert result.success  # required steps (vault.yaml, prime.md) still pass
        assert not result.steps[2].loaded  # no role rules
        assert not result.steps[3].loaded  # no memory
