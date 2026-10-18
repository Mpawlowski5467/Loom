from core.capture_review import duplicate_evidence


def test_duplicate_evidence_explains_shared_terms_without_model() -> None:
    matches = duplicate_evidence(
        capture_title="Caching strategy notes",
        capture_body="Cache invalidation and cache keys for the API.",
        notes=[
            ("n1", "Caching strategy", "A note about cache keys."),
            ("n2", "Unrelated", "Gardening journal"),
        ],
    )

    assert [match.note_id for match in matches] == ["n1"]
    assert "caching" in matches[0].rationale.lower()
