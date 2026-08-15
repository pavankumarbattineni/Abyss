import type { Metadata } from "next";
import { ScheduleRunsPage } from "@/components/pages/agent-schedules/schedule-runs";


export const metadata: Metadata = {
  title: "Run History",
};

const Page = async ({
  params,
}: {
  params: Promise<{ agentId: string; scheduleId: string }>;
}) => {
  const { agentId, scheduleId } = await params;
  return <ScheduleRunsPage agentId={agentId} scheduleId={scheduleId} />;
};

export default Page;
