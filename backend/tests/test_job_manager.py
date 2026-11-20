import asyncio
import pytest

from app.core.job_manager import JobManager


@pytest.mark.asyncio
async def test_job_manager_lifecycle():
    jm = JobManager(max_concurrent_jobs=2)
    job_id = "test-job-001"

    job = jm.register_job(job_id)
    assert job.status == "queued"
    assert job.progress == 0.0

    async def mock_worker(jid: str, manager: JobManager):
        manager.update_progress(jid, 50.0, "Halfway done")
        await asyncio.sleep(0.05)
        manager.update_progress(jid, 100.0, "Finished")

    await jm.run_job(job_id, mock_worker)
    await asyncio.sleep(0.1)

    completed_job = jm.get_job(job_id)
    assert completed_job.status == "completed"
    assert completed_job.progress == 100.0


@pytest.mark.asyncio
async def test_job_manager_cancellation():
    jm = JobManager(max_concurrent_jobs=2)
    job_id = "test-job-cancel"

    jm.register_job(job_id)

    async def long_worker(jid: str, manager: JobManager):
        await asyncio.sleep(1.0)

    await jm.run_job(job_id, long_worker)
    assert jm.cancel_job(job_id) is True

    cancelled_job = jm.get_job(job_id)
    assert cancelled_job.status == "cancelled"
