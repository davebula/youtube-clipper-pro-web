import os
import re
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, field_validator

APP_DIR = Path(os.getenv("CLIP_DIR", "/tmp/youtube-clipper-pro"))
APP_DIR.mkdir(parents=True, exist_ok=True)
MAX_DURATION = int(os.getenv("MAX_CLIP_SECONDS", "1800"))
FILE_TTL = int(os.getenv("FILE_TTL_SECONDS", "3600"))
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")
jobs: dict[str, dict] = {}
lock = threading.Lock()

app = FastAPI(title="YouTube Clipper Pro API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


def to_seconds(value: str) -> int:
    if not re.fullmatch(r"\d{1,3}:\d{2}:\d{2}", value):
        raise ValueError("Use HH:MM:SS.")
    hours, minutes, seconds = map(int, value.split(":"))
    if minutes > 59 or seconds > 59:
        raise ValueError("Invalid time.")
    return hours * 3600 + minutes * 60 + seconds


class ClipRequest(BaseModel):
    url: str
    start: str
    end: str
    filename: str = "youtube_clip"

    @field_validator("url")
    @classmethod
    def youtube_only(cls, value: str):
        if not re.match(r"^https?://(www\.)?(youtube\.com|youtu\.be)/", value, re.I):
            raise ValueError("Only YouTube URLs are accepted.")
        return value


def cleanup():
    cutoff = time.time() - FILE_TTL
    for path in APP_DIR.glob("*.mp4"):
        if path.stat().st_mtime < cutoff:
            path.unlink(missing_ok=True)


def process_job(job_id: str, request: ClipRequest):
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", request.filename).strip("._") or "youtube_clip"
    output = APP_DIR / f"{job_id}-{safe}.mp4"
    try:
        cleanup()
        with lock:
            jobs[job_id].update(status="processing", progress=10, message="Downloading selected section")
        start = to_seconds(request.start)
        end = to_seconds(request.end)
        command = [
            "python", "-m", "yt_dlp", "--no-playlist", "--newline",
            "--download-sections", f"*{start}-{end}", "--force-keyframes-at-cuts",
            "-f", "best[ext=mp4]/bv*+ba/b/best", "--merge-output-format", "mp4",
            "-o", str(output), request.url,
        ]
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        assert process.stdout is not None
        for line in process.stdout:
            match = re.search(r"\[download\]\s+([0-9.]+)%", line)
            if match:
                percent = min(90, 10 + int(float(match.group(1)) * 0.8))
                with lock:
                    jobs[job_id]["progress"] = percent
        if process.wait() != 0 or not output.exists():
            raise RuntimeError(line.strip() if "line" in locals() else "yt-dlp failed without output.")
        with lock:
            jobs[job_id].update(status="completed", progress=100, message="Ready", download_url=f"/api/jobs/{job_id}/download", path=str(output), filename=f"{safe}.mp4")
    except Exception as exc:
        output.unlink(missing_ok=True)
        with lock:
            jobs[job_id].update(status="failed", progress=0, message=str(exc))


@app.get("/health")
def health():
    return {"status": "ok", "ffmpeg": bool(shutil.which("ffmpeg"))}


@app.post("/api/jobs", status_code=202)
def create_job(request: ClipRequest):
    start, end = to_seconds(request.start), to_seconds(request.end)
    if end <= start:
        raise HTTPException(400, "End time must be later than start time.")
    if end - start > MAX_DURATION:
        raise HTTPException(400, f"Clips are limited to {MAX_DURATION // 60} minutes.")
    job_id = uuid.uuid4().hex
    with lock:
        jobs[job_id] = {"status": "queued", "progress": 2, "message": "Queued", "created_at": time.time()}
    threading.Thread(target=process_job, args=(job_id, request), daemon=True).start()
    return {"job_id": job_id}


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    with lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(404, "Job not found.")
        return {key: value for key, value in job.items() if key not in {"path", "filename"}}


@app.get("/api/jobs/{job_id}/download")
def download(job_id: str):
    with lock:
        job = jobs.get(job_id)
    if not job or job.get("status") != "completed":
        raise HTTPException(404, "Clip not ready.")
    path = Path(job["path"])
    if not path.exists():
        raise HTTPException(410, "Clip expired.")
    return FileResponse(path, media_type="video/mp4", filename=job["filename"])
