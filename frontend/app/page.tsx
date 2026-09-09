"use client";

import {
  FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";

type Language = "en" | "fr";
type Status =
  | "idle"
  | "queued"
  | "processing"
  | "completed"
  | "failed";

type Job = {
  status: Status;
  progress?: number;
  message?: string;
  download_url?: string;
};

const copy = {
  en: {
    eyebrow: "Web edition",
    title: "Clip the moment you need.",
    subtitle:
      "Paste a video link, choose precise timestamps, and download an MP4 clip from any device.",
    accessCode: "Access code",
    accessPlaceholder: "Enter your private access code",
    accessHelp: "Provided by the application owner.",
    link: "YouTube URL",
    start: "Start time",
    end: "End time",
    filename: "File name",
    create: "Create clip",
    creating: "Creating your clip…",
    ready: "Your clip is ready",
    download: "Download MP4",
    connected: "Processor connected",
    disconnected: "Processor unavailable",
    legal: "Only process videos you own or are authorized to use.",
    helper: "Use HH:MM:SS — for example, 02:00:00.",
    errorTime: "Check the timestamps. The end time must be later than the start time.",
    errorUrl: "Enter a valid YouTube URL.",
    errorCode: "Enter the private access code.",
    errorAccess: "The access code is incorrect.",
    errorBusy: "The processor is busy. Please try again shortly.",
    errorBackend: "The processing service is unavailable. Please try again later.",
    errorDownload: "The clip could not be downloaded. Please create it again.",
  },
  fr: {
    eyebrow: "Édition web",
    title: "Découpez le moment qu’il vous faut.",
    subtitle:
      "Collez un lien vidéo, choisissez des horaires précis et téléchargez votre extrait MP4 depuis tout appareil.",
    accessCode: "Code d’accès",
    accessPlaceholder: "Entrez votre code d’accès privé",
    accessHelp: "Fourni par le propriétaire de l’application.",
    link: "Lien YouTube",
    start: "Heure de début",
    end: "Heure de fin",
    filename: "Nom du fichier",
    create: "Créer l’extrait",
    creating: "Création de votre extrait…",
    ready: "Votre extrait est prêt",
    download: "Télécharger le MP4",
    connected: "Processeur connecté",
    disconnected: "Processeur indisponible",
    legal:
      "Traitez uniquement les vidéos que vous possédez ou êtes autorisé à utiliser.",
    helper: "Utilisez HH:MM:SS — par exemple, 02:00:00.",
    errorTime:
      "Vérifiez les heures. La fin doit être postérieure au début.",
    errorUrl: "Entrez un lien YouTube valide.",
    errorCode: "Entrez le code d’accès privé.",
    errorAccess: "Le code d’accès est incorrect.",
    errorBusy:
      "Le processeur est occupé. Veuillez réessayer dans un instant.",
    errorBackend:
      "Le service de traitement est indisponible. Réessayez plus tard.",
    errorDownload:
      "Le téléchargement a échoué. Veuillez recréer l’extrait.",
  },
} as const;

const API = (
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://localhost:8000"
).replace(/\/$/, "");

function seconds(value: string): number | null {
  if (!/^\d{1,3}:\d{2}:\d{2}$/.test(value)) {
    return null;
  }

  const [hours, minutes, secs] = value.split(":").map(Number);

  if (minutes > 59 || secs > 59) {
    return null;
  }

  return hours * 3600 + minutes * 60 + secs;
}

function requestHeaders(accessCode: string) {
  return {
    "X-Access-Code": accessCode.trim(),
    "X-Pinggy-No-Screen": "AvoidTheProblem",
  };
}

async function errorDetail(response: Response): Promise<string> {
  try {
    const body = await response.json();
    return body.detail ?? "";
  } catch {
    return "";
  }
}

export default function Home() {
  const [language, setLanguage] = useState<Language>("en");
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [online, setOnline] = useState(false);
  const [accessCode, setAccessCode] = useState("");
  const [url, setUrl] = useState("");
  const [start, setStart] = useState("00:00:00");
  const [end, setEnd] = useState("00:01:00");
  const [filename, setFilename] = useState("youtube_clip");
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState("");
  const [downloadName, setDownloadName] = useState("youtube_clip.mp4");
  const [error, setError] = useState("");

  const t = useMemo(() => copy[language], [language]);
  const working = status === "queued" || status === "processing";

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const savedCode = sessionStorage.getItem("clipper-access-code");

    if (savedCode) {
      setAccessCode(savedCode);
    }

    fetch(`${API}/health`, {
      headers: {
        "X-Pinggy-No-Screen": "AvoidTheProblem",
      },
    })
      .then((response) => setOnline(response.ok))
      .catch(() => setOnline(false));
  }, []);

  async function pollJob(
    statusUrl: string,
    code: string,
  ): Promise<void> {
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const response = await fetch(`${API}${statusUrl}`, {
        headers: requestHeaders(code),
      });

      if (response.status === 401) {
        throw new Error("ACCESS");
      }

      if (!response.ok) {
        throw new Error("BACKEND");
      }

      const job: Job = await response.json();

      setStatus(job.status);
      setProgress(job.progress ?? 0);

      if (job.status === "completed" && job.download_url) {
        setDownloadUrl(`${API}${job.download_url}`);
        return;
      }

      if (job.status === "failed") {
        throw new Error(job.message || "BACKEND");
      }
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setDownloadUrl("");

    const code = accessCode.trim();
    const startSeconds = seconds(start);
    const endSeconds = seconds(end);

    if (!code) {
      setError(t.errorCode);
      return;
    }

    if (!/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url)) {
      setError(t.errorUrl);
      return;
    }

    if (
      startSeconds === null ||
      endSeconds === null ||
      endSeconds <= startSeconds
    ) {
      setError(t.errorTime);
      return;
    }

    sessionStorage.setItem("clipper-access-code", code);
    setDownloadName(`${filename || "youtube_clip"}.mp4`);
    setStatus("queued");
    setProgress(2);

    try {
      const response = await fetch(`${API}/api/jobs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...requestHeaders(code),
        },
        body: JSON.stringify({
          url,
          start,
          end,
          filename,
        }),
      });

      if (response.status === 401) {
        throw new Error("ACCESS");
      }

      if (response.status === 429) {
        throw new Error("BUSY");
      }

      if (!response.ok) {
        const detail = await errorDetail(response);
        throw new Error(detail || "BACKEND");
      }

      const result = await response.json();
      await pollJob(result.status_url, code);
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "BACKEND";

      setStatus("failed");

      if (message === "ACCESS") {
        setError(t.errorAccess);
      } else if (message === "BUSY") {
        setError(t.errorBusy);
      } else {
        setError(message === "BACKEND" ? t.errorBackend : message);
      }
    }
  }

  async function downloadClip(
    event: React.MouseEvent<HTMLAnchorElement>,
  ) {
    event.preventDefault();
    setError("");

    try {
      const response = await fetch(downloadUrl, {
        headers: requestHeaders(accessCode),
      });

      if (response.status === 401) {
        throw new Error("ACCESS");
      }

      if (!response.ok) {
        throw new Error("DOWNLOAD");
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");

      anchor.href = objectUrl;
      anchor.download = downloadName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();

      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      setDownloadUrl("");
      setStatus("idle");
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "DOWNLOAD";

      setError(
        message === "ACCESS"
          ? t.errorAccess
          : t.errorDownload,
      );
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="#top">
          <span className="mark">▶</span>
          <span>Clipper Pro</span>
        </a>

        <div className="actions">
          <button
            className="lang"
            type="button"
            onClick={() =>
              setLanguage(language === "en" ? "fr" : "en")
            }
          >
            {language === "en" ? "FR" : "EN"}
          </button>

          <button
            className="theme"
            type="button"
            aria-label="Change theme"
            onClick={() =>
              setTheme(theme === "dark" ? "light" : "dark")
            }
          >
            ☀
          </button>
        </div>
      </header>

      <section className="workspace" id="top">
        <div className="intro">
          <p className="eyebrow">
            <span />
            {t.eyebrow}
          </p>

          <h1>{t.title}</h1>
          <p className="subtitle">{t.subtitle}</p>

          <div className={`connection ${online ? "online" : ""}`}>
            <span />
            {online ? t.connected : t.disconnected}
          </div>
        </div>

        <form className="clip-card" onSubmit={submit}>
          <label>
            {t.accessCode}
            <input
              name="accessCode"
              type="password"
              autoComplete="current-password"
              placeholder={t.accessPlaceholder}
              value={accessCode}
              onChange={(event) => setAccessCode(event.target.value)}
              required
            />
            <small>{t.accessHelp}</small>
          </label>

          <label>
            {t.link}
            <input
              name="url"
              type="url"
              placeholder="https://youtube.com/watch?v=..."
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              required
            />
          </label>

          <div className="time-grid">
            <label>
              {t.start}
              <input
                name="start"
                value={start}
                onChange={(event) => setStart(event.target.value)}
                required
              />
              <small>{t.helper}</small>
            </label>

            <label>
              {t.end}
              <input
                name="end"
                value={end}
                onChange={(event) => setEnd(event.target.value)}
                required
              />
            </label>
          </div>

          <label>
            {t.filename}
            <div className="filename">
              <input
                name="filename"
                value={filename}
                onChange={(event) => setFilename(event.target.value)}
                required
              />
              <span>.mp4</span>
            </div>
          </label>

          <button
            className="primary"
            type="submit"
            disabled={working}
          >
            <span>{working ? t.creating : t.create}</span>
            <span>➜</span>
          </button>

          {working && (
            <div className="status">
              <div>
                <span>{t.creating}</span>
                <strong>{progress}%</strong>
              </div>
              <div className="progress">
                <span style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {status === "completed" && downloadUrl && (
            <div className="result success">
              <span>✓</span>
              <span>{t.ready}</span>
              <a href={downloadUrl} onClick={downloadClip}>
                {t.download}
              </a>
            </div>
          )}

          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}

          <p className="legal">ⓘ {t.legal}</p>
        </form>
      </section>

      <footer>
        <span>Python YouTube Clipper Pro</span>
        <span>•</span>
        <span>Netlify + Cloud backend</span>
      </footer>
    </main>
  );
}