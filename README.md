# YouTube Clipper Pro Web

This project has two deployable parts:

- `frontend/`: bilingual, mobile-friendly PWA prepared for Netlify
- `render-backend/`: FastAPI, yt-dlp and FFmpeg processing service

Deploy the Render backend first, then place its public URL in the frontend's
`NEXT_PUBLIC_API_BASE_URL` environment variable. Set the backend's
`FRONTEND_ORIGIN` to the exact Netlify site URL.

Only process videos you own or are authorized to use. Temporary files are
deleted automatically.
