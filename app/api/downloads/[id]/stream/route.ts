import { getDownloadJob, readJobLogTail, systemEmitter } from "@/lib/downloader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: { id: string } }) {
  const id = context.params.id;
  const job = getDownloadJob(id);

  if (!job) {
    return new Response("Not found", { status: 404 });
  }

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      function sendChunk(line: string) {
        try { controller.enqueue(encoder.encode(`event: chunk\ndata: ${JSON.stringify({ text: line })}\n\n`)); } catch {}
      }

      function sendInit(line: string) {
        try { controller.enqueue(encoder.encode(`event: init\ndata: ${JSON.stringify({ text: line })}\n\n`)); } catch {}
      }

      const initialTail = await readJobLogTail(id, 100);
      if (initialTail) sendInit(initialTail);

      function onLog(chunk: string) {
        sendChunk(chunk);
      }

      systemEmitter.on(`log-${id}`, onLog);

      const keepAlive = setInterval(() => {
        try { controller.enqueue(encoder.encode(': keepalive\n\n')); } catch {}
      }, 15000);

      request.signal.addEventListener("abort", () => {
        systemEmitter.off(`log-${id}`, onLog);
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
