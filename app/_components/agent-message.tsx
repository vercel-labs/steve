"use client";

import type { EveDynamicToolPart, EveMessage, EveMessagePart } from "eve/react";
import { ExternalLinkIcon, FileIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type AgentInputResponse = {
  readonly optionId?: string;
  readonly requestId: string;
  readonly text?: string;
};

export function AgentMessage({
  canRespond,
  isStreaming,
  message,
  onInputResponses,
}: {
  readonly canRespond: boolean;
  readonly isStreaming: boolean;
  readonly message: EveMessage;
  readonly onInputResponses: (responses: readonly AgentInputResponse[]) => void | Promise<void>;
}) {
  const lastTextIndex = message.parts.reduce(
    (last, part, index) => (part.type === "text" ? index : last),
    -1,
  );

  return (
    <Message
      data-optimistic={message.metadata?.optimistic ? "true" : undefined}
      from={message.role}
    >
      <MessageContent>
        {message.parts.map((part, index) => (
          <AgentMessagePart
            canRespond={canRespond}
            key={partKey(part, index)}
            onInputResponses={onInputResponses}
            part={part}
            showCaret={isStreaming && message.role === "assistant" && index === lastTextIndex}
          />
        ))}
      </MessageContent>
    </Message>
  );
}

function AgentMessagePart({
  canRespond,
  onInputResponses,
  part,
  showCaret,
}: {
  readonly canRespond: boolean;
  readonly onInputResponses: (responses: readonly AgentInputResponse[]) => void | Promise<void>;
  readonly part: EveMessagePart;
  readonly showCaret: boolean;
}) {
  switch (part.type) {
    case "step-start":
      return null;
    case "text":
      return (
        <MessageResponse caret="block" isAnimating={showCaret}>
          {part.text}
        </MessageResponse>
      );
    case "reasoning":
      return (
        <Reasoning defaultOpen isStreaming={part.state === "streaming"}>
          <ReasoningTrigger />
          <ReasoningContent>{part.text}</ReasoningContent>
        </Reasoning>
      );
    case "file": {
      const label = part.filename ?? "Attachment";
      return (
        <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
          <FileIcon className="size-4 text-muted-foreground" />
          {part.url ? (
            <a
              className="inline-flex items-center gap-1 underline underline-offset-4"
              href={part.url}
              rel="noreferrer"
              target="_blank"
            >
              {label}
              <ExternalLinkIcon className="size-3" />
            </a>
          ) : (
            <span>{label}</span>
          )}
          <span className="text-muted-foreground">{part.mediaType}</span>
        </div>
      );
    }
    case "authorization":
      return (
        <div className="space-y-2 rounded-md border border-blue-500/30 bg-blue-500/5 p-3 text-sm">
          <p className="font-medium">{part.displayName}</p>
          <p className="text-muted-foreground">{part.description}</p>
          {part.state === "required" ? (
            <>
              {part.authorization?.instructions ? <p>{part.authorization.instructions}</p> : null}
              {part.authorization?.userCode ? (
                <code className="block w-fit rounded bg-muted px-2 py-1">
                  {part.authorization.userCode}
                </code>
              ) : null}
              {part.authorization?.url ? (
                <Button asChild size="sm">
                  <a href={part.authorization.url} rel="noreferrer" target="_blank">
                    Sign in
                    <ExternalLinkIcon />
                  </a>
                </Button>
              ) : null}
            </>
          ) : (
            <p>
              {part.outcome === "authorized"
                ? "Authorization complete."
                : `Authorization ${part.outcome}.`}
            </p>
          )}
        </div>
      );
    case "dynamic-tool":
      return (
        <Tool
          defaultOpen={part.state === "approval-requested" || part.state === "approval-responded"}
        >
          <ToolHeader
            state={part.state}
            title={part.toolName}
            toolName={part.toolName}
            type="dynamic-tool"
          />
          <ToolContent>
            <ToolInput input={part.input} />
            <InputRequestActions
              canRespond={canRespond}
              part={part}
              onInputResponses={onInputResponses}
            />
            <ToolOutput errorText={part.errorText} output={part.output} />
          </ToolContent>
        </Tool>
      );
    default: {
      const exhaustive: never = part;
      return exhaustive;
    }
  }
}

function InputRequestActions({
  canRespond,
  onInputResponses,
  part,
}: {
  readonly canRespond: boolean;
  readonly onInputResponses: (responses: readonly AgentInputResponse[]) => void | Promise<void>;
  readonly part: EveDynamicToolPart;
}) {
  const [text, setText] = useState("");
  const inputRequest = part.toolMetadata?.eve?.inputRequest;
  if (!inputRequest) {
    return null;
  }

  const inputResponse = part.toolMetadata?.eve?.inputResponse;
  const selectedOption = inputRequest.options?.find(
    (option) => option.id === inputResponse?.optionId,
  );
  const acceptsText = inputRequest.allowFreeform || !inputRequest.options?.length;

  const handleTextResponse = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const response = text.trim();
    if (!response || !canRespond) return;
    void onInputResponses([{ requestId: inputRequest.requestId, text: response }]);
  };

  return (
    <div className="space-y-3 rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3">
      <p className="text-muted-foreground text-sm">{inputRequest.prompt}</p>
      {inputResponse ? (
        <p className="font-medium text-sm">
          Responded: {selectedOption?.label ?? inputResponse.text ?? inputResponse.optionId}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {inputRequest.options?.map((option) => (
            <Button
              disabled={!canRespond}
              key={option.id}
              onClick={() => {
                void onInputResponses([
                  {
                    optionId: option.id,
                    requestId: inputRequest.requestId,
                  },
                ]);
              }}
              size="sm"
              title={option.description}
              type="button"
              variant={option.style === "danger" ? "destructive" : "default"}
            >
              {option.label}
            </Button>
          ))}
          {acceptsText ? (
            <form className="flex min-w-64 flex-1 gap-2" onSubmit={handleTextResponse}>
              <Input
                aria-label="Response"
                disabled={!canRespond}
                onChange={(event) => setText(event.target.value)}
                placeholder="Type a response"
                value={text}
              />
              <Button disabled={!canRespond || !text.trim()} size="sm" type="submit">
                Send
              </Button>
            </form>
          ) : null}
        </div>
      )}
    </div>
  );
}

function partKey(part: EveMessagePart, index: number): string {
  switch (part.type) {
    case "authorization":
      return `${part.type}:${part.turnId}:${part.name}`;
    case "dynamic-tool":
      return part.toolCallId;
    default:
      return `${part.type}:${index}`;
  }
}
