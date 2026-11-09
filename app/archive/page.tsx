import { contentService } from "../../lib/runtime";
import { DateLabel } from "../../components/content-view";
export const metadata = { title: "Arsip" };
export default async function Archive() {
  const service = contentService(),
    settings = await service.settings();
  const rows = await service.db
    .prepare(
      "SELECT r.title,r.slug,c.published_at FROM contents c JOIN revisions r ON r.id=c.published_id WHERE c.kind='post' AND c.trashed_at IS NULL ORDER BY c.published_at DESC,c.id DESC"
    )
    .all<{ title: string; slug: string; published_at: string }>();
  const groups = new Map<string, typeof rows.results>();
  for (const p of rows.results) {
    const year = new Intl.DateTimeFormat(settings.language, { year: "numeric", timeZone: settings.timezone }).format(new Date(p.published_at));
    groups.set(year, [...(groups.get(year) ?? []), p]);
  }
  return (
    <section className="index-column">
      <header className="section-header">
        <h1>Arsip</h1>
        <p>Semua tulisan, dari waktu ke waktu.</p>
      </header>
      {!groups.size && <p className="empty-state">Belum ada tulisan terbit untuk diarsipkan.</p>}
      {Array.from(groups, ([year, posts]) => (
        <section key={year} className="archive-year">
          <h2>{year}</h2>
          <ol>
            {posts.map((p) => (
              <li key={p.slug}>
                <a href={`/posts/${p.slug}`}>{p.title}</a>
                <DateLabel value={p.published_at} settings={settings} />
              </li>
            ))}
          </ol>
        </section>
      ))}
    </section>
  );
}
