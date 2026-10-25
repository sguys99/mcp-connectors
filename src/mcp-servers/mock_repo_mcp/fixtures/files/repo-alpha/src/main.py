"""alpha-service entry point (sample fixture)."""

from fastapi import FastAPI

app = FastAPI(title="alpha-service")


@app.get("/health")
async def health() -> dict[str, str]:
    # TODO: include downstream dependency check
    return {"status": "ok"}
