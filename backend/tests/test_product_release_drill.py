"""Regression coverage for the provider-free real-backend release drill."""

from scripts.product_release_drill import run_drill


def test_product_release_drill() -> None:
    report = run_drill()

    assert report["passed"] is True
    assert report["failed_status"] == "failed"
    assert report["retry_status"] == "queued"
    assert report["archive_bytes"] > 0
    assert report["rollback_preserved_capture"] is True
    assert report["restored_capture_present"] is True
    assert report["restored_jobs_clean"] is True
