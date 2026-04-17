import { createWriteStream, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

export const systemEmitter = new EventEmitter();

export type DownloadQuality = "360" | "480" | "720";
export type DownloadStatus =
  | "queued"
  | "waiting"
  | "running"
  | "succeeded"
  | "failed";

export type DownloadJobSnapshot = {
  id: string;
  url: string;
  quality: DownloadQuality;
  shutdownAfterDownload: boolean;
  status: DownloadStatus;
  createdAt: string;
  scheduledFor: string;
  startedAt: string | null;
  finishedAt: string | null;
  outputDirectory: string;
  logFile: string;
  commandPreview: string;
  errorMessage: string | null;
};

type DownloadJobRecord = DownloadJobSnapshot & {
  runnerStarted: boolean;
};

const MBEMBEMBE_START_HOUR = 23;
const MBEMBEMBE_END_HOUR = 5;
const POLL_INTERVAL_MS = 30_000;
const SUBTITLE_LANGUAGES = "en";
const JS_RUNTIMES = "node";
const OUTPUT_TEMPLATE =
  "%(playlist_title,Unknown)s/%(playlist_index,1)s - %(title)s.%(ext)s";

const DB_FILE = join(process.cwd(), "downloads", "jobs.json");
let jobsCache: Map<string, DownloadJobRecord> | null = null;

function getState() {
  if (jobsCache) return { jobs: jobsCache };

  try {
    const raw = readFileSync(DB_FILE, "utf8");
    jobsCache = new Map(JSON.parse(raw));

    for (const [id, job] of jobsCache.entries()) {
      if (job.status === "running") {
        job.status = "failed";
        job.errorMessage = "Server restarted unexpectedly.";
        job.finishedAt = new Date().toISOString();
      }
      job.runnerStarted = false;
      if (job.status === "queued" || job.status === "waiting") {
        void runDownload(id).catch(() => {});
      }
    }
  } catch {
    jobsCache = new Map();
  }

  return { jobs: jobsCache };
}

function isMbembembeHours(now: Date) {
  const hour = now.getHours();
  return hour >= MBEMBEMBE_START_HOUR || hour <= MBEMBEMBE_END_HOUR;
}

function getNextWindowStart(now: Date) {
  const next = new Date(now);

  if (isMbembembeHours(now)) {
    return next;
  }

  next.setHours(MBEMBEMBE_START_HOUR, 0, 0, 0);
  return next;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildCommandPreview(quality: DownloadQuality) {
  return [
    'yt-dlp -f "bestvideo[height<=',
    quality,
    ']+bestaudio/best[height<=',
    quality,
    ']" --yes-playlist --continue --no-part --retries 99 --fragment-retries 99 --write-subs --write-auto-subs --sub-langs "',
    SUBTITLE_LANGUAGES,
    '" --js-runtimes "',
    JS_RUNTIMES,
    '" --embed-subs --merge-output-format mkv --no-mtime -o "',
    OUTPUT_TEMPLATE,
    '"',
  ].join("");
}

async function ensureDirectories() {
  const outputDirectory = join(process.cwd(), "downloads");
  const logDirectory = join(process.cwd(), "download_logs");

  await mkdir(outputDirectory, { recursive: true });
  await mkdir(logDirectory, { recursive: true });

  return { outputDirectory, logDirectory };
}

function getJobsSorted() {
  const { jobs } = getState();
  return [...jobs.values()].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
}

function updateJob(id: string, patch: Partial<DownloadJobRecord>) {
  const { jobs } = getState();
  const existing = jobs.get(id);

  if (!existing) {
    return null;
  }

  const updated = {
    ...existing,
    ...patch,
  };

  jobs.set(id, updated);
  
  // Persist to disk asynchronously
  void mkdir(join(process.cwd(), "downloads"), { recursive: true })
    .then(() => writeFile(DB_FILE, JSON.stringify(Array.from(jobs.entries())), "utf8"))
    .catch(() => {});

  systemEmitter.emit(`job-${id}`, updated);
  systemEmitter.emit('job-updated', updated);

  return updated;
}

async function appendLogLine(logFile: string, line: string) {
  await mkdir(dirname(logFile), { recursive: true }).catch(() => undefined);

  return new Promise<void>((resolve, reject) => {
    const stream = createWriteStream(logFile, { flags: "a" });
    stream.on("error", reject);
    stream.end(`${line}\n`, () => resolve());
  });
}

async function waitForWindow(job: DownloadJobRecord) {
  let current = job;

  while (!isMbembembeHours(new Date())) {
    const scheduledFor = getNextWindowStart(new Date()).toISOString();
    current =
      updateJob(job.id, {
        status: "waiting",
        scheduledFor,
      }) ?? current;

    await appendLogLine(
      current.logFile,
      `[${new Date().toISOString()}] Waiting for Mbembembe hours. Next window starts at ${scheduledFor}.`,
    );
    await sleep(POLL_INTERVAL_MS);
  }

  return current;
}

async function requestShutdown(logFile: string) {
  if (process.platform !== "win32") {
    await appendLogLine(
      logFile,
      `[${new Date().toISOString()}] Shutdown requested, but automatic shutdown is only implemented for Windows.`,
    );
    return;
  }

  await appendLogLine(
    logFile,
    `[${new Date().toISOString()}] Scheduling Windows shutdown for 60 seconds from now.`,
  );

  const child = spawn("shutdown", ["/s", "/t", "60"], {
    detached: true,
    stdio: "ignore",
  });

  child.unref();
}

async function runDownload(jobId: string) {
  let job = getState().jobs.get(jobId);

  if (!job || job.runnerStarted) {
    return;
  }

  job = updateJob(jobId, { runnerStarted: true }) ?? job;
  await appendLogLine(
    job.logFile,
    `[${new Date().toISOString()}] Job accepted for ${job.url}`,
  );

  if (!isMbembembeHours(new Date())) {
    job = await waitForWindow(job);
  }

  job =
    updateJob(jobId, {
      status: "running",
      startedAt: new Date().toISOString(),
      errorMessage: null,
    }) ?? job;

  await appendLogLine(
    job.logFile,
    `[${new Date().toISOString()}] Starting yt-dlp with quality cap ${job.quality}p.`,
  );

  const logStream = createWriteStream(job.logFile, { flags: "a" });

  const args = [
    "-f",
    `bestvideo[height<=${job.quality}]+bestaudio/best[height<=${job.quality}]`,
    "--yes-playlist",
    "--continue",
    "--no-part",
    "--retries",
    "99",
    "--fragment-retries",
    "99",
    "--write-subs",
    "--write-auto-subs",
    "--sub-langs",
    SUBTITLE_LANGUAGES,
    "--js-runtimes",
    JS_RUNTIMES,
    "--embed-subs",
    "--merge-output-format",
    "mkv",
    "--no-mtime",
    "-o",
    OUTPUT_TEMPLATE,
    job.url,
  ];

  await new Promise<void>((resolve) => {
    const child = spawn("yt-dlp", args, {
      cwd: job.outputDirectory,
      windowsHide: true,
    });

    child.stdout.on("data", (chunk) => {
      logStream.write(chunk);
      systemEmitter.emit(`log-${jobId}`, chunk.toString("utf8"));
    });

    child.stderr.on("data", (chunk) => {
      logStream.write(chunk);
      systemEmitter.emit(`log-${jobId}`, chunk.toString("utf8"));
    });

    child.on("error", async (error) => {
      const msg = `${error.message}\n`;
      logStream.write(msg);
      systemEmitter.emit(`log-${jobId}`, msg);
      logStream.end();

      updateJob(jobId, {
        status: "failed",
        finishedAt: new Date().toISOString(),
        errorMessage: error.message,
      });
      await appendLogLine(
        job.logFile,
        `[${new Date().toISOString()}] Download process failed to start.`,
      );
      resolve();
    });

    child.on("close", async (code) => {
      const closeMsg = `\nProcess exited with code ${code ?? "unknown"}.\n`;
      logStream.write(closeMsg);
      systemEmitter.emit(`log-${jobId}`, closeMsg);
      logStream.end();

      const succeeded = code === 0;
      updateJob(jobId, {
        status: succeeded ? "succeeded" : "failed",
        finishedAt: new Date().toISOString(),
        errorMessage: succeeded ? null : `yt-dlp exited with code ${code ?? "unknown"}.`,
      });

      await appendLogLine(
        job.logFile,
        `[${new Date().toISOString()}] Download ${
          succeeded ? "completed successfully" : "failed"
        }.`,
      );

      if (succeeded && job.shutdownAfterDownload) {
        await requestShutdown(job.logFile);
      }

      resolve();
    });
  });
}

export async function createDownloadJob(input: {
  url: string;
  quality: DownloadQuality;
  shutdownAfterDownload: boolean;
}) {
  const { outputDirectory, logDirectory } = await ensureDirectories();
  const id = randomUUID();
  const now = new Date();
  const logFile = join(logDirectory, `${id}.log`);

  const job: DownloadJobRecord = {
    id,
    url: input.url,
    quality: input.quality,
    shutdownAfterDownload: input.shutdownAfterDownload,
    status: isMbembembeHours(now) ? "queued" : "waiting",
    createdAt: now.toISOString(),
    scheduledFor: getNextWindowStart(now).toISOString(),
    startedAt: null,
    finishedAt: null,
    outputDirectory,
    logFile,
    commandPreview: buildCommandPreview(input.quality),
    errorMessage: null,
    runnerStarted: false,
  };

  getState().jobs.set(id, job);
  void runDownload(id);

  return toSnapshot(job);
}

function toSnapshot(job: DownloadJobRecord): DownloadJobSnapshot {
  const { runnerStarted, ...snapshot } = job;
  void runnerStarted;
  return snapshot;
}

export function listDownloadJobs() {
  return getJobsSorted().map(toSnapshot);
}

export function getDownloadJob(id: string) {
  const job = getState().jobs.get(id);
  return job ? toSnapshot(job) : null;
}

export async function readJobLogTail(id: string, maxLines = 40) {
  const job = getState().jobs.get(id);

  if (!job) {
    return null;
  }

  try {
    const contents = await readFile(job.logFile, "utf8");
    return contents.split(/\r?\n/).slice(-maxLines).join("\n");
  } catch {
    return "";
  }
}
