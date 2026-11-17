import type { Metadata } from "next";
import { MemorySettingsPage } from "@/components/pages/settings";

export const metadata: Metadata = {
  title: "Memory",
};

const Page = () => <MemorySettingsPage />;

export default Page;
