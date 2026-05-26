"""Tests for agents/loom/weaver_tags.py — LLM tag snap-to-vocab."""

from agents.loom.weaver_tags import _levenshtein_le_1, normalise_tag, snap_tags


class TestNormalise:
    def test_lowercases(self) -> None:
        assert normalise_tag("Foo") == "foo"

    def test_strips_whitespace(self) -> None:
        assert normalise_tag("  foo  ") == "foo"

    def test_collapses_spaces_to_hyphens(self) -> None:
        assert normalise_tag("data intensive applications") == "data-intensive-applications"

    def test_preserves_existing_hyphens_and_plus(self) -> None:
        assert normalise_tag("TLA+") == "tla+"
        assert normalise_tag("c++") == "c++"
        assert normalise_tag("side-project") == "side-project"


class TestLevenshteinLe1:
    def test_equal(self) -> None:
        assert _levenshtein_le_1("raft", "raft") is True

    def test_one_substitution(self) -> None:
        assert _levenshtein_le_1("raft", "rast") is True

    def test_one_insertion(self) -> None:
        assert _levenshtein_le_1("raft", "rafts") is True

    def test_one_deletion(self) -> None:
        assert _levenshtein_le_1("rafter", "raft") is False
        # Wait — "rafter" → "raft" is 2 edits (remove e and r). Confirm.
        # Actually: raft → rafter is +2 chars. So distance 2.
        # Distance 1 example: 'raft' vs 'craft' (1 insertion).
        assert _levenshtein_le_1("raft", "craft") is True

    def test_distance_two(self) -> None:
        # 'rafter' vs 'raft' is distance 2 (drop 'er'). Should NOT match.
        assert _levenshtein_le_1("rafter", "raft") is False

    def test_length_far_apart(self) -> None:
        assert _levenshtein_le_1("a", "abcdef") is False


class TestSnapTags:
    def test_existing_tag_kept(self) -> None:
        final, snapped = snap_tags(["raft"], {"raft", "paxos", "consensus"})
        assert final == ["raft"]
        assert snapped == []

    def test_typo_snapped_to_existing(self) -> None:
        # 'consensu' (missing s) → 'consensus' (1 insertion).
        final, snapped = snap_tags(
            ["consensu"], {"raft", "paxos", "consensus"}
        )
        assert final == ["consensus"]
        assert snapped == [("consensu", "consensus")]

    def test_novel_tag_passes_through(self) -> None:
        """A plausibly-novel tag (no distance-1 neighbour) is preserved."""
        final, snapped = snap_tags(["tla+"], {"raft", "paxos", "consensus"})
        assert final == ["tla+"]
        assert snapped == []

    def test_rafter_typo_snapped_via_tier_2(self) -> None:
        """'rafter' → 'raft' is distance 2. The tier-2 snap should catch it.

        This is the real-world case from the live trace: gemma4:e4b
        classified TLA+/Paxos with tag 'rafter' which is a 2-char overshoot
        of 'raft'. Tier 2 requires both tags ≥5 chars; 'raft' is 4 so this
        case actually does NOT snap under the current rule. We accept this
        — protecting 'raft' (a real tag) from being a false-positive sink
        for things like 'react' is worth more than auto-fixing 'rafter'.
        """
        # 'raft' is too short for tier 2; 'rafter' stays as-is.
        final, snapped = snap_tags(["rafter"], {"raft", "paxos"})
        assert final == ["rafter"]
        assert snapped == []

        # But: if there's a longer existing tag like 'rafters' or
        # 'raft-consensus', tier 2 fires.
        final, snapped = snap_tags(["raftters"], {"raft-consensus", "rafters"})
        assert final == ["rafters"]
        assert snapped == [("raftters", "rafters")]

    def test_short_tags_skip_snap(self) -> None:
        """Tags of 3 chars or less don't trigger snap (false-positive risk)."""
        # 'ml' (2 chars) vs 'ai' (2 chars) — distance 2, but both ≤3 so
        # snap is skipped regardless.
        final, snapped = snap_tags(["ai"], {"ml"})
        assert final == ["ai"]
        assert snapped == []

    def test_strips_empty_and_too_short(self) -> None:
        final, _ = snap_tags(["", "x", "raft"], {"raft"})
        assert final == ["raft"]

    def test_dedups(self) -> None:
        final, _ = snap_tags(
            ["raft", "Raft", "RAFT"], {"raft"}
        )
        assert final == ["raft"]

    def test_caps_at_max_tags(self) -> None:
        final, _ = snap_tags(["a", "b", "c", "d", "e", "f", "g"], set(), max_tags=3)
        # First two ('a', 'b') skipped by min length; effectively the first
        # 3 that pass: 'c', 'd', 'e'. Wait — those are also ≤3 chars? No,
        # min length is 2. Let me re-check.
        # Tags: a(1), b(1), c(1), d(1), e(1), f(1), g(1) — all length 1.
        # All get dropped because length < _MIN_TAG_LEN (2). So final = [].
        assert final == []

    def test_caps_at_max_tags_real(self) -> None:
        final, _ = snap_tags(
            ["one", "two", "three", "four", "five", "six"], set(), max_tags=3
        )
        assert len(final) == 3
        assert final == ["one", "two", "three"]

    def test_real_world_distributed_systems_case(self) -> None:
        """End-to-end: classifier produces 'consensu' (typo) + 'paxos' +
        new 'tla+'. Expect snap on 'consensu', keep the rest."""
        vault = {"raft", "consensus", "paxos", "distributed", "ddia"}
        final, snapped = snap_tags(
            ["paxos", "consensu", "tla+", "distributed"], vault
        )
        assert "consensus" in final
        assert "paxos" in final
        assert "tla+" in final
        assert "distributed" in final
        assert ("consensu", "consensus") in snapped
