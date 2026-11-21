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
async def test_job_manager_cancellation_during_execution():
    jm = JobManager(max_concurrent_jobs=2)
    job_id = "test-job-cancel-exec"

    jm.register_job(job_id)

    async def long_worker(jid: str, manager: JobManager):
        await asyncio.sleep(1.0)

    await jm.run_job(job_id, long_worker)
    await asyncio.sleep(0.01)  # Allow job to start
    assert jm.cancel_job(job_id) is True

    cancelled_job = jm.get_job(job_id)
    assert cancelled_job.status == "cancelled"


@pytest.mark.asyncio
async def test_job_manager_cancellation_while_queued():
    """Verify that cancelling a job while queued prevents it from executing and releases permits."""
    jm = JobManager(max_concurrent_jobs=1)
    j1 = "job-active"
    j2 = "job-queued"

    started_j2 = False

    async def blocker(jid: str, manager: JobManager):
        await asyncio.sleep(0.1)

    async def worker2(jid: str, manager: JobManager):
        nonlocal started_j2
        started_j2 = True

    jm.register_job(j1)
    jm.register_job(j2)

    await jm.run_job(j1, blocker)
    await jm.run_job(j2, worker2)

    # Cancel j2 while it is waiting in queue for semaphore
    assert jm.cancel_job(j2) is True
    assert jm.get_job(j2).status == "cancelled"

    await asyncio.sleep(0.15)
    assert started_j2 is False
    assert jm.get_job(j1).status == "completed"
    assert jm.get_job(j2).status == "cancelled"


@pytest.mark.asyncio
async def test_job_manager_slot_release_after_exception():
    """Verify that if a worker raises an unhandled exception, its concurrency slot is released."""
    jm = JobManager(max_concurrent_jobs=1)
    j_fail = "job-fail"
    j_next = "job-next"

    async def failing_worker(jid: str, manager: JobManager):
        raise RuntimeError("Fatal simulation error")

    next_ran = False
    async def next_worker(jid: str, manager: JobManager):
        nonlocal next_ran
        next_ran = True

    jm.register_job(j_fail)
    jm.register_job(j_next)

    await jm.run_job(j_fail, failing_worker)
    await jm.run_job(j_next, next_worker)

    await asyncio.sleep(0.05)

    assert jm.get_job(j_fail).status == "failed"
    assert "Fatal simulation error" in jm.get_job(j_fail).error
    assert next_ran is True
    assert jm.get_job(j_next).status == "completed"


def test_job_manager_cross_loop_reuse():
    """Verify that JobManager can be reused across repeated event loop creations without stale-loop errors."""
    jm = JobManager(max_concurrent_jobs=2)

    async def task_in_loop():
        ran = False
        async def sample_worker(jid: str, manager: JobManager):
            nonlocal ran
            ran = True
            await asyncio.sleep(0.01)

        await jm.run_job("loop-job", sample_worker)
        await asyncio.sleep(0.03)
        assert ran is True

    # Run in loop 1
    asyncio.run(task_in_loop())

    # Run in loop 2
    asyncio.run(task_in_loop())

    # Run in loop 3
    asyncio.run(task_in_loop())
