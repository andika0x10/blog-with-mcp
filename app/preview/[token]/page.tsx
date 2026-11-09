import { notFound } from "next/navigation";
import { contentService } from "../../../lib/runtime";
import { ContentView } from "../../../components/content-view";
export const metadata = { title: "Preview privat", robots: { index: false, follow: false } };
export default async function Preview({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9]{64}$/.test(token)) notFound();
  const service = contentService(),
    revision = await service.readPreview(token);
  if (!revision) notFound();
  return <ContentView content={revision} settings={await service.settings()} preview />;
}
