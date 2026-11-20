import uuid
from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.dependencies import get_site_repository
from app.models.site import Site
from app.repositories.site_repository import SiteRepository
from app.schemas.common import MessageResponse, PaginatedResponse
from app.schemas.site import SiteCreate, SiteResponse, SiteUpdate

router = APIRouter(prefix="/sites", tags=["Monitoring Sites"])


@router.post(
    "",
    response_model=SiteResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new bioacoustic monitoring site",
)
async def create_site(
    site_in: SiteCreate,
    repo: SiteRepository = Depends(get_site_repository),
):
    site = Site(
        id=str(uuid.uuid4()),
        name=site_in.name,
        latitude=site_in.latitude,
        longitude=site_in.longitude,
        description=site_in.description,
    )
    created = await repo.create(site)
    return created


@router.get(
    "",
    response_model=PaginatedResponse[SiteResponse],
    summary="List monitoring sites with pagination",
)
async def list_sites(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    repo: SiteRepository = Depends(get_site_repository),
):
    skip = (page - 1) * page_size
    items, total = await repo.list(skip=skip, limit=page_size)
    total_pages = (total + page_size - 1) // page_size if total > 0 else 0

    return PaginatedResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get(
    "/{site_id}",
    response_model=SiteResponse,
    summary="Retrieve site metadata by UUID",
)
async def get_site(
    site_id: str,
    repo: SiteRepository = Depends(get_site_repository),
):
    site = await repo.get_by_id(site_id)
    if not site:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Site with ID '{site_id}' not found.",
        )
    return site


@router.patch(
    "/{site_id}",
    response_model=SiteResponse,
    summary="Update monitoring site parameters",
)
async def update_site(
    site_id: str,
    site_in: SiteUpdate,
    repo: SiteRepository = Depends(get_site_repository),
):
    update_data = site_in.model_dump(exclude_unset=True)
    if not update_data:
        site = await repo.get_by_id(site_id)
        if not site:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Site with ID '{site_id}' not found.",
            )
        return site

    updated = await repo.update(site_id, **update_data)
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Site with ID '{site_id}' not found.",
        )
    return updated


@router.delete(
    "/{site_id}",
    response_model=MessageResponse,
    summary="Delete a monitoring site",
)
async def delete_site(
    site_id: str,
    repo: SiteRepository = Depends(get_site_repository),
):
    deleted = await repo.delete(site_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Site with ID '{site_id}' not found.",
        )
    return MessageResponse(message=f"Site '{site_id}' deleted successfully.")
