import { listDownloadJobs, systemEmitter } from "@/lib/downloader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    start(controller) {
      function send(data: any) {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch {}
      }

      send({ jobs: listDownloadJobs() });

      function onUpdate() {
        send({ jobs: listDownloadJobs() });
      }

      systemEmitter.on("job-updated", onUpdate);

      const keepAlive = setInterval(() => {
        try { controller.enqueue(encoder.encode(': keepalive\n\n')); } catch {}
      }, 15000);

      request.signal.addEventListener("abort", () => {
        systemEmitter.off("job-updated", onUpdate);
        clearInterval(keepAlive);
      });
    }
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    },
  });
}
