"use client";
import { FormEvent, useEffect, useMemo, useState } from "react";
type Language = "en" | "fr";
type Job = { status: "queued" | "processing" | "completed" | "failed"; progress?: number; message?: string; download_url?: string };
const copy = {
  en: { eyebrow:"Web edition", title:"Clip the moment you need.", subtitle:"Paste a video link, choose precise timestamps, and download an MP4 clip from any device.", link:"YouTube URL", start:"Start time", end:"End time", filename:"File name", create:"Create clip", creating:"Creating your clip…", ready:"Your clip is ready", download:"Download MP4", connected:"Processor connected", disconnected:"Processor unavailable", helper:"Use HH:MM:SS — for example, 02:00:00.", legal:"Only process videos you own or are authorized to use.", errorTime:"Check the timestamps. The end time must be later than the start time.", errorUrl:"Enter a valid YouTube URL.", errorBackend:"The processing service is unavailable. Please try again later." },
  fr: { eyebrow:"Version Web", title:"Découpez le moment qu’il vous faut.", subtitle:"Collez un lien vidéo, choisissez des heures précises et téléchargez votre extrait MP4 depuis tout appareil.", link:"Lien YouTube", start:"Heure de début", end:"Heure de fin", filename:"Nom du fichier", create:"Créer l’extrait", creating:"Création de votre extrait…", ready:"Votre extrait est prêt", download:"Télécharger le MP4", connected:"Processeur connecté", disconnected:"Processeur indisponible", helper:"Utilisez HH:MM:SS — par exemple, 02:00:00.", legal:"Traitez uniquement les vidéos que vous possédez ou êtes autorisé à utiliser.", errorTime:"Vérifiez les heures. La fin doit être postérieure au début.", errorUrl:"Entrez un lien YouTube valide.", errorBackend:"Le service de traitement est indisponible. Réessayez plus tard." }
};
const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
function seconds(value:string) { if (!/^\d{1,3}:\d{2}:\d{2}$/.test(value)) return null; const [h,m,s]=value.split(":").map(Number); return m>59||s>59?null:h*3600+m*60+s; }
export default function Home() {
  const [language,setLanguage]=useState<Language>("en"), [theme,setTheme]=useState<"light"|"dark">("dark"), [online,setOnline]=useState(false);
  const [status,setStatus]=useState<"idle"|"working"|"ready"|"error">("idle"), [error,setError]=useState(""), [progress,setProgress]=useState(0), [download,setDownload]=useState("");
  const t=copy[language];
  useEffect(()=>{ document.documentElement.dataset.theme=theme; },[theme]);
  useEffect(()=>{ fetch(`${API}/health`).then(r=>setOnline(r.ok)).catch(()=>setOnline(false)); },[]);
  const statusText=useMemo(()=>online?t.connected:t.disconnected,[online,t]);
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setDownload(""); const data=new FormData(event.currentTarget);
    const url=String(data.get("url")??""), start=String(data.get("start")??""), end=String(data.get("end")??""); const a=seconds(start), b=seconds(end);
    if(!/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url)){setError(t.errorUrl);setStatus("error");return;}
    if(a===null||b===null||b<=a){setError(t.errorTime);setStatus("error");return;}
    if(!online){setError(t.errorBackend);setStatus("error");return;}
    setStatus("working");setProgress(4);
    try { const response=await fetch(`${API}/api/jobs`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(Object.fromEntries(data))}); if(!response.ok)throw new Error(); const {job_id}=await response.json();
      const poll=window.setInterval(async()=>{try{const jr=await fetch(`${API}/api/jobs/${job_id}`), job:Job=await jr.json();setProgress(job.progress??8);if(job.status==="completed"){clearInterval(poll);setDownload(`${API}${job.download_url}`);setStatus("ready");setProgress(100);}else if(job.status==="failed"){clearInterval(poll);setError(job.message??t.errorBackend);setStatus("error");}}catch{clearInterval(poll);setError(t.errorBackend);setStatus("error");}},1800);
    } catch { setError(t.errorBackend);setStatus("error"); }
  }
  return <main className="shell"><header className="topbar"><a className="brand" href="#top"><span className="mark">▶</span><span>Clipper <b>Pro</b></span></a><div className="actions"><button className="language" onClick={()=>setLanguage(language==="en"?"fr":"en")}>{language==="en"?"FR":"EN"}</button><button className="theme" onClick={()=>setTheme(theme==="dark"?"light":"dark")} aria-label="Change theme">{theme==="dark"?"☀":"☾"}</button></div></header>
    <section className="workspace" id="top"><div className="intro"><p className="eyebrow"><span/>{t.eyebrow}</p><h1>{t.title}</h1><p className="subtitle">{t.subtitle}</p><div className={`connection ${online?"on":"off"}`}><i/>{statusText}</div></div>
    <form className="clip-card" onSubmit={submit}><label>{t.link}<input name="url" type="url" placeholder="https://youtube.com/watch?v=…" required/></label><div className="time-grid"><label>{t.start}<input name="start" defaultValue="00:00:00" inputMode="numeric" required/></label><label>{t.end}<input name="end" defaultValue="00:01:00" inputMode="numeric" required/></label></div><p className="hint">{t.helper}</p><label>{t.filename}<div className="filename"><input name="filename" defaultValue="youtube_clip" required/><span>.mp4</span></div></label><button className="primary" disabled={status==="working"}>{status==="working"?t.creating:t.create}<span>→</span></button>
    {status==="working"&&<div className="result"><div className="result-row"><span>{t.creating}</span><b>{progress}%</b></div><progress max="100" value={progress}/></div>}{status==="ready"&&<div className="result success"><div><small>✓</small><span>{t.ready}</span></div><a href={download}>{t.download}</a></div>}{status==="error"&&error&&<div className="error" role="alert">{error}</div>}<p className="legal">ⓘ {t.legal}</p></form></section><footer>Python YouTube Clipper Pro <span>•</span> Netlify + Render</footer></main>;
}
