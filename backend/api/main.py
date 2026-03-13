from fastapi import FastAPI

app = FastAPI(title="Loom", version="0.1.0")


@app.get("/api/health")
async def health() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "ok"}
