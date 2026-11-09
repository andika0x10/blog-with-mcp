import { notFound, permanentRedirect } from "next/navigation";
import { contentService, origin } from "../../../lib/runtime";
import { ContentView } from "../../../components/content-view";
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params,
    item = await contentService().publicPath(`/posts/${slug}`);
  if (!item) return {};
  const p = item.post;
  return {
    title: p.seoTitle || p.title,
    description: p.seoDescription || p.summary,
    alternates: { canonical: new URL(p.url, origin()).toString() },
    openGraph: {
      type: "article",
      title: p.seoTitle || p.title,
      description: p.seoDescription || p.summary,
      publishedTime: p.published_at,
      ...(p.image ? { images: [p.image] } : {}),
    },
  };
}
export default async function Post({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params,
    service = contentService(),
    item = await service.publicPath(`/posts/${slug}`);
  if (!item) notFound();
  if (item.redirect) permanentRedirect(item.post.url);
  return <ContentView content={item.post} date={item.post.published_at} settings={await service.settings()} />;
}
