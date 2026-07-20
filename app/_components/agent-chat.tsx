"use client";

import {
  Client,
  type ClientAuth,
  type ClientSession,
  type HandleMessageStreamEvent,
  isCurrentTurnBoundaryEvent,
  type SessionState,
} from "eve/client";
import { useEveAgent } from "eve/react";
import { AlertCircleIcon, LogOutIcon } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  PromptInput,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { AgentMessage } from "./agent-message";

const AGENT_NAME = "steve";
const BETA_TERMS_HREF = "https://vercel.com/docs/release-phases/public-beta-agreement";
const MONITORING_HREF = process.env.NEXT_PUBLIC_MONITORING_URL;
const CHAT_STORAGE_KEY = "steve:eve-chat:v1";

// Example prompts shown on the landing screen. They exercise the movie-database
// skills (lookup, rank, aggregate, derive, chart) so a first-time visitor can
// validate the answers by eye.
const SUGGESTIONS = [
  "Top 5 movies by box office — and chart it",
  "Which director has the highest average rating?",
  "Most profitable film relative to its budget",
] as const;

type AgentStatus = ReturnType<typeof useEveAgent>["status"];
export type AgentAuthMode = "basic" | "local" | "misconfigured";

type BasicCredentials = {
  readonly password: string;
  readonly username: string;
};

type SavedEveChat = {
  readonly events?: readonly HandleMessageStreamEvent[];
  readonly session?: SessionState;
};

function Pill({
  children,
  href,
  title,
}: {
  readonly children: ReactNode;
  readonly href?: string;
  readonly title?: string;
}) {
  const className =
    "rounded-full border border-border bg-muted/40 px-2 py-0.5 font-medium text-muted-foreground text-xs";
  if (href) {
    return (
      <a
        className={cn(className, "transition-colors hover:bg-muted hover:text-foreground")}
        href={href}
        rel="noreferrer"
        target="_blank"
        title={title}
      >
        {children}
      </a>
    );
  }
  return (
    <span className={className} title={title}>
      {children}
    </span>
  );
}

export function AgentChat({ authMode }: { readonly authMode: AgentAuthMode }) {
  const [credentials, setCredentials] = useState<BasicCredentials>();

  if (authMode === "misconfigured") {
    return <AuthConfigurationError />;
  }

  if (authMode === "basic" && !credentials) {
    return <BasicAuthForm onAuthenticated={setCredentials} />;
  }

  const auth: ClientAuth | undefined = credentials
    ? { basic: { username: credentials.username, password: credentials.password } }
    : undefined;

  return (
    <AgentSession
      auth={auth}
      onSignOut={credentials ? () => setCredentials(undefined) : undefined}
    />
  );
}

function AgentSession({
  auth,
  onSignOut,
}: {
  readonly auth?: ClientAuth;
  readonly onSignOut?: () => void;
}) {
  const [saved, setSaved] = useState<SavedEveChat>();

  useEffect(() => {
    const controller = new AbortController();
    void restoreSavedChat(auth, controller.signal).then(setSaved);
    return () => controller.abort();
  }, [auth]);

  if (!saved) {
    return <AgentLoading />;
  }

  return <ConnectedAgentSession auth={auth} onSignOut={onSignOut} saved={saved} />;
}

function ConnectedAgentSession({
  auth,
  onSignOut,
  saved,
}: {
  readonly auth?: ClientAuth;
  readonly onSignOut?: () => void;
  readonly saved: SavedEveChat;
}) {
  const [clientSession] = useState(() => {
    const client = new Client({
      host: window.location.origin,
      auth,
      maxReconnectAttempts: 20,
      preserveCompletedSessions: true,
      redirect: "error",
    });
    return client.session(saved.session);
  });
  const eventsRef = useRef<HandleMessageStreamEvent[]>([...(saved.events ?? [])]);
  const sessionRef = useRef<SessionState>(clientSession.state);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const persist = (immediately = false) => {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    const write = () =>
      saveChat({ events: eventsRef.current, session: sessionRef.current });
    if (immediately) {
      write();
    } else {
      persistTimerRef.current = setTimeout(write, 100);
    }
  };

  useEffect(
    () => () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    },
    [],
  );

  const agent = useEveAgent({
    initialEvents: saved.events ?? [],
    session: clientSession,
    onEvent(event) {
      eventsRef.current.push(event);
      sessionRef.current = clientSession.state;
      persist();
    },
    onFinish(snapshot) {
      eventsRef.current = [...snapshot.events];
      sessionRef.current = snapshot.session;
      persist(true);
    },
    onSessionChange(session) {
      sessionRef.current = session;
      persist(true);
    },
  });
  const isBusy = agent.status === "submitted" || agent.status === "streaming";
  const isEmpty = agent.data.messages.length === 0;

  const send = async (input: Parameters<typeof agent.send>[0]) => {
    const result = agent.send(input);
    void persistSessionWhenAccepted(clientSession, eventsRef, sessionRef);
    await result;
  };

  const handleSubmit = async (message: PromptInputMessage) => {
    const text = message.text.trim();
    if (!text || isBusy) return;

    await send({ message: text });
  };

  const handleStop = async () => {
    if (!(await waitForSessionId(clientSession, 1_000))) {
      agent.stop();
      return;
    }

    try {
      await clientSession.cancel();
    } catch {
      agent.stop();
    }
  };

  const handleSignOut = async () => {
    if (isBusy) await handleStop();
    agent.stop();
    agent.reset();
    clearSavedChat();
    onSignOut?.();
  };

  const composer = (
    <PromptInput onSubmit={handleSubmit}>
      <PromptInputTextarea placeholder="Send a message…" />
      <PromptInputSubmit onStop={() => void handleStop()} status={agent.status} />
    </PromptInput>
  );

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      {isEmpty ? null : (
        <header className="flex h-14 shrink-0 items-center justify-center gap-2 pl-4 pr-2">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-muted-foreground text-sm">{AGENT_NAME}</span>
            <StatusDot status={agent.status} />
          </span>
          <span className="hidden sm:inline-flex">
            <Pill title="The Eve runtime, durable state, sandbox, and telemetry run on the self-hosted machine; model calls go directly to the selected provider.">
              Self-hosted runtime · Docker sandbox
            </Pill>
          </span>
          <a
            className="rounded-full border border-amber-500/30 px-2 py-0.5 font-medium text-amber-700 text-xs transition-colors hover:bg-amber-500/10 dark:text-amber-300"
            href={BETA_TERMS_HREF}
            rel="noreferrer"
            target="_blank"
          >
            Public preview
          </a>
          {onSignOut ? (
            <Button
              onClick={() => void handleSignOut()}
              size="icon-xs"
              title="Sign out"
              variant="ghost"
            >
              <LogOutIcon />
              <span className="sr-only">Sign out</span>
            </Button>
          ) : null}
        </header>
      )}

      {agent.error ? (
        <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pt-2 sm:px-6">
          <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm">
            <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div>
              <p className="font-medium">Request failed</p>
              <p className="mt-0.5 text-muted-foreground">{agent.error.message}</p>
            </div>
          </div>
        </div>
      ) : null}

      {isEmpty ? null : (
        <Conversation className="min-h-0 flex-1">
          <ConversationContent className="mx-auto w-full max-w-3xl gap-6 px-4 py-6 sm:px-6">
            {agent.data.messages.map((message, index) => (
              <AgentMessage
                canRespond={!isBusy}
                isStreaming={
                  agent.status === "streaming" && index === agent.data.messages.length - 1
                }
                key={message.id}
                message={message}
                onInputResponses={(inputResponses) => send({ inputResponses })}
              />
            ))}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      )}

      <div
        className={cn(
          "mx-auto w-full px-4 sm:px-6",
          isEmpty
            ? "flex max-w-xl flex-1 flex-col items-center justify-center gap-8 pb-[10vh]"
            : "max-w-3xl shrink-0 pb-6",
        )}
      >
        {isEmpty ? (
          <div className="flex flex-col items-center gap-4 text-center">
            <h1 className="font-medium text-5xl tracking-tighter">
              <span className="text-muted-foreground/50">st</span>
              <span className="text-foreground">eve</span>
            </h1>
            <p className="max-w-sm text-balance text-muted-foreground text-sm">
              A self-hosted movie-database analyst. Ask about ~40 films — it runs
              Python in a sandbox and charts the answer.
            </p>
            {MONITORING_HREF ? (
              <Pill href={MONITORING_HREF} title="Host and Docker metrics.">
                Live metrics ↗
              </Pill>
            ) : null}
            {onSignOut ? (
              <Button onClick={() => void handleSignOut()} size="sm" variant="ghost">
                <LogOutIcon />
                Sign out
              </Button>
            ) : null}
          </div>
        ) : null}
        <div className="w-full">{composer}</div>
        {isEmpty ? (
          <div className="flex flex-wrap items-center justify-center gap-2">
            {SUGGESTIONS.map((prompt) => (
              <button
                className="rounded-full border border-border px-3 py-1.5 text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                disabled={isBusy}
                key={prompt}
                onClick={() => void send({ message: prompt })}
                type="button"
              >
                {prompt}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </main>
  );
}

function BasicAuthForm({
  onAuthenticated,
}: {
  readonly onAuthenticated: (credentials: BasicCredentials) => void;
}) {
  const [error, setError] = useState<string>();
  const [isSafeOrigin, setIsSafeOrigin] = useState<boolean>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setIsSafeOrigin(window.location.protocol === "https:");
  }, []);

  if (isSafeOrigin === undefined) {
    return <AgentLoading />;
  }

  if (!isSafeOrigin) {
    return <SecureConnectionRequired />;
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const credentials = {
      username: String(form.get("username") ?? "").trim(),
      password: String(form.get("password") ?? ""),
    };
    if (!credentials.username || !credentials.password) return;

    setError(undefined);
    setIsSubmitting(true);
    try {
      const client = new Client({
        host: window.location.origin,
        auth: { basic: credentials },
        redirect: "error",
      });
      await client.info();
      onAuthenticated(credentials);
    } catch {
      setError("The username or password is incorrect.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="flex h-dvh items-center justify-center bg-background px-4 text-foreground">
      <section className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm">
        <p className="text-muted-foreground text-xs uppercase tracking-[0.2em]">steve</p>
        <h1 className="mt-2 font-medium text-2xl tracking-tight">Sign in to the agent</h1>
        <p className="mt-2 text-muted-foreground text-sm">
          Use the Basic auth credentials configured by the self-hosted operator.
        </p>
        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <label className="block space-y-1.5 text-sm">
            <span>Username</span>
            <Input autoComplete="username" name="username" required />
          </label>
          <label className="block space-y-1.5 text-sm">
            <span>Password</span>
            <Input autoComplete="current-password" name="password" required type="password" />
          </label>
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
          <Button className="w-full" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Checking…" : "Continue"}
          </Button>
        </form>
        <p className="mt-4 text-muted-foreground text-xs">
          Credentials stay in this browser tab and must be sent over HTTPS.
        </p>
      </section>
    </main>
  );
}

function AgentLoading() {
  return (
    <main className="flex h-dvh items-center justify-center bg-background text-muted-foreground">
      <p className="text-sm">Loading agent…</p>
    </main>
  );
}

function SecureConnectionRequired() {
  return (
    <main className="flex h-dvh items-center justify-center bg-background px-4 text-foreground">
      <section className="w-full max-w-lg rounded-xl border border-destructive/30 bg-destructive/5 p-6">
        <div className="flex items-start gap-3">
          <AlertCircleIcon className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div>
            <h1 className="font-medium text-lg">HTTPS is required</h1>
            <p className="mt-2 text-muted-foreground text-sm">
              Configure the deployment domain and TLS before entering Basic auth credentials.
              Plain-HTTP IP mode is limited to health checks.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

function AuthConfigurationError() {
  return (
    <main className="flex h-dvh items-center justify-center bg-background px-4 text-foreground">
      <section className="w-full max-w-lg rounded-xl border border-destructive/30 bg-destructive/5 p-6">
        <div className="flex items-start gap-3">
          <AlertCircleIcon className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div>
            <h1 className="font-medium text-lg">Production authentication is not configured</h1>
            <p className="mt-2 text-muted-foreground text-sm">
              Set ROUTE_AUTH_BASIC_USER and ROUTE_AUTH_BASIC_PASSWORD, then rebuild and restart
              the Eve and Next.js services. Agent routes remain closed until both values exist.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

function loadSavedChat(): SavedEveChat {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedEveChat) : {};
  } catch {
    return {};
  }
}

async function restoreSavedChat(
  auth: ClientAuth | undefined,
  abortSignal: AbortSignal,
): Promise<SavedEveChat> {
  const saved = loadSavedChat();
  const events = [...(saved.events ?? [])];
  const lastEvent = events.at(-1);

  if (
    !saved.session?.sessionId ||
    (lastEvent !== undefined && isCurrentTurnBoundaryEvent(lastEvent))
  ) {
    return saved;
  }

  try {
    const client = new Client({ host: window.location.origin, auth, redirect: "error" });
    const session = client.session(saved.session);
    const signal = AbortSignal.any([abortSignal, AbortSignal.timeout(120_000)]);

    while (!signal.aborted) {
      for await (const event of session.stream({ startIndex: events.length, signal })) {
        events.push(event);
        const nextSession = sessionStateAfterEvent(session.state, event, events.length);
        const restored = {
          events,
          session: nextSession,
        };
        saveChat(restored);
        if (isCurrentTurnBoundaryEvent(event)) return restored;
        if (event.type === "input.requested" || event.type === "authorization.required") {
          return restored;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    return {
      events,
      session: { ...session.state, streamIndex: events.length },
    };
  } catch {
    return {
      events,
      session: saved.session
        ? { ...saved.session, streamIndex: events.length }
        : saved.session,
    };
  }
}

async function persistSessionWhenAccepted(
  session: ClientSession,
  eventsRef: { readonly current: readonly HandleMessageStreamEvent[] },
  sessionRef: { current: SessionState },
) {
  if (!(await waitForSessionId(session, 5_000))) return;
  sessionRef.current = session.state;
  saveChat({ events: eventsRef.current, session: session.state });
}

async function waitForSessionId(session: ClientSession, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!session.state.sessionId && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return Boolean(session.state.sessionId);
}

function sessionStateAfterEvent(
  state: SessionState,
  event: HandleMessageStreamEvent,
  streamIndex: number,
): SessionState {
  if (event.type === "session.waiting") {
    return { ...state, continuationToken: event.data.continuationToken, streamIndex };
  }
  if (event.type === "session.completed" || event.type === "session.failed") {
    return { streamIndex };
  }
  return { ...state, streamIndex };
}

function saveChat(chat: SavedEveChat) {
  try {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(chat));
  } catch {
    // Chat remains usable when storage is unavailable or full.
  }
}

function clearSavedChat() {
  try {
    localStorage.removeItem(CHAT_STORAGE_KEY);
  } catch {
    // Signing out still clears in-memory credentials and session state.
  }
}

function StatusDot({ status }: { readonly status: AgentStatus }) {
  const isLive = status === "submitted" || status === "streaming";
  const tone =
    status === "error"
      ? "bg-destructive"
      : isLive
        ? "bg-emerald-500"
        : status === "ready"
          ? "bg-muted-foreground"
          : "bg-muted-foreground/50";

  return (
    <span className="relative flex size-1">
      {isLive ? (
        <span
          className={cn(
            "absolute inline-flex size-full animate-ping rounded-full opacity-75",
            tone,
          )}
        />
      ) : null}
      <span className={cn("relative inline-flex size-1 rounded-full transition-colors", tone)} />
    </span>
  );
}
