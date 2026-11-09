import { Markdown } from "./markdown";
import type { Revision } from "../lib/content";
import type { SiteSettings } from "../lib/validation";
export function DateLabel({ value, settings }: { value: string; settings: SiteSettings }) {
  return <time dateTime={value}>{new Intl.DateTimeFormat(settings.language, { dateStyle: "long", timeZone: settings.timezone }).format(new Date(value))}</time>;
}
export function ContentView({ content, settings, date, preview = false }: { content: Revision; settings: SiteSettings; date?: string; preview?: boolean }) {
  return (
    <article className="reading-column">
      {preview && <aside className="preview-notice">Preview privat. Perubahan ini belum tentu sudah diterbitkan.</aside>}
      <header className="article-header">
        <h1>{content.title}</h1>
        {content.summary && <p className="article-summary">{content.summary}</p>}
        <div className="article-meta">
          <span>{settings.author}</span>
          {date && <DateLabel value={date} settings={settings} />}
        </div>
      </header>
      {content.image && <img className="cover-image" src={content.image} alt="" />}
      <Markdown source={content.markdown} />
      <a className="back-link" href="/">
        Kembali ke semua tulisan
      </a>
    </article>
  );
}
