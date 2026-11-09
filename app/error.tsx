"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section className="index-column empty-state">
      <h1>Tulisan belum bisa dimuat.</h1>
      <p>Coba muat kembali halaman ini.</p>
      <button className="text-button" onClick={reset}>
        Coba lagi
      </button>
    </section>
  );
}
