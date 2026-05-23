"""Tests for the custom-agent registry routes."""

from starlette.testclient import TestClient


def _init_vault(client: TestClient) -> None:
    client.post("/api/vaults", json={"name": "test"})


def test_list_includes_system_agents(client: TestClient) -> None:
    _init_vault(client)
    resp = client.get("/api/agents/registry")
    assert resp.status_code == 200
    data = resp.json()
    ids = {a["id"] for a in data}
    # The 5 Loom + 2 Shuttle system agents are present.
    assert {"weaver", "spider", "archivist", "scribe", "sentinel"} <= ids
    assert {"researcher", "standup"} <= ids
    for a in data:
        assert a["system"] is True


def test_create_custom(client: TestClient) -> None:
    _init_vault(client)
    resp = client.post(
        "/api/agents/registry",
        json={
            "name": "Planner",
            "role": "plans my week",
            "icon": "🗓",
            "system_prompt": "You are a planner.",
        },
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["system"] is False
    assert data["name"] == "Planner"
    assert data["id"] == "planner"


def test_create_collides_with_system(client: TestClient) -> None:
    _init_vault(client)
    # Naming a custom agent "weaver" should still succeed but with a suffix.
    resp = client.post("/api/agents/registry", json={"name": "weaver"})
    assert resp.status_code == 201
    assert resp.json()["id"].startswith("weaver-")


def test_create_persists_across_requests(client: TestClient) -> None:
    _init_vault(client)
    client.post("/api/agents/registry", json={"name": "Bookworm"})
    resp = client.get("/api/agents/registry")
    custom = [a for a in resp.json() if not a["system"]]
    assert any(a["name"] == "Bookworm" for a in custom)


def test_update_custom(client: TestClient) -> None:
    _init_vault(client)
    created = client.post(
        "/api/agents/registry",
        json={"name": "Planner", "role": "plans"},
    ).json()
    resp = client.patch(
        f"/api/agents/registry/{created['id']}",
        json={"name": "Planner", "role": "plans my month"},
    )
    assert resp.status_code == 200
    assert resp.json()["role"] == "plans my month"


def test_update_system_rejected(client: TestClient) -> None:
    _init_vault(client)
    resp = client.patch(
        "/api/agents/registry/weaver",
        json={"name": "Weaver", "role": "rewrite"},
    )
    assert resp.status_code == 400


def test_delete_custom(client: TestClient) -> None:
    _init_vault(client)
    created = client.post(
        "/api/agents/registry", json={"name": "Doomed"}
    ).json()
    resp = client.delete(f"/api/agents/registry/{created['id']}")
    assert resp.status_code == 204


def test_delete_system_rejected(client: TestClient) -> None:
    _init_vault(client)
    resp = client.delete("/api/agents/registry/weaver")
    assert resp.status_code == 400


def test_create_invalid_name(client: TestClient) -> None:
    _init_vault(client)
    resp = client.post("/api/agents/registry", json={"name": "###"})
    assert resp.status_code == 400
