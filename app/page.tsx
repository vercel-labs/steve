import { AgentChat, type AgentAuthMode } from "@/app/_components/agent-chat";

export default function Page() {
  const credentialsConfigured = Boolean(
    process.env.ROUTE_AUTH_BASIC_USER?.trim() && process.env.ROUTE_AUTH_BASIC_PASSWORD,
  );
  const authMode: AgentAuthMode =
    process.env.NODE_ENV !== "production"
      ? "local"
      : credentialsConfigured
        ? "basic"
        : "misconfigured";

  return <AgentChat authMode={authMode} />;
}
