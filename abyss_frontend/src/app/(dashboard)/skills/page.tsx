import type { Metadata } from "next";
import { SkillsPage } from "@/components/pages/skills";

export const metadata: Metadata = {
  title: "Skills",
};

const Page = () => <SkillsPage />;

export default Page;
