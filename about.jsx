/* global React */
function About() {
  return (
    <section className="section section--about">
      <div className="about">
        <div className="about-left">
          <div className="section-tag">002 / ПАРУ СЛОВ</div>
          <div className="avatar" aria-hidden="true" style={{ width: '100%', maxWidth: 240, aspectRatio: '1 / 1', alignSelf: 'center', borderRadius: '50%', overflow: 'hidden', border: '1px solid var(--line)', position: 'relative' }}>
            <img src="assets/avatar.jpg" alt="Дмитрий Антиосов" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          </div>
          <div className="about-meta">
            <div className="row"><span>статус</span><b>в строю</b></div>
            <div className="row"><span>стаж</span><b>9,8 лет</b></div>
            <div className="row"><span>профиль</span><b>creative dir.</b></div>
            <div className="row"><span>команды</span><b>люди + AI</b></div>
          </div>
        </div>
        <div>
          <p className="about-text">
            <span className="hi">Привет,</span> меня зовут Дмитрий Антиосов, я <strong>креативный перфомансье</strong> с 10-летним стажем. Во времена, когда все носились с вирусными идеями, а успешной автоматизацией считалось, если не приходится орать, потом делать всё самому — писал процессы, считал цифры, анализировал цвета на баннерах и строил деревья гипотез.
            <br /><br />
            Сегодня так же собираю команды под задачи, только всё больше ролей занимают <strong>ИИ-агенты</strong>. При этом твёрдо стою на позиции, что нет ничего важнее применения и усложнения собственного интеллекта. Изучаю системное мышление, практикую логику и философию, читаю сложные тексты, много пишу и останавливаться не собираюсь.
          </p>
          <div className="about-actions">
            <a className="btn primary" href="portfolio.html">
              <span>портфолио</span>
              <span className="arrow">→</span>
            </a>
<a className="btn" href="https://t.me/antiosov" target="_blank" rel="noreferrer">
              <span>связаться</span>
              <span className="arrow">↗</span>
            </a>
          </div>
        </div>
      </div>
    </section>);

}
window.About = About;