/* global React */
const CLIENT_LIST = [
"TikTok", "ВТБ", "Авито", "Skyeng", "Forbes", "Русский Музей",
"Getwola", "Т-Банк", "Raiffeisen Bank", "Geekbrains", "Делимобиль",
"Freedom Finance", "Здравсити", "Док+", "Нетология", "Cofix",
"Яндекс.Практикум", "Альфа Констракт"];


function Clients() {
  const row =
  <span className="item">
      {CLIENT_LIST.map((c, i) =>
    <React.Fragment key={i}>
          <span>{c}</span>
          <span className="dot">+</span>
        </React.Fragment>
    )}
    </span>;

  return (
    <section className="clients">
      <div className="clients-tag section-tag">003 / КЛИЕНТЫ </div>
      <div className="clients-row">
        <div className="marquee">
          {row}
          {row}
        </div>
      </div>
      <div className="clients-row" style={{ marginTop: 8 }}>
        <div className="marquee reverse" style={{ opacity: 0.45 }}>
          {row}
          {row}
        </div>
      </div>
    </section>);

}
window.Clients = Clients;