import type { Metadata } from "next";
import { AgentChatPage } from "@/components/pages/agent-chat";

export const metadata: Metadata = {
  title: "Chat",
};

const Page = async ({
  params,
}: {
  params: Promise<{ agentId: string; threadId: string }>;
}) => {
  const { agentId, threadId } = await params;
  return <AgentChatPage agentId={agentId} threadId={threadId} />;
};

export default Page;
