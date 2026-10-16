import {
  ActivityIcon,
  AlertCircleIcon,
  BotIcon,
  CheckIcon,
  ClockIcon,
  CopyIcon,
  ExternalLinkIcon,
  FolderIcon,
  NetworkIcon,
  PlayIcon,
  RefreshCwIcon,
  SendIcon,
  ServerIcon,
  SparklesIcon,
  StethoscopeIcon,
  TerminalIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
  WorkspaceBreadcrumbText,
} from "../WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";

export interface AdapterInfo {
  instanceId: string;
  sessionId: string;
  projectRoot: string;
  host: string;
  port: number;
  card: string;
  harness: string;
  updated: number;
  working: boolean;
  status: string;
}

export interface HarnessSession {
  id: string;
  slug: string;
  title: string;
  directory: string;
  updated: number;
  harness: string;
  host: string;
  status: string;
  working: boolean;
  tui: boolean;
  detail: string;
  adapter?: AdapterInfo;
  attach?: string;
}

export interface PeerInfo {
  origin: string;
  auth_scheme: string;
  credential?: string;
}

export interface FleetState {
  sessions: HarnessSession[];
  orphans: AdapterInfo[];
  peers: PeerInfo[];
}

function getCandidateUrls(path: string): string[] {
  const urls: string[] = [];
  if (typeof window !== "undefined" && window.location.hostname) {
    urls.push(`http://${window.location.hostname}:9090${path}`);
  }
  urls.push(`http://127.0.0.1:9090${path}`);
  urls.push(`http://localhost:9090${path}`);
  return Array.from(new Set(urls));
}

async function fetchFromManager<T>(path: string, options?: RequestInit): Promise<T> {
  const urls = getCandidateUrls(path);
  let lastError: Error | null = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, options);
      if (res.ok) {
        return (await res.json()) as T;
      }
      lastError = new Error(`HTTP ${res.status}: ${res.statusText}`);
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastError ?? new Error("Unable to connect to Harness Manager on port 9090");
}

function formatTimeAgo(timestampMs: number | undefined): string {
  if (!timestampMs) return "Unknown";
  const now = Date.now();
  const diffSec = Math.floor(Math.max(0, now - timestampMs) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export function HarnessesPage() {
  const [state, setState] = useState<FleetState | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [steerInputs, setSteerInputs] = useState<Record<string, string>>({});
  const [sendingPorts, setSendingPorts] = useState<Record<number, boolean>>({});

  const fetchState = useCallback(async () => {
    try {
      const data = await fetchFromManager<FleetState>("/api/state");
      setState(data);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchState();
    const interval = setInterval(() => {
      void fetchState();
    }, 4000);
    return () => clearInterval(interval);
  }, [fetchState]);

  const copyToClipboard = useCallback(async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      // ignore clipboard error
    }
  }, []);

  const handleDoctor = useCallback(
    async (sessionId: string, host: string) => {
      try {
        setActionNotice(`Running Fleet Doctor on ${sessionId}...`);
        const data = await fetchFromManager<{ ok: boolean; healed?: boolean; detail?: string }>(
          "/api/doctor",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: sessionId, host }),
          },
        );
        if (data.ok) {
          setActionNotice(
            `Doctor: ${data.healed ? "Healed stuck run" : "Session healthy"} (${data.detail || ""})`,
          );
        } else {
          setActionNotice(`Doctor check completed: ${JSON.stringify(data)}`);
        }
        setTimeout(() => setActionNotice(null), 4000);
        void fetchState();
      } catch (err: unknown) {
        setActionNotice(`Doctor error: ${err instanceof Error ? err.message : String(err)}`);
        setTimeout(() => setActionNotice(null), 4000);
      }
    },
    [fetchState],
  );

  const handleConvert = useCallback(
    async (sessionId: string, host: string) => {
      try {
        setActionNotice(`Converting ${sessionId} to active A2A adapter...`);
        const data = await fetchFromManager<{ ok: boolean; port?: number }>("/api/convert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionId, host }),
        });
        if (data.ok) {
          setActionNotice(`Converted! A2A adapter listening on port ${data.port}`);
        } else {
          setActionNotice(`Conversion failed: ${JSON.stringify(data)}`);
        }
        setTimeout(() => setActionNotice(null), 4000);
        void fetchState();
      } catch (err: unknown) {
        setActionNotice(`Convert error: ${err instanceof Error ? err.message : String(err)}`);
        setTimeout(() => setActionNotice(null), 4000);
      }
    },
    [fetchState],
  );

  const handleSend = useCallback(
    async (port: number, host: string) => {
      const msg = steerInputs[port]?.trim();
      if (!msg) return;
      setSendingPorts((prev) => ({ ...prev, [port]: true }));
      try {
        const data = await fetchFromManager<{ ok: boolean }>("/api/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ port, host, message: msg }),
        });
        if (data.ok) {
          setActionNotice(`A2A instruction dispatched to port ${port}`);
          setSteerInputs((prev) => ({ ...prev, [port]: "" }));
        } else {
          setActionNotice(`Send failed: ${JSON.stringify(data)}`);
        }
        setTimeout(() => setActionNotice(null), 4000);
      } catch (err: unknown) {
        setActionNotice(`Send error: ${err instanceof Error ? err.message : String(err)}`);
        setTimeout(() => setActionNotice(null), 4000);
      } finally {
        setSendingPorts((prev) => ({ ...prev, [port]: false }));
      }
    },
    [steerInputs],
  );

  // Combine live active adapters
  const liveAdapters = useMemo(() => {
    const list: AdapterInfo[] = [];
    if (!state) return list;
    for (const s of state.sessions || []) {
      if (s.adapter) {
        list.push(s.adapter);
      }
    }
    for (const o of state.orphans || []) {
      list.push(o);
    }
    return list;
  }, [state]);

  const topbar = (
    <div className="flex w-full items-center justify-between">
      <WorkspaceBreadcrumb ariaLabel="Harness Fleet Navigation">
        <WorkspaceBreadcrumbItem>
          <WorkspaceBreadcrumbText className="text-muted-foreground">Fleet</WorkspaceBreadcrumbText>
        </WorkspaceBreadcrumbItem>
        <WorkspaceBreadcrumbSeparator />
        <WorkspaceBreadcrumbItem current>
          <WorkspaceBreadcrumbText className="font-semibold text-foreground">
            Harness Manager
          </WorkspaceBreadcrumbText>
        </WorkspaceBreadcrumbItem>
      </WorkspaceBreadcrumb>

      <div className="flex items-center gap-2">
        <Badge variant={error ? "destructive" : "success"} size="sm" className="gap-1.5">
          <span
            className={cn(
              "size-1.5 rounded-full",
              error ? "bg-red-400" : "bg-emerald-400 animate-pulse",
            )}
          />
          {error ? "API Offline (9090)" : "Daemon Live"}
        </Badge>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void fetchState()}
          disabled={loading}
          className="gap-1.5"
        >
          <RefreshCwIcon className={loading ? "animate-spin size-3.5" : "size-3.5"} />
          <span>Refresh</span>
        </Button>
      </div>
    </div>
  );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <WorkspacePageHeader>{topbar}</WorkspacePageHeader>

        <ScrollArea className="min-h-0 flex-1">
          <WorkspacePageContainer width="wide" className="py-6 space-y-8">
            {/* Action Banner */}
            {actionNotice && (
              <div className="rounded-md border border-primary/20 bg-primary/10 px-4 py-2.5 text-sm font-medium text-foreground flex items-center gap-2">
                <SparklesIcon className="size-4 text-primary shrink-0" />
                <span>{actionNotice}</span>
              </div>
            )}

            {/* Error Banner */}
            {error && !state && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive-foreground space-y-2">
                <div className="font-semibold flex items-center gap-2">
                  <AlertCircleIcon className="size-4 text-destructive shrink-0" />
                  <span>Failed to connect to Harness Manager API (port 9090)</span>
                </div>
                <div className="font-mono text-xs opacity-90">{error}</div>
                <div className="pt-1">
                  <Button size="sm" variant="outline" onClick={() => void fetchState()}>
                    Retry Connection
                  </Button>
                </div>
              </div>
            )}

            {/* Loading Placeholder */}
            {loading && !state ? (
              <div className="rounded-lg border border-border p-12 text-center text-sm text-muted-foreground flex flex-col items-center justify-center gap-3">
                <RefreshCwIcon className="size-6 animate-spin text-primary" />
                <span>Connecting to A2A Harness Fleet...</span>
              </div>
            ) : (
              <>
                {/* Section 1: Active Adapters / AgentCards */}
                <section className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-semibold tracking-tight text-foreground flex items-center gap-2">
                        <BotIcon className="size-5 text-primary" />
                        Live AgentCards & A2A Adapters ({liveAdapters.length})
                      </h2>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Harness instances listening on A2A HTTP endpoints ready for cross-agent
                        collaboration and steering.
                      </p>
                    </div>
                  </div>

                  {liveAdapters.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                      No active A2A adapters online. Convert a session below to launch an adapter.
                    </div>
                  ) : (
                    <div className="grid gap-4 md:grid-cols-2">
                      {liveAdapters.map((adapter) => {
                        const steerMsg = steerInputs[adapter.port] ?? "";
                        const isSending = sendingPorts[adapter.port] ?? false;
                        const curlCmd = `curl -s -X POST http://${adapter.host}:${adapter.port}/message -H "Content-Type: application/json" -d '{"message":"check status"}'`;

                        return (
                          <div
                            key={`${adapter.host}:${adapter.port}`}
                            className="rounded-lg border border-border bg-card p-4 space-y-3.5 shadow-xs transition-colors hover:border-border/80"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="space-y-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-semibold text-sm truncate">
                                    {adapter.instanceId}
                                  </span>
                                  <Badge
                                    variant="outline"
                                    size="sm"
                                    className="uppercase text-[10px] tracking-wider font-semibold"
                                  >
                                    {adapter.harness}
                                  </Badge>
                                  <Badge
                                    variant={adapter.working ? "warning" : "success"}
                                    size="sm"
                                    className="capitalize"
                                  >
                                    {adapter.status || (adapter.working ? "busy" : "idle")}
                                  </Badge>
                                </div>
                                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                  <span className="flex items-center gap-1 font-mono">
                                    <ServerIcon className="size-3" />
                                    {adapter.host}:{adapter.port}
                                  </span>
                                  <span className="flex items-center gap-1">
                                    <ClockIcon className="size-3" />
                                    {formatTimeAgo(adapter.updated)}
                                  </span>
                                </div>
                              </div>

                              <a
                                href={adapter.card}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-primary hover:underline flex items-center gap-1 shrink-0 font-medium"
                              >
                                Card
                                <ExternalLinkIcon className="size-3" />
                              </a>
                            </div>

                            <div className="rounded bg-muted/40 p-2 text-xs font-mono text-muted-foreground flex items-center gap-2 break-all">
                              <FolderIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
                              <span className="truncate">{adapter.projectRoot}</span>
                            </div>

                            {/* Quick Steering Input */}
                            <div className="flex gap-2">
                              <Input
                                placeholder="Steer agent or dispatch instruction..."
                                value={steerMsg}
                                onChange={(e) =>
                                  setSteerInputs((prev) => ({
                                    ...prev,
                                    [adapter.port]: e.target.value,
                                  }))
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    void handleSend(adapter.port, adapter.host);
                                  }
                                }}
                                className="h-8 text-xs"
                              />
                              <Button
                                size="sm"
                                className="h-8 px-2.5 gap-1 shrink-0"
                                onClick={() => void handleSend(adapter.port, adapter.host)}
                                disabled={!steerMsg.trim() || isSending}
                              >
                                <SendIcon className="size-3" />
                                <span>Steer</span>
                              </Button>
                            </div>

                            {/* Card Actions */}
                            <div className="flex items-center justify-between pt-1 border-t border-border/50 text-xs">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
                                onClick={() => void handleDoctor(adapter.sessionId, adapter.host)}
                              >
                                <StethoscopeIcon className="size-3.5 text-info" />
                                <span>Doctor</span>
                              </Button>

                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
                                onClick={() =>
                                  void copyToClipboard(`curl-${adapter.port}`, curlCmd)
                                }
                              >
                                {copiedKey === `curl-${adapter.port}` ? (
                                  <>
                                    <CheckIcon className="size-3.5 text-emerald-500" />
                                    <span>Copied Curl</span>
                                  </>
                                ) : (
                                  <>
                                    <CopyIcon className="size-3.5" />
                                    <span>Copy Curl</span>
                                  </>
                                )}
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                {/* Section 2: Recent Sessions */}
                <section className="space-y-4">
                  <div>
                    <h2 className="text-lg font-semibold tracking-tight text-foreground flex items-center gap-2">
                      <ActivityIcon className="size-5 text-primary" />
                      Recent Sessions (&lt; 10 Days) ({state?.sessions?.length ?? 0})
                    </h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Local and CT100 sessions filtered to active sessions in the last 10 days.
                      Convert any session into an A2A adapter.
                    </p>
                  </div>

                  {!state?.sessions?.length ? (
                    <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                      No sessions found within the last 10 days.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {state.sessions.map((s) => {
                        const isOnline = Boolean(s.adapter);
                        const attachCmd = s.attach || "";

                        return (
                          <div
                            key={s.id}
                            className="rounded-lg border border-border bg-card p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors hover:border-border/80"
                          >
                            <div className="space-y-1.5 min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium text-sm text-foreground truncate">
                                  {s.title || s.slug}
                                </span>
                                <Badge
                                  variant="outline"
                                  size="sm"
                                  className="uppercase text-[10px] tracking-wider font-semibold"
                                >
                                  {s.harness}
                                </Badge>
                                <Badge
                                  variant={s.working ? "warning" : "secondary"}
                                  size="sm"
                                  className="text-xs"
                                >
                                  {s.status}
                                </Badge>
                                {isOnline && (
                                  <Badge variant="success" size="sm" className="text-xs font-mono">
                                    Port {s.adapter?.port}
                                  </Badge>
                                )}
                              </div>

                              <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                                <span className="flex items-center gap-1 font-mono">
                                  <FolderIcon className="size-3" />
                                  <span className="truncate max-w-sm">{s.directory}</span>
                                </span>
                                <span className="flex items-center gap-1">
                                  <ClockIcon className="size-3" />
                                  Last active {formatTimeAgo(s.updated)}
                                </span>
                                <span className="text-muted-foreground/60 font-mono text-[11px]">
                                  {s.id.slice(0, 16)}...
                                </span>
                              </div>

                              {attachCmd && (
                                <div className="flex items-center gap-2 pt-0.5">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-6 text-[11px] font-mono px-2 py-0 gap-1.5 bg-muted/30 text-muted-foreground hover:text-foreground"
                                    onClick={() =>
                                      void copyToClipboard(`attach-${s.id}`, attachCmd)
                                    }
                                  >
                                    <TerminalIcon className="size-3" />
                                    <span>{attachCmd}</span>
                                    {copiedKey === `attach-${s.id}` ? (
                                      <CheckIcon className="size-3 text-emerald-500 ml-1" />
                                    ) : (
                                      <CopyIcon className="size-3 opacity-60 ml-1" />
                                    )}
                                  </Button>
                                </div>
                              )}
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              {isOnline ? (
                                <Badge
                                  variant="outline"
                                  size="control"
                                  className="text-xs gap-1.5 px-3 py-1 font-mono"
                                >
                                  <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                                  Active A2A
                                </Badge>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="default"
                                  className="gap-1.5"
                                  onClick={() => void handleConvert(s.id, s.host)}
                                >
                                  <PlayIcon className="size-3.5 fill-current" />
                                  <span>Convert to A2A</span>
                                </Button>
                              )}

                              <Button
                                size="sm"
                                variant="ghost"
                                className="gap-1 text-muted-foreground hover:text-foreground"
                                onClick={() => void handleDoctor(s.id, s.host)}
                              >
                                <StethoscopeIcon className="size-3.5 text-info" />
                                <span>Doctor</span>
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                {/* Section 3: Fleet Network Peers */}
                <section className="space-y-3 pb-8">
                  <div>
                    <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                      <NetworkIcon className="size-4" />
                      Fleet Network Peers ({state?.peers?.length ?? 0})
                    </h2>
                  </div>

                  {!state?.peers?.length ? (
                    <div className="text-xs text-muted-foreground">
                      No peers currently registered.
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {state.peers.map((peer) => (
                        <div
                          key={peer.origin}
                          className="rounded-md border border-border bg-card/60 px-3 py-1.5 text-xs font-mono flex items-center gap-2 shadow-2xs"
                        >
                          <span className="size-2 rounded-full bg-emerald-500" />
                          <span>{peer.origin}</span>
                          <span className="text-[10px] text-muted-foreground uppercase">
                            {peer.auth_scheme}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </>
            )}
          </WorkspacePageContainer>
        </ScrollArea>
      </div>
    </SidebarInset>
  );
}

function cn(...classes: (string | boolean | undefined | null)[]) {
  return classes.filter(Boolean).join(" ");
}
