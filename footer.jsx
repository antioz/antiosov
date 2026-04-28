/* global React */
function Footer() {
  return (
    <section className="footer">
      <h2 className="footer-cta">
        <a href="https://t.me/antiosov" target="_blank" rel="noreferrer">
          на<br />
          <span className="accent">связи→</span>
        </a>
      </h2>
      <div className="footer-meta">
        <div><b>telegram</b> · <a href="https://t.me/antiosov" target="_blank" rel="noreferrer">@antiosov</a></div>
        <div><b>войсы</b> · норм</div>
        <div><b>моя тг-сетка</b> · <a href="https://t.me/webthreesome/4242" target="_blank" rel="noreferrer">подписаться</a></div>
        <div style={{ marginTop: 24 }}>© 2026 · made by hand & by agents</div>
      </div>
    </section>);

}
window.Footer = Footer;