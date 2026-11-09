import { contentService } from "../../lib/runtime";
import { PostList } from "../../components/post-list";
export const metadata = { title: "Cari tulisan", robots: { index: false, follow: true } };
export default async function Search({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const query = await searchParams,
    q = (query.q ?? "").trim().slice(0, 200),
    page = Math.min(100000, Math.max(1, parseInt(query.page ?? "1", 10) || 1));
  const service = contentService(),
    settings = await service.settings(),
    posts = q ? await service.publicList({ query: q, kind: "all", page }) : [],
    next = q ? await service.publicList({ query: q, kind: "all", page: page + 1 }) : [];
  const href = (p: number) => `/search?q=${encodeURIComponent(q)}&page=${p}`;
  return (
    <section className="index-column">
      <header className="section-header">
        <h1>Cari tulisan</h1>
        <p>Temukan kata atau gagasan yang ingin kamu baca.</p>
      </header>
      <form className="search-form" action="/search">
        <label className="sr-only" htmlFor="query">
          Kata pencarian
        </label>
        <input id="query" name="q" type="search" defaultValue={q} placeholder="Cari di dalam tulisan…" maxLength={200} />
        <button type="submit">Cari</button>
      </form>
      {q &&
        (posts.length ? (
          <>
            <p className="search-caption">Hasil untuk “{q}”</p>
            <PostList posts={posts} settings={settings} />
          </>
        ) : (
          <div className="empty-state">
            <h2>Belum menemukan “{q}”.</h2>
            <p>
              Coba kata lain atau jelajahi <a href="/archive">arsip tulisan</a>.
            </p>
          </div>
        ))}
      {(page > 1 || next.length > 0) && (
        <nav className="pagination" aria-label="Halaman hasil pencarian">
          {page > 1 ? <a href={href(page - 1)}>Sebelumnya</a> : <span />}
          <span>Halaman {page}</span>
          {next.length > 0 ? <a href={href(page + 1)}>Berikutnya</a> : <span />}
        </nav>
      )}
    </section>
  );
}
