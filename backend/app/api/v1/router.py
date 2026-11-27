from fastapi import APIRouter

from app.config import settings
from app.api.v1.acoustic import router as acoustic_router
from app.api.v1.analyses import router as analyses_router
from app.api.v1.detections import router as detections_router
from app.api.v1.ecology import router as ecology_router
from app.api.v1.environmental import router as environmental_router
from app.api.v1.live import router as live_router
from app.api.v1.reports import router as reports_router
from app.api.v1.sites import router as sites_router

api_v1_router = APIRouter(prefix="/v1")

api_v1_router.include_router(analyses_router)
api_v1_router.include_router(detections_router)
api_v1_router.include_router(acoustic_router)
if settings.ENABLE_ACOUSTIC_MEMORY:
    from app.api.v1.acoustic_memory import router as acoustic_memory_router
    api_v1_router.include_router(acoustic_memory_router)
api_v1_router.include_router(sites_router)
api_v1_router.include_router(reports_router)
api_v1_router.include_router(ecology_router)
api_v1_router.include_router(environmental_router)
api_v1_router.include_router(live_router)
