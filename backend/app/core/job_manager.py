import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Coroutine, Dict, Optional

from app.core.logging import logger


@dataclass
class JobInfo:
    job_id: str
    status: str = "queued"  # queued, processing, completed, failed, cancelled
    progress: float = 0.0
    stage: str = "Queued"
    error: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    _task: Optional[asyncio.Task] = None
    _cancelled: bool = False


class JobManager:
    """In-process asynchronous job manager for handling audio analysis tasks."""

    def __init__(self, max_concurrent_jobs: int = 4):
        self.max_concurrent_jobs = max_concurrent_jobs
        self._jobs: Dict[str, JobInfo] = {}
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._semaphore = asyncio.Semaphore(max_concurrent_jobs)
        self._lock = asyncio.Lock()

    def register_job(self, job_id: str, metadata: Optional[Dict[str, Any]] = None) -> JobInfo:
        """Registers a new job in the tracking registry."""
        job = JobInfo(
            job_id=job_id,
            status="queued",
            stage="Queued",
            metadata=metadata or {},
        )
        self._jobs[job_id] = job
        logger.info("Job [%s] registered in job manager.", job_id)
        return job

    def get_job(self, job_id: str) -> Optional[JobInfo]:
        """Retrieves job state by id."""
        return self._jobs.get(job_id)

    def update_progress(
        self,
        job_id: str,
        progress: float,
        stage: Optional[str] = None,
    ) -> None:
        """Updates the progress and stage of a running job."""
        job = self._jobs.get(job_id)
        if job and not job._cancelled:
            job.progress = min(max(round(progress, 1), 0.0), 100.0)
            if stage:
                job.stage = stage
            logger.debug("Job [%s] progress: %.1f%% - Stage: %s", job_id, job.progress, job.stage)

    def cancel_job(self, job_id: str) -> bool:
        """Cancels an active or queued job."""
        job = self._jobs.get(job_id)
        if not job:
            return False

        job._cancelled = True
        job.status = "cancelled"
        job.stage = "Cancelled by user"
        job.completed_at = datetime.now(timezone.utc)

        if job._task and not job._task.done():
            job._task.cancel()
            logger.info("Job [%s] task cancelled.", job_id)

        return True

    def is_cancelled(self, job_id: str) -> bool:
        job = self._jobs.get(job_id)
        return bool(job and job._cancelled)

    async def run_job(
        self,
        job_id: str,
        job_coro: Callable[[str, "JobManager"], Coroutine[Any, Any, None]],
    ) -> None:
        """Schedules and executes a job coroutine with concurrency throttling."""
        job = self._jobs.get(job_id)
        if not job:
            job = self.register_job(job_id)

        async def _wrapper():
            async with self._semaphore:
                if job._cancelled:
                    return

                job.status = "processing"
                job.stage = "Started"
                job.started_at = datetime.now(timezone.utc)
                logger.info("Job [%s] execution started.", job_id)

                try:
                    await job_coro(job_id, self)
                    if not job._cancelled:
                        job.status = "completed"
                        job.progress = 100.0
                        job.stage = "Completed"
                        job.completed_at = datetime.now(timezone.utc)
                        logger.info("Job [%s] completed successfully.", job_id)
                except asyncio.CancelledError:
                    job.status = "cancelled"
                    job.stage = "Cancelled"
                    job.completed_at = datetime.now(timezone.utc)
                    logger.warning("Job [%s] was cancelled during execution.", job_id)
                    raise
                except Exception as e:
                    job.status = "failed"
                    job.error = str(e)
                    job.stage = "Failed"
                    job.completed_at = datetime.now(timezone.utc)
                    logger.exception("Job [%s] failed with error: %s", job_id, e)

        task = asyncio.create_task(_wrapper())
        job._task = task


job_manager = JobManager()
