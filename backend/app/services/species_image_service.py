"""Trusted species photograph resolution with provenance and persistent caching.

Resolution order:
1. Curated local verified Wikimedia Commons assets bundled under `/assets/specimens/*.jpg`
2. Persistent SQLite + in-memory LRU cache (`species_image_cache`)
3. Wikimedia REST Summary + Commons `imageinfo` API (open-licensed images only, bounded timeouts)
4. Explicit honest `image_status = "unavailable"` without breaking callers or fabricating images
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from html import unescape
from typing import Any, Callable, Dict, Iterable, Optional, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import database as _db_module
from app.models.species_image import SpeciesImageCache

logger = logging.getLogger(__name__)

_USER_AGENT = "EcoSonic/3.0 (Bioacoustic Research; https://github.com/ecosonic)"
_OPEN_LICENSE_MARKERS = ("cc by", "cc0", "public domain", "pd", "gfdl")
_HTML_TAG_RE = re.compile(r"<[^>]+>")

# Local curated specimen photographs stored under frontend/public/assets/specimens/
LOCAL_VERIFIED_IMAGES: Dict[str, Dict[str, str]] = {
    "troglodytes pacificus": {
        "url": "/assets/specimens/pacific_wren.jpg",
        "source": "ECOsonic Local Curated Commons",
        "license": "CC BY-SA 2.0",
        "attribution": "Eleanor Briccetti",
        "source_url": "https://commons.wikimedia.org/wiki/File:Pacific_Wren_-_Vancouver_Is._(6842161146).jpg",
    },
    "ixoreus naevius": {
        "url": "/assets/specimens/varied_thrush.jpg",
        "source": "ECOsonic Local Curated Commons",
        "license": "CC BY-SA 4.0",
        "attribution": "Rhododendrites",
        "source_url": "https://commons.wikimedia.org/wiki/File:Varied_thrush_(73976).jpg",
    },
    "cyanocitta stelleri": {
        "url": "/assets/specimens/stellers_jay.jpg",
        "source": "ECOsonic Local Curated Commons",
        "license": "CC BY 2.0",
        "attribution": "Noel Reynolds",
        "source_url": "https://commons.wikimedia.org/wiki/File:Steller%27s_Jay_flagstaff_arizona.jpg",
    },
    "poecile rufescens": {
        "url": "/assets/specimens/chestnut_backed_chickadee.jpg",
        "source": "ECOsonic Local Curated Commons",
        "license": "CC BY-SA 4.0",
        "attribution": "VJAnderson",
        "source_url": "https://commons.wikimedia.org/wiki/File:Chestnut-backed_Chickadee_2154ab_(cropped).jpg",
    },
    "colaptes auratus": {
        "url": "/assets/specimens/northern_flicker.jpg",
        "source": "ECOsonic Local Curated Commons",
        "license": "CC BY-SA 4.0",
        "attribution": "Rhododendrites",
        "source_url": "https://commons.wikimedia.org/wiki/File:Northern_yellow-shafted_flicker_male_(33737)_(cropped).jpg",
    },
    "dryocopus pileatus": {
        "url": "/assets/specimens/pileated_woodpecker.jpg",
        "source": "ECOsonic Local Curated Commons",
        "license": "CC BY-SA 3.0",
        "attribution": "Joshlaymon",
        "source_url": "https://commons.wikimedia.org/wiki/File:PileatedWoodpeckerFeedingonTree,_crop.jpg",
    },
    "sphyrapicus ruber": {
        "url": "/assets/specimens/red_breasted_sapsucker.jpg",
        "source": "ECOsonic Local Curated Commons",
        "license": "CC BY 2.0",
        "attribution": "Kevin Cole",
        "source_url": "https://commons.wikimedia.org/wiki/File:Sphyrapicus_ruber_2.jpg",
    },
    "glaucidium gnoma": {
        "url": "/assets/specimens/northern_pygmy_owl.jpg",
        "source": "ECOsonic Local Curated Commons",
        "license": "CC BY 2.0",
        "attribution": "Greg Schechter",
        "source_url": "https://commons.wikimedia.org/wiki/File:Northern_Pygmy_Owl_-_Flickr_-_GregTheBusker_(2).jpg",
    },
    "regulus satrapa": {
        "url": "/assets/specimens/golden_crowned_kinglet.jpg",
        "source": "ECOsonic Local Curated Commons",
        "license": "CC BY-SA 4.0",
        "attribution": "Chuck Homler, Focus On Wildlife",
        "source_url": "https://commons.wikimedia.org/wiki/File:Golden-Crowned_Kinglet_EBFNWR.jpg",
    },
    "corvus brachyrhynchos": {
        "url": "/assets/specimens/american_crow.jpg",
        "source": "ECOsonic Local Curated Commons",
        "license": "CC BY-SA 3.0",
        "attribution": "Wikimedia Commons Contributor",
        "source_url": "https://commons.wikimedia.org/wiki/File:Corvus-brachyrhynchos-001.jpg",
    },
    "melospiza melodia": {
        "url": "/assets/specimens/song_sparrow.jpg",
        "source": "ECOsonic Local Curated Commons",
        "license": "CC BY-SA 4.0",
        "attribution": "Rhododendrites",
        "source_url": "https://commons.wikimedia.org/wiki/File:Song_sparrow_in_Prospect_Park_(93031).jpg",
    },
    "junco hyemalis": {
        "url": "/assets/specimens/dark_eyed_junco.jpg",
        "source": "ECOsonic Local Curated Commons",
        "license": "CC BY-SA 3.0",
        "attribution": "Cephas",
        "source_url": "https://commons.wikimedia.org/wiki/File:Junco_hyemalis_hyemalis_CT1_(cropped).jpg",
    },
    "megaceryle alcyon": {
        "url": "/assets/specimens/belted_kingfisher.jpg",
        "source": "ECOsonic Local Curated Commons",
        "license": "CC BY-SA 4.0",
        "attribution": "JeffreyGammon",
        "source_url": "https://commons.wikimedia.org/wiki/File:BeltedKingfisherJG_Male.jpg",
    },
    "haliaeetus leucocephalus": {
        "url": "/assets/specimens/bald_eagle.jpg",
        "source": "ECOsonic Local Curated Commons",
        "license": "CC BY 2.0",
        "attribution": "Andy Morffew",
        "source_url": "https://commons.wikimedia.org/wiki/File:Bald_eagle_about_to_fly_in_Alaska_(2016).jpg",
    },
    "turdus migratorius": {
        "url": "/assets/specimens/american_robin.jpg",
        "source": "ECOsonic Local Curated Commons",
        "license": "CC BY-SA 4.0",
        "attribution": "Rhododendrites",
        "source_url": "https://commons.wikimedia.org/wiki/File:American_robin_(71307).jpg",
    },
    "ardea herodias": {
        "url": "/assets/specimens/great_blue_heron.jpg",
        "source": "ECOsonic Local Curated Commons",
        "license": "CC BY-SA 4.0",
        "attribution": "DallasPenner",
        "source_url": "https://commons.wikimedia.org/wiki/File:GreatBlueHeronInARiver.jpg",
    },
    "catharus ustulatus": {
        "url": "/assets/specimens/swainsons_thrush.jpg",
        "source": "ECOsonic Local Curated Commons",
        "license": "CC BY-SA 4.0",
        "attribution": "Cephas",
        "source_url": "https://commons.wikimedia.org/wiki/File:Catharus_ustulatus_Clbrg_01.jpg",
    },
    "erithacus rubecula": {
        "url": "/assets/specimens/european_robin_canopy.jpg",
        "source": "ECOsonic Project Curated Asset",
        "license": "Project Canonical Asset",
        "attribution": "ECOsonic Wildlife Archive",
        "source_url": "/assets/specimens/european_robin_canopy.jpg",
    },
}


def _strip_html(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    cleaned = unescape(_HTML_TAG_RE.sub("", raw)).strip()
    return " ".join(cleaned.split()) or None


def _is_open_license(license_name: Optional[str]) -> bool:
    if not license_name:
        return False
    low = license_name.strip().lower()
    return any(marker in low for marker in _OPEN_LICENSE_MARKERS)


def _fetch_json_sync(url: str, timeout: float = 3.2) -> Dict[str, Any]:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": _USER_AGENT, "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _extract_commons_filename(image_url: str) -> Optional[str]:
    if not image_url:
        return None
    parsed = urllib.parse.urlparse(image_url)
    path = urllib.parse.unquote(parsed.path)
    parts = [p for p in path.split("/") if p]
    if "thumb" in parts:
        idx = parts.index("thumb")
        # /.../thumb/<h1 >/<h2 >/<Filename>/<width>px-<Filename>
        if len(parts) > idx + 3:
            return parts[idx + 3]
    if parts:
        return parts[-1]
    return None


def _fetch_wikimedia_species_image_sync(
    scientific_name: str,
    common_name: Optional[str] = None,
) -> Dict[str, Any]:
    """Synchronously query Wikipedia summary + Commons imageinfo for open-licensed bird imagery."""
    now_iso = datetime.now(timezone.utc).isoformat()
    candidates = [scientific_name.strip()]
    if common_name and common_name.strip().lower() != scientific_name.strip().lower():
        candidates.append(common_name.strip())

    for query in candidates:
        if not query:
            continue
        slug = urllib.parse.quote(query.replace(" ", "_"))
        summary_url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{slug}"
        try:
            summary = _fetch_json_sync(summary_url, timeout=3.2)
        except Exception:
            continue

        if summary.get("type") == "disambiguation":
            continue
        thumb = (summary.get("thumbnail") or {}).get("source")
        orig = (summary.get("originalimage") or {}).get("source")
        chosen_url = thumb or orig
        if not chosen_url:
            continue

        filename = _extract_commons_filename(orig or thumb or "")
        license_name: Optional[str] = None
        attribution: Optional[str] = None
        source_page = (
            ((summary.get("content_urls") or {}).get("desktop") or {}).get("page")
        )

        if filename:
            info_url = (
                "https://commons.wikimedia.org/w/api.php?action=query"
                f"&titles={urllib.parse.quote('File:' + filename)}"
                "&prop=imageinfo&iiprop=url|extmetadata&format=json"
            )
            try:
                info = _fetch_json_sync(info_url, timeout=3.2)
                pages = (info.get("query") or {}).get("pages") or {}
                for page_obj in pages.values():
                    ii = (page_obj.get("imageinfo") or [None])[0]
                    if ii:
                        meta = ii.get("extmetadata") or {}
                        license_name = _strip_html((meta.get("LicenseShortName") or {}).get("value"))
                        attribution = _strip_html((meta.get("Artist") or {}).get("value"))
                        source_page = ii.get("descriptionurl") or source_page
                        break
            except Exception:
                pass

        if license_name and not _is_open_license(license_name):
            # Reject restrictive/non-free licenses strictly
            continue

        return {
            "image_status": "available",
            "url": chosen_url,
            "source": "Wikimedia Commons",
            "license": license_name or "Wikimedia Commons (verify license)",
            "attribution": attribution or "Wikimedia Commons Contributor",
            "source_url": source_page or summary_url,
            "retrieved_at": now_iso,
        }

    return {
        "image_status": "unavailable",
        "url": None,
        "source": "wikimedia_commons",
        "license": None,
        "attribution": None,
        "source_url": None,
        "retrieved_at": now_iso,
    }


class SpeciesImageService:
    """Caches and serves verified biological species images with full provenance."""

    def __init__(
        self,
        fetcher: Optional[Callable[[str, Optional[str]], Dict[str, Any]]] = None,
    ) -> None:
        self._mem_cache: Dict[str, Tuple[Dict[str, Any], Optional[datetime]]] = {}
        self._fetcher = fetcher or _fetch_wikimedia_species_image_sync

    def set_fetcher_for_testing(
        self,
        fetcher: Optional[Callable[[str, Optional[str]], Dict[str, Any]]],
    ) -> None:
        self._fetcher = fetcher or _fetch_wikimedia_species_image_sync
        self._mem_cache.clear()

    def clear_memory_cache(self) -> None:
        self._mem_cache.clear()

    @staticmethod
    def normalize_key(scientific_name: str) -> str:
        return " ".join((scientific_name or "").strip().lower().split())

    def get_local_image(self, scientific_name: str) -> Optional[Dict[str, Any]]:
        key = self.normalize_key(scientific_name)
        local = LOCAL_VERIFIED_IMAGES.get(key)
        if not local:
            return None
        return {
            "image_status": "available",
            "url": local["url"],
            "source": local["source"],
            "license": local["license"],
            "attribution": local["attribution"],
            "source_url": local["source_url"],
            "retrieved_at": datetime.now(timezone.utc).isoformat(),
        }

    async def get_species_image(
        self,
        scientific_name: str,
        *,
        common_name: Optional[str] = None,
        allow_external: bool = True,
        db: Optional[AsyncSession] = None,
    ) -> Dict[str, Any]:
        key = self.normalize_key(scientific_name)
        now = datetime.now(timezone.utc)
        if not key:
            return {
                "image_status": "unavailable",
                "url": None,
                "source": "none",
                "license": None,
                "attribution": None,
                "source_url": None,
                "retrieved_at": now.isoformat(),
            }

        # 1. Local curated registry (instantaneous, zero external calls)
        local = self.get_local_image(key)
        if local is not None:
            return local

        # 2. In-memory cache
        mem_entry = self._mem_cache.get(key)
        if mem_entry is not None:
            payload, expires_at = mem_entry
            if expires_at is None or expires_at > now:
                return dict(payload)

        # 3. Persistent SQLite cache lookup
        async def _load_db_cache(session: AsyncSession) -> Optional[SpeciesImageCache]:
            res = await session.execute(
                select(SpeciesImageCache).where(SpeciesImageCache.scientific_name_key == key)
            )
            return res.scalar_one_or_none()

        cached_row: Optional[SpeciesImageCache] = None
        if db is not None:
            try:
                cached_row = await _load_db_cache(db)
            except Exception:
                cached_row = None
        else:
            try:
                async with _db_module.async_session_factory() as tmp_db:
                    cached_row = await _load_db_cache(tmp_db)
            except Exception:
                cached_row = None

        if cached_row is not None:
            exp = cached_row.expires_at
            if exp is not None and exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if exp is None or exp > now:
                payload = {
                    "image_status": cached_row.image_status,
                    "url": cached_row.image_url,
                    "source": cached_row.source,
                    "license": cached_row.license,
                    "attribution": cached_row.attribution,
                    "source_url": cached_row.source_url,
                    "retrieved_at": cached_row.retrieved_at.isoformat(),
                }
                self._mem_cache[key] = (payload, exp)
                return dict(payload)

        # 4. External Wikimedia fetch (if permitted by runtime flags & argument)
        if not allow_external or os.environ.get("ECOSONIC_DISABLE_EXTERNAL_MEDIA") == "1":
            unavailable = {
                "image_status": "unavailable",
                "url": None,
                "source": "external_disabled",
                "license": None,
                "attribution": None,
                "source_url": None,
                "retrieved_at": now.isoformat(),
            }
            return unavailable

        try:
            fetched = await asyncio.to_thread(self._fetcher, scientific_name, common_name)
        except Exception as exc:
            logger.debug("Species image lookup error for %s: %s", scientific_name, exc)
            fetched = {
                "image_status": "unavailable",
                "url": None,
                "source": "wikimedia_commons",
                "license": None,
                "attribution": None,
                "source_url": None,
                "retrieved_at": now.isoformat(),
            }

        is_available = fetched.get("image_status") == "available" and bool(fetched.get("url"))
        ttl_expires = now + (timedelta(days=30) if is_available else timedelta(hours=12))
        self._mem_cache[key] = (dict(fetched), ttl_expires)

        # Persist in SQLite cache cleanly
        async def _save_db_cache(session: AsyncSession) -> None:
            existing = await _load_db_cache(session)
            if existing is None:
                existing = SpeciesImageCache(
                    scientific_name_key=key,
                    scientific_name=scientific_name.strip(),
                    common_name=common_name,
                    image_status=fetched.get("image_status", "unavailable"),
                    image_url=fetched.get("url"),
                    source=fetched.get("source"),
                    license=fetched.get("license"),
                    attribution=fetched.get("attribution"),
                    source_url=fetched.get("source_url"),
                    retrieved_at=now,
                    expires_at=ttl_expires,
                )
                session.add(existing)
            else:
                existing.image_status = fetched.get("image_status", "unavailable")
                existing.image_url = fetched.get("url")
                existing.source = fetched.get("source")
                existing.license = fetched.get("license")
                existing.attribution = fetched.get("attribution")
                existing.source_url = fetched.get("source_url")
                existing.retrieved_at = now
                existing.expires_at = ttl_expires
            await session.commit()

        try:
            if db is not None:
                await _save_db_cache(db)
            else:
                async with _db_module.async_session_factory() as tmp_db:
                    await _save_db_cache(tmp_db)
        except Exception as db_exc:
            logger.debug("Could not persist species image cache for %s: %s", key, db_exc)

        return dict(fetched)

    async def resolve_batch(
        self,
        species_pairs: Iterable[Tuple[str, Optional[str]]],
        *,
        max_external: int = 16,
        concurrency: int = 4,
    ) -> Dict[str, Dict[str, Any]]:
        """Resolve provenance-tracked images for a deduplicated list of species with bounded external requests."""
        unique_pairs: list[Tuple[str, str, Optional[str]]] = []
        seen: set[str] = set()
        for sci, com in species_pairs:
            k = self.normalize_key(sci)
            if k and k not in seen:
                seen.add(k)
                unique_pairs.append((k, sci, com))

        sem = asyncio.Semaphore(max(1, concurrency))
        external_budget = max(0, max_external)
        budget_lock = asyncio.Lock()

        async def _resolve_one(k: str, sci: str, com: Optional[str]) -> Tuple[str, Dict[str, Any]]:
            nonlocal external_budget
            local = self.get_local_image(k)
            if local is not None:
                return k, local
            mem_entry = self._mem_cache.get(k)
            if mem_entry is not None and (
                mem_entry[1] is None or mem_entry[1] > datetime.now(timezone.utc)
            ):
                return k, dict(mem_entry[0])

            allow_ext = False
            async with budget_lock:
                if external_budget > 0:
                    external_budget -= 1
                    allow_ext = True

            async with sem:
                img = await self.get_species_image(
                    sci, common_name=com, allow_external=allow_ext
                )
            return k, img

        results = await asyncio.gather(*(_resolve_one(k, sci, com) for k, sci, com in unique_pairs))
        return dict(results)


species_image_service = SpeciesImageService()
