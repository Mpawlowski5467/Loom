"""Integration tests for vault API endpoints."""

from starlette.testclient import TestClient


class TestCreateVault:
    """POST /api/vaults"""

    def test_create_201(self, client: TestClient) -> None:
        resp = client.post("/api/vaults", json={"name": "test"})
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "test"
        assert data["is_active"] is True

    def test_duplicate_409(self, client: TestClient) -> None:
        client.post("/api/vaults", json={"name": "test"})
        resp = client.post("/api/vaults", json={"name": "test"})
        assert resp.status_code == 409

    def test_invalid_name_422(self, client: TestClient) -> None:
        resp = client.post("/api/vaults", json={"name": "bad name!"})
        assert resp.status_code == 422


class TestListVaults:
    """GET /api/vaults"""

    def test_empty(self, client: TestClient) -> None:
        resp = client.get("/api/vaults")
        assert resp.status_code == 200
        assert resp.json()["vaults"] == []

    def test_with_vaults(self, client: TestClient) -> None:
        client.post("/api/vaults", json={"name": "alpha"})
        client.post("/api/vaults", json={"name": "beta"})
        resp = client.get("/api/vaults")
        names = [v["name"] for v in resp.json()["vaults"]]
        assert "alpha" in names
        assert "beta" in names


class TestActiveVault:
    """GET/PUT /api/vaults/active"""

    def test_get_active(self, client: TestClient) -> None:
        client.post("/api/vaults", json={"name": "test"})
        resp = client.get("/api/vaults/active")
        assert resp.status_code == 200
        assert resp.json()["name"] == "test"

    def test_set_active(self, client: TestClient) -> None:
        client.post("/api/vaults", json={"name": "first"})
        client.post("/api/vaults", json={"name": "second"})
        resp = client.put("/api/vaults/active", json={"name": "second"})
        assert resp.status_code == 200
        assert client.get("/api/vaults/active").json()["name"] == "second"

    def test_set_nonexistent_404(self, client: TestClient) -> None:
        resp = client.put("/api/vaults/active", json={"name": "nope"})
        assert resp.status_code == 404
