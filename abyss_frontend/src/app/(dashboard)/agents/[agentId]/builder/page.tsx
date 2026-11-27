import type { Metadata } from "next";
import { AgentEditBuilderPage } from "@/components/pages/agent-builder";

export const metadata: Metadata = {
  title: "Agent Studio",
};

const Page = async ({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) => {
  const { agentId } = await params;
  return <AgentEditBuilderPage agentId={agentId} />;
};

export default Page;
