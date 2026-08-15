import type { Metadata } from "next";
import { ApiKeysSettingsPage } from "@/components/pages/settings";

export const metadata: Metadata = {
  title: "API Keys",
};

const Page = () => <ApiKeysSettingsPage />;

export default Page;
