import hmac
import os
import re
import shutil
import subprocess
import threading
import time
import uuid
from collections import deque
from pathlib import Path
from urllib.parse import urlparse

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, field_validator
from starlette.background import BackgroundTask

APP_DIR = Path(os.getenv("CLIP_DIR", "/tmp/youtube-clipper-pro"))
APP_DIR.mkdir(parents=True, exist_ok=True)

MAX_DURATION = int(os.getenv("MAX_CLIP_SECONDS", "600"))
FILE_TTL = int(os.getenv("FILE_TTL_SECONDS", "900"))
MAX_ACTIVE_JOBS = int(os.getenv("MAX_ACTIVE_JOBS", "2"))
RATE_LIMIT_JOBS = int(os.getenv("RATE_LIMIT_JOBS", "6"))
RATE_LIMIT_WINDOW = int(os.getenv("RATE_LIMIT_WINDOW_SECONDS", "600"))
APP_ACCESS_CODE = os.getenv("APP_ACCESS_CODE", "").strip()
FRONTEND_ORIGIN = os.getenv(
    "FRONTEND_ORIGIN",
    "https://youtube-clipper-pro-web.netlify.app",
)

jobs: dict[str, dict] = {}
submission_times: deque[float] = deque()
lock = threading.Lock()

app = FastAPI(
    title="YouTube Clipper Pro API",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=[
        "Content-Type",
        "X-Access-Code",
        "X-Pinggy-No-Screen",
    ],
)


def require_access_code(
    x_access_code: str | None = Header(default=None, alias="X-Access-Code"),
) -> None:
    if not APP_ACCESS_CODE:
        raise HTTPException(
            status_code=503,
            detail="Access protection is not configured.",
        )

    supplied = (x_access_code or "").strip()

    if not hmac.compare_digest(supplied, APP_ACCESS_CODE):
        raise HTTPException(
            status_code=401,
            detail="Invalid access code.",
        )


def to_seconds(value: str) -> int:
    if not re.fullmatch(r"\d{1,3}:\d{2}:\d{2}", value):
        raise ValueError("Use HH:MM:SS.")

    hours, minutes, seconds = map(int, value.split(":"))

    if minutes > 59 or seconds > 59:
        raise ValueError("Invalid time.")

    return hours * 3600 + minutes * 60 + seconds


def valid_youtube_url(value: str) -> bool:
    try:
        parsed = urlparse(value)
    except ValueError:
        return False

    if parsed.scheme not in {"http", "https"}:
        return False

    hostname = (parsed.hostname or "").lower()

    return (
        hostname == "youtu.be"
        or hostname == "youtube.com"
        or hostname.endswith(".youtube.com")
    )


def safe_filename(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_-]", "_", value).strip("._-")
    return cleaned[:80] or "youtube_clip"


class ClipRequest(BaseModel):
    url: str
    start: str
    end: str
    filename: str = "youtube_clip"

    @field_validator("url")
    @classmethod
    def youtube_only(cls, value: str) -> str:
        value = value.strip()

        if not valid_youtube_url(value):
            raise ValueError("Only valid YouTube URLs are accepted.")

        return value

    @field_validator("filename")
    @classmethod
    def clean_filename(cls, value: str) -> str:
        return safe_filename(value)


def cleanup_expired_files() -> None:
    cutoff = time.time() - FILE_TTL

    for path in APP_DIR.glob("*.mp4"):
        try:
            if path.stat().st_mtime < cutoff:
                path.unlink(missing_ok=True)
        except OSError:
            pass

    with lock:
        expired_jobs = [
            job_id
            for job_id, job in jobs.items()
            if job.get("created_at", 0) < cutoff
        ]

        for job_id in expired_jobs:
            jobs.pop(job_id, None)


def remove_download(job_id: str, path: Path) -> None:
    path.unlink(missing_ok=True)

    with lock:
        jobs.pop(job_id, None)


def process_job(job_id: str, clip_request: ClipRequest) -> None:
    output = APP_DIR / f"{job_id}-{clip_request.filename}.mp4"

    try:
        cleanup_expired_files()

        with lock:
            jobs[job_id].update(
                status="processing",
                progress=10,
                message="Downloading selected section",
            )

        start = to_seconds(clip_request.start)
        end = to_seconds(clip_request.end)

        command = [
            "python",
            "-m",
            "yt_dlp",
            "--no-playlist",
            "--newline",
            "--download-sections",
            f"*{start}-{end}",
            "--force-keyframes-at-cuts",
            "-f",
            "best[ext=mp4]/bv*+ba/best",
            "--merge-output-format",
            "mp4",
            "-o",
            str(output),
            clip_request.url,
        ]

        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )

        assert process.stdout is not None

        for line in process.stdout:
            match = re.search(
                r"\[download\]\s+([0-9.]+)%",
                line,
            )

            if match:
                percent = min(
                    90,
                    10 + int(float(match.group(1)) * 0.8),
                )

                with lock:
                    if job_id in jobs:
                        jobs[job_id]["progress"] = percent

        return_code = process.wait()

        if return_code != 0 or not output.exists():
            raise RuntimeError("Video processing failed.")

        with lock:
            jobs[job_id].update(
                status="completed",
                progress=100,
                message="Ready",
                download_url=f"/api/jobs/{job_id}/download",
                path=str(output),
                filename=f"{clip_request.filename}.mp4",
            )

    except Exception:
        output.unlink(missing_ok=True)

        with lock:
            if job_id in jobs:
                jobs[job_id].update(
                    status="failed",
                    progress=0,
                    message="Unable to process this video.",
                )


@app.get("/health")
def health():
    return {
        "status": "ok",
        "ffmpeg": bool(shutil.which("ffmpeg")),
        "protected": bool(APP_ACCESS_CODE),
    }


@app.post(
    "/api/jobs",
    status_code=202,
    dependencies=[Depends(require_access_code)],
)
def create_job(
    clip_request: ClipRequest,
    request: Request,
):
    del request

    start = to_seconds(clip_request.start)
    end = to_seconds(clip_request.end)

    if end <= start:
        raise HTTPException(
            400,
            "End time must be later than start time.",
        )

    if end - start > MAX_DURATION:
        raise HTTPException(
            400,
            f"Clips are limited to {MAX_DURATION // 60} minutes.",
        )

    now = time.time()

    with lock:
        while (
            submission_times
            and submission_times[0] < now - RATE_LIMIT_WINDOW
        ):
            submission_times.popleft()

        if len(submission_times) >= RATE_LIMIT_JOBS:
            raise HTTPException(
                429,
                "Usage limit reached. Please try again later.",
            )

        active_jobs = sum(
            1
            for job in jobs.values()
            if job.get("status") in {"queued", "processing"}
        )

        if active_jobs >= MAX_ACTIVE_JOBS:
            raise HTTPException(
                429,
                "The processor is busy. Please try again shortly.",
            )

        submission_times.append(now)

        job_id = uuid.uuid4().hex

        jobs[job_id] = {
            "status": "queued",
            "progress": 2,
            "message": "Queued",
            "created_at": now,
        }

    threading.Thread(
        target=process_job,
        args=(job_id, clip_request),
        daemon=True,
    ).start()

    return {
        "job_id": job_id,
        "status_url": f"/api/jobs/{job_id}",
    }


@app.get(
    "/api/jobs/{job_id}",
    dependencies=[Depends(require_access_code)],
)
def get_job(job_id: str):
    with lock:
        job = jobs.get(job_id)

        if not job:
            raise HTTPException(404, "Job not found.")

        return {
            key: value
            for key, value in job.items()
            if key not in {"path", "filename"}
        }


@app.get(
    "/api/jobs/{job_id}/download",
    dependencies=[Depends(require_access_code)],
)
def download(
    job_id: str,
):
    with lock:
        job = jobs.get(job_id)

        if not job or job.get("status") != "completed":
            raise HTTPException(404, "Clip not ready.")

        path = Path(job["path"])
        filename = job["filename"]

    if not path.exists():
        raise HTTPException(410, "Clip expired.")

    return FileResponse(
        path,
        media_type="video/mp4",
        filename=filename,
        background=BackgroundTask(remove_download, job_id, path),
    )