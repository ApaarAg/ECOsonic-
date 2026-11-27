import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Coroutine, Dict, Optional

from app.config import settings
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
        self._semaphore: Optional[asyncio.Semaphore] = None

    @property
    def semaphore(self) -> asyncio.Semaphore:
        """Lazily provisions or retrieves the concurrency semaphore for the active event loop."""
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if self._semaphore is None:
            self._semaphore = asyncio.Semaphore(self.max_concurrent_jobs)
        elif loop is not None and getattr(self._semaphore, "_loop", None) not in (None, loop):
            # Prior semaphore was attached to an older or closed event loop.
            self._semaphore = asyncio.Semaphore(self.max_concurrent_jobs)
        return self._semaphore

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
            async with self.semaphore:
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

    async def wait_for_job(self, job_id: str, timeout: Optional[float] = None) -> Optional[JobInfo]:
        """Waits for a job's background task to finish executing."""
        job = self._jobs.get(job_id)
        if not job:
            return None
        if job._task and not job._task.done():
            try:
                if timeout is not None:
                    await asyncio.wait_for(asyncio.shield(job._task), timeout=timeout)
                else:
                    await job._task
            except (asyncio.CancelledError, asyncio.TimeoutError):
                pass
        return job

    async def cancel_job_and_wait(self, job_id: str, timeout: Optional[float] = 5.0) -> bool:
        """Cancels a job and awaits its task termination so resources/DB sessions are released."""
        job = self._jobs.get(job_id)
        if not job:
            return False
        self.cancel_job(job_id)
        if job._task and not job._task.done():
            try:
                if timeout is not None:
                    await asyncio.wait_for(job._task, timeout=timeout)
                else:
                    await job._task
            except (asyncio.CancelledError, asyncio.TimeoutError):
                pass
        return True

    async def cancel_and_wait_all(self, timeout: Optional[float] = 5.0) -> None:
        """Cancels all active jobs and awaits their completion to ensure DB sessions are closed."""
        tasks = []
        for jid, job in list(self._jobs.items()):
            self.cancel_job(jid)
            if job._task and not job._task.done():
                tasks.append(job._task)
        if tasks:
            try:
                if timeout is not None:
                    await asyncio.wait_for(
                        asyncio.gather(*tasks, return_exceptions=True),
                        timeout=timeout,
                    )
                else:
                    await asyncio.gather(*tasks, return_exceptions=True)
            except (asyncio.CancelledError, asyncio.TimeoutError):
                pass

    async def wait_all(self, timeout: Optional[float] = None) -> None:
        """Waits for all active tasks to complete."""
        tasks = [job._task for job in self._jobs.values() if job._task and not job._task.done()]
        if tasks:
            if timeout is not None:
                await asyncio.wait_for(asyncio.gather(*tasks, return_exceptions=True), timeout=timeout)
            else:
                await asyncio.gather(*tasks, return_exceptions=True)


job_manager = JobManager(max_concurrent_jobs=settings.MAX_CONCURRENT_JOBS)
