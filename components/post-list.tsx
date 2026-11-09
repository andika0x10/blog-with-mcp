import type { PublicContent } from "../lib/content";
import type { SiteSettings } from "../lib/validation";
import { DateLabel } from "./content-view";
export function PostList({ posts, settings }: { posts: PublicContent[]; settings: SiteSettings }) {
  return (
    <ol className="post-list">
      {posts.map((post) => (
        <li key={post.contentId}>
          <article>
            <h2>
              <a href={post.url}>{post.title}</a>
            </h2>
            {post.summary && <p>{post.summary}</p>}
            <div className="post-date">
              <DateLabel value={post.published_at} settings={settings} />
            </div>
          </article>
        </li>
      ))}
    </ol>
  );
}
