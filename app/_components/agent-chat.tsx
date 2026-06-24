"use client";

import { useEveAgent } from "eve/react";
import { AlertCircleIcon } from "lucide-react";
import type { ReactNode } from "react";
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
import { cn } from "@/lib/utils";
import { AgentMessage } from "./agent-message";

const AGENT_NAME = "steve";
const BETA_TERMS_HREF = "https://vercel.com/docs/release-phases/public-beta-agreement";
const MONITORING_HREF = "https://status.eve.phil.bingo";

// Example prompts shown on the landing screen. They exercise the movie-database
// skills (lookup, rank, aggregate, derive, chart) so a first-time visitor can
// validate the answers by eye.
const SUGGESTIONS = [
  "Top 5 movies by box office — and chart it",
  "Which director has the highest average rating?",
  "Most profitable film relative to its budget",
] as const;

type AgentStatus = ReturnType<typeof useEveAgent>["status"];

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

export function AgentChat() {
  const agent = useEveAgent();
  const isBusy = agent.status === "submitted" || agent.status === "streaming";
  const isEmpty = agent.data.messages.length === 0;

  const handleSubmit = async (message: PromptInputMessage) => {
    const text = message.text.trim();
    if (!text || isBusy) return;

    await agent.send({ message: text });
  };

  const composer = (
    <PromptInput onSubmit={handleSubmit}>
      <PromptInputTextarea placeholder="Send a message…" />
      <PromptInputSubmit onStop={agent.stop} status={agent.status} />
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
            <Pill title="No Vercel infrastructure. The TypeScript eve agent runs the model's Python in an isolated sandbox on an independent droplet.">
              Self-hosted · TS agent + Python sandbox
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
                onInputResponses={(inputResponses) => agent.send({ inputResponses })}
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
            <Pill
              href={MONITORING_HREF}
              title="Live host & Docker metrics for the droplet (Beszel)."
            >
              Live metrics ↗
            </Pill>
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
                onClick={() => void agent.send({ message: prompt })}
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
