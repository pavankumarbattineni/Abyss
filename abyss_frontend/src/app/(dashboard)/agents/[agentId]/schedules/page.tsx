import type { Metadata } from "next";
import { AgentSchedulesPage } from "@/components/pages/agent-schedules";

export const metadata: Metadata = {
  title: "Schedules",
};

const Page = async ({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) => {
  const { agentId } = await params;
  return <AgentSchedulesPage agentId={agentId} />;
};

export default Page;
