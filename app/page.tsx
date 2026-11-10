import { contentService } from "../lib/runtime";
import { PostList } from "../components/post-list";
export default async function Home({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const query = await searchParams,
    page = Math.min(100000, Math.max(1, parseInt(query.page ?? "1", 10) || 1));
  const service = contentService(),
    [settings, posts, next] = await Promise.all([service.settings(), service.publicList({ page }), service.publicList({ page: page + 1 })]);
  return (
    <section className="index-column">
      <header className="index-intro">
        <h1>{settings.name}</h1>
        <p>{settings.description}</p>
      </header>
      {posts.length ? (
        <PostList posts={posts} settings={settings} />
      ) : (
        <div className="empty-state">
          <h2>{page > 1 ? "Tidak ada tulisan di halaman ini." : "Belum ada tulisan terbit."}</h2>
          <p>{page > 1 ? "Kembali ke halaman sebelumnya untuk melanjutkan membaca." : "Tulisan pertama akan muncul di sini setelah diterbitkan."}</p>
        </div>
      )}
      {(page > 1 || next.length > 0) && (
        <nav className="pagination" aria-label="Halaman tulisan">
          {page > 1 ? <a href={`/?page=${page - 1}`}>Lebih baru</a> : <span />}
          <span>Halaman {page}</span>
          {next.length > 0 ? <a href={`/?page=${page + 1}`}>Lebih lama</a> : <span />}
        </nav>
      )}
    </section>
  );
}
