import type { Metadata } from "next";
import { ProfileSettingsPage } from "@/components/pages/settings";

export const metadata: Metadata = {
  title: "Profile",
};

const Page = () => <ProfileSettingsPage />;

export default Page;
