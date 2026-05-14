"use client";

import {
  useEffect,
  useState,
  useRef,
} from "react";
import { Download, Terminal, Activity, ArrowRight, Settings2 } from "lucide-react";
import { toast } from "sonner";
import LogViewer from "@/components/LogViewer";

type QualityOption = {
  value: "360" | "480" | "720";
  label: string;
  tagline: string;
  note: string;
};

type DownloadJob = {
  id: string;
  url: string;
  quality: QualityOption["value"];
  shutdownAfterDownload: boolean;
  status: "queued" | "waiting" | "running" | "succeeded" | "failed";
  createdAt: string;
  scheduledFor: string;
  startedAt: string | null;
  finishedAt: string | null;
  outputDirectory: string;
  logFile: string;
  commandPreview: string;
  errorMessage: string | null;
};

const qualityOptions: QualityOption[] = [
  { value: "360", label: "360p", tagline: "Data Saver", note: "Smallest size for tight bandwidth limits." },
  { value: "480", label: "480p", tagline: "Balanced", note: "Standard night mode reliable fallback." },
  { value: "720", label: "720p", tagline: "Max HD", note: "Crisper output while keeping caps in check." },
];

function pad(value: number) { return value.toString().padStart(2, "0"); }
function formatClock(date: Date) { return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`; }
function formatDateTime(value: string | null) {
  if (!value) return "Pending";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function getWindowState(now: Date) {
  const hour = now.getHours();
  const inWindow = hour >= 23 || hour <= 5;
  if (inWindow) return { inWindow, label: "Lane Open" };
  const nextWindow = new Date(now);
  nextWindow.setHours(23, 0, 0, 0);
  return { inWindow, label: `Standby until ${formatClock(nextWindow)}` };
}

function describeJobStatus(job: DownloadJob) {
  if (job.status === "waiting") return `Wait ${formatDateTime(job.scheduledFor)}`;
  if (job.status === "running") return `Run ${formatDateTime(job.startedAt)}`;
  if (job.status === "succeeded") return `Done ${formatDateTime(job.finishedAt)}`;
  if (job.status === "failed") return "Failed.";
  return `Queued ${formatDateTime(job.createdAt)}`;
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [quality, setQuality] = useState<QualityOption["value"]>("480");
  const [shutdownAfterDownload, setShutdownAfterDownload] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeLogTail, setActiveLogTail] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [didHydrate, setDidHydrate] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const urlInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => setNow(new Date()), 0);
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => { window.clearTimeout(initialTimer); window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("url")) setUrl(params.get("url")!);
    const q = params.get("quality");
    if (q === "360" || q === "480" || q === "720") setQuality(q);
    if (params.get("shutdown") === "1") setShutdownAfterDownload(true);
    if (params.get("job")) setActiveJobId(params.get("job"));
    setDidHydrate(true);
  }, []);

  useEffect(() => {
    if (!didHydrate) return;
    const params = new URLSearchParams(window.location.search);
    if (url.trim()) params.set("url", url.trim()); else params.delete("url");
    params.set("quality", quality);
    if (shutdownAfterDownload) params.set("shutdown", "1"); else params.delete("shutdown");
    if (activeJobId) params.set("job", activeJobId); else params.delete("job");
    const nextQuery = params.toString();
    window.history.replaceState(null, "", nextQuery ? `/?${nextQuery}` : "/");
  }, [activeJobId, didHydrate, quality, shutdownAfterDownload, url]);

  useEffect(() => {
    const es = new EventSource("/api/downloads/stream");
    let isMounted = true;
    
    es.onmessage = (event) => {
      if (!isMounted) return;
      try {
        const data = JSON.parse(event.data);
        if (data.jobs) {
          setJobs(currentJobs => {
            data.jobs.forEach((newJob: DownloadJob) => {
               const oldJob = currentJobs.find(j => j.id === newJob.id);
               if (oldJob && oldJob.status !== newJob.status) {
                 if (newJob.status === 'succeeded') toast.success(`Job completed!`, { description: newJob.url });
                 if (newJob.status === 'failed') toast.error(`Job failed!`, { description: newJob.errorMessage || newJob.url });
               }
            });
            return data.jobs;
          });
          
          setActiveJobId((current) => {
            if (!current && data.jobs.length > 0) return data.jobs[0].id;
            if (current && !data.jobs.some((j: DownloadJob) => j.id === current)) return data.jobs[0]?.id ?? null;
            return current;
          });
        }
      } catch {}
    };

    return () => {
      isMounted = false;
      es.close();
    };
  }, []);

  useEffect(() => {
    if (!activeJobId) {
      setActiveLogTail("");
      return;
    }
    
    let isMounted = true;
    const es = new EventSource(`/api/downloads/${activeJobId}/stream`);
    
    es.addEventListener("init", (event) => {
      if (!isMounted) return;
      try {
        const data = JSON.parse(event.data);
        setActiveLogTail(data.text || "");
      } catch {}
    });

    es.addEventListener("chunk", (event) => {
      if (!isMounted) return;
      try {
        const data = JSON.parse(event.data);
        setActiveLogTail(prev => prev + (data.text || ""));
      } catch {}
    });

    return () => {
      isMounted = false;
      es.close();
    };
  }, [activeJobId]);

  const windowState = now ? getWindowState(now) : null;
  const activeJob = jobs.find((job) => job.id === activeJobId) ?? null;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedUrl = url.trim();
    setUrl(trimmedUrl);
    setIsSubmitting(true);
    setUrlError(null);
    setSubmitError(null);

    try {
      if (!trimmedUrl) { setUrlError("Required."); urlInputRef.current?.focus(); return; }
      try { new URL(trimmedUrl); } catch { setUrlError("Invalid format."); urlInputRef.current?.focus(); return; }
      const response = await fetch("/api/downloads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmedUrl, quality, shutdownAfterDownload }),
      });
      const data = await response.json() as { error?: string; job?: DownloadJob; };
      if (!response.ok || !data.job) { setSubmitError(data.error ?? "Failed via API."); return; }
      setActiveJobId(data.job.id);
      setUrl("");
      toast.info("Job queued successfully", { description: trimmedUrl });
    } catch {
      setSubmitError("API unreachable.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden font-sans flex flex-col">
      {/* Nav */}
      <nav className="fixed top-0 z-50 w-full bg-background border-b border-border px-6">
        <div className="mx-auto flex h-[56px] max-w-[1200px] items-center justify-between">
          <div className="flex items-center gap-2 -ml-0.5">
            <Download className="w-4 h-4 text-primary" />
            <span className="text-[14px] font-bold text-foreground tracking-[0.08em] uppercase">Mbembembe</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-[13px] text-muted-foreground font-mono">{now ? formatClock(now) : "--:--:--"}</span>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${windowState?.inWindow ? 'bg-success' : 'bg-warning'}`} />
              <span className="text-[13px] text-foreground font-medium uppercase tracking-widest">{windowState?.label ?? "Wait"}</span>
            </div>
          </div>
        </div>
      </nav>

      <div className="flex-1 max-w-[1200px] w-full mx-auto px-6 pt-24 pb-20 grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-12">
        {/* LEFT COLUMN - FORMS */}
        <div className="space-y-12">
          
          <div>
            <p className="text-[13px] uppercase tracking-[0.15em] text-muted-foreground mb-4">Command Center</p>
            <h1 className="text-[clamp(1.8rem,3vw,2.5rem)] font-[500] tracking-[-0.03em] text-foreground leading-[1.15]">
              Automate downloads.<br />Let the night run.
            </h1>
          </div>

          <section>
            <h2 className="text-[14px] font-medium text-foreground mb-3 flex items-center gap-2">
              <Settings2 className="w-4 h-4 text-muted-foreground" /> Configuration
            </h2>
            
            <form onSubmit={handleSubmit} className="border border-border bg-card/10 p-6 space-y-6 rounded-md">
                
                {/* URL Input */}
                <div className="space-y-2">
                  <label className="text-[13px] font-medium text-foreground">Video Address</label>
                  <input
                    ref={urlInputRef}
                    type="url"
                    placeholder="https://youtube.com/watch?v=..."
                    className="w-full h-10 border border-border rounded bg-background px-3 text-[14px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-foreground/50 transition-colors"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                  {urlError && <p className="text-[13px] text-destructive mt-1">{urlError}</p>}
                </div>

                {/* Quality Options */}
                <div className="space-y-3">
                  <label className="text-[13px] font-medium text-foreground">Quality Limit</label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {qualityOptions.map(opt => (
                      <label key={opt.value} className={`relative flex flex-col items-start p-3 border rounded cursor-pointer transition-colors ${quality === opt.value ? 'bg-primary/5 border-primary/50' : 'bg-background border-border hover:border-foreground/30'}`}>
                        <input type="radio" className="sr-only" checked={quality === opt.value} onChange={() => setQuality(opt.value)} />
                        <span className="text-[14px] font-medium text-foreground mb-1">{opt.label}</span>
                        <span className="text-[12px] text-muted-foreground leading-tight">{opt.tagline}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Shutdown Switch */}
                <div className="flex items-center justify-between pt-4 border-t border-border">
                  <div>
                    <h3 className="text-[13px] font-medium text-foreground">Post-Job Shutdown</h3>
                    <p className="text-[12px] text-muted-foreground">Power down host machine gracefully</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShutdownAfterDownload(!shutdownAfterDownload)}
                    className={`w-9 h-5 rounded-full relative transition-colors ${shutdownAfterDownload ? 'bg-success/80' : 'bg-muted-foreground/30'}`}
                  >
                    <span className={`block w-3.5 h-3.5 bg-background rounded-full absolute top-[3px] transition-transform ${shutdownAfterDownload ? 'left-[19px]' : 'left-[3px]'}`} />
                  </button>
                </div>

                {/* Submit Action */}
                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 text-[14px] font-medium bg-foreground text-background rounded transition-all hover:bg-foreground/90 disabled:opacity-50"
                  >
                    {isSubmitting ? "Enqueuing..." : "Start Download Job"}
                    <ArrowRight className="w-4 h-4" />
                  </button>
                  {submitError && <p className="text-[13px] text-destructive text-center mt-3">{submitError}</p>}
                </div>
            </form>
          </section>
        </div>

        {/* RIGHT COLUMN - LOGS */}
        <div className="flex flex-col space-y-6 h-[70vh] lg:h-auto">
          
          {/* Scrollable Log Output */}
          <LogViewer logs={activeLogTail.split("\n").filter(line => line.length > 0)} />

          {/* Queue List */}
          <section className="border border-border rounded-md overflow-hidden bg-card/10">
            <div className="px-4 py-3 border-b border-border bg-card flex items-center justify-between">
              <span className="text-[13px] font-medium text-foreground tracking-wide uppercase">Execution Queue</span>
              <span className="text-[12px] text-muted-foreground">{jobs.length} total</span>
            </div>
            
            <div className="max-h-[220px] overflow-y-auto bg-background divide-y divide-border">
              {jobs.length === 0 ? (
                <div className="p-6 text-center text-[13px] text-muted-foreground bg-card/10">Queue is empty.</div>
              ) : (
                jobs.map(job => (
                  <button 
                    key={job.id} 
                    onClick={() => setActiveJobId(job.id)}
                    className={`w-full text-left px-4 py-3 flex items-center justify-between transition-colors ${activeJobId === job.id ? 'bg-primary/5 border-l-2 border-l-primary' : 'hover:bg-muted/30 border-l-2 border-l-transparent'}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-1.5 h-1.5 rounded-full ${job.status === 'succeeded' ? 'bg-success' : job.status === 'failed' ? 'bg-destructive' : job.status === 'running' ? 'bg-info' : 'bg-warning'}`} />
                      <div>
                        <p className="text-[13px] font-medium text-foreground leading-none">{job.quality}p</p>
                        <p className="text-[11px] text-muted-foreground mt-1 truncate max-w-[160px] md:max-w-[200px]" title={job.url}>{job.url}</p>
                      </div>
                    </div>
                    <span className="text-[11px] font-mono text-muted-foreground/80">{describeJobStatus(job)}</span>
                  </button>
                ))
              )}
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
