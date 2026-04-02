"""Analysis service — FastAPI application entry point."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes.analyze import router as analyze_router

app = FastAPI(
    title="Research Platform — Analysis Service",
    description="Statistical analysis microservice for AI persona research studies.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(analyze_router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "analysis"}
