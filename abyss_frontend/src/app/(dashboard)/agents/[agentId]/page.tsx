import type { Metadata } from "next";
import { AgentChatPage } from "@/components/pages/agent-chat";

export const metadata: Metadata = {
  title: "Chat",
};

const Page = async ({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) => {
  const { agentId } = await params;
  return <AgentChatPage agentId={agentId} />;
};

export default Page;
