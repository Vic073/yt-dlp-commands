"use client";

import React, { useEffect, useRef } from "react";
import { Terminal } from "lucide-react";

interface LogViewerProps {
  logs: string[];
}

/**
 * LogViewer component displays a list of logs in a fixed-height terminal-like container.
 * Features:
 * - Fixed height of 400px as per requirements.
 * - Automatic scrolling to bottom when new logs are added.
 * - Manual vertical scrolling enabled.
 * - Styled with Tailwind CSS 4.
 */
const LogViewer: React.FC<LogViewerProps> = ({ logs }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Requirement 3: Use useRef and useEffect to snap/smoothly scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="flex flex-col w-full border border-border rounded-md overflow-hidden bg-card/10 transition-all duration-300">
      {/* Terminal Header */}
      <div className="px-4 py-3 border-b border-border bg-card flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Terminal className="w-4 h-4 text-muted-foreground" />
          <span className="text-[13px] font-medium text-foreground tracking-wide uppercase">Runtime Log</span>
        </div>
        <div className="flex items-center gap-2">
           <span className="text-[11px] font-mono text-muted-foreground bg-muted/20 px-2 py-0.5 rounded border border-border">
             {logs.length} entries
           </span>
        </div>
      </div>

      {/* Log Container */}
      {/* Requirement 1: Fixed height h-[400px] */}
      {/* Requirement 2: Enable vertical scrolling overflow-y-auto */}
      <div
        ref={scrollRef}
        className="h-[400px] overflow-y-auto bg-[#0a0a0c] p-4 font-mono text-[12px] leading-[1.6] scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent"
      >
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground/50 gap-2">
            <Terminal size={20} />
            <p className="text-[12px] italic">Standby... Terminal output will connect when a job is selected.</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {logs.map((log, index) => (
              <div key={index} className="flex gap-4 group hover:bg-white/5 rounded px-1 -mx-1 transition-colors">
                <span className="text-muted-foreground/30 select-none min-w-[2.5rem] text-right tabular-nums">
                  {index + 1}
                </span>
                <span className="text-muted-foreground break-all whitespace-pre-wrap">
                  {log}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="px-4 py-1.5 bg-card/30 border-t border-border flex justify-end">
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-mono uppercase tracking-wider">
          <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
          Live Output
        </div>
      </div>
    </div>
  );
};

export default LogViewer;
