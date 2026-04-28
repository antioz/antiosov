/* global React, ReactDOM, CustomCursor, TopBar */

const CASES = [
  {
    n: "01",
    year: "2025",
    title: ["AI-агенты для", <span className="accent" key="a">креативного</span>, " отдела"],
    role: "Стратегия + оркестрация",
    client: "Финтех-бренд",
    body: "Собрал гибридную команду из четырёх человек и шести агентов. Запустили цикл: бриф → референсы → раскадровка → копи → тест → пост в течение часа. Снизили стоимость креатива в 7×, увеличили частоту публикаций втрое.",
    tags: ["AI ops", "creative pipeline", "performance"],
    flip: false,
    light: false,
  },
  {
    n: "02",
    year: "2024",
    title: ["Performance-вселенная для ", <span className="accent" key="a">e-com</span>],
    role: "Performance creative lead",
    client: "Маркетплейс",
    body: "Полный креативный фреймворк: 240+ баннеров в неделю, A/B-тесты по цвету, типографике, обещанию. Построил дерево гипотез, которое до сих пор питает закупку. CTR +38%, CAC −22%.",
    tags: ["growth", "ab-tests", "system"],
    flip: true,
    light: false,
  },
  {
    n: "03",
    year: "2024",
    title: ["Нарративная кампания для ", <span className="accent" key="a">культурного</span>, " института"],
    role: "Креативный директор",
    client: "Музей",
    body: "Серия из 12 видео и 40 постов о том, как смотреть на искусство. Без дидактики. Сделали приложение-гид с агентом-куратором, который ведёт диалог по выбранной картине. 1.2M просмотров, очереди на офлайн-маршрут.",
    tags: ["content", "AI guide", "voice"],
    flip: false,
    light: true,
  },
  {
    n: "04",
    year: "2023",
    title: ["Внутренний ", <span className="accent" key="a">копи-движок</span>, " на агентах"],
    role: "Архитектор процесса",
    client: "EdTech",
    body: "Процесс, который собирает лендинги под каждый запуск курса за 3 часа: оффер, заголовки, прогревочные письма, контент-план. На входе — продукт-бриф, на выходе — готовая воронка. Скорость запуска курсов выросла в 4×.",
    tags: ["edtech", "automation", "lp"],
    flip: true,
    light: false,
  },
  {
    n: "05",
    year: "2022",
    title: ["Бренд-голос ", <span className="accent" key="a">для каршеринга</span>],
    role: "Tone of voice",
    client: "Mobility",
    body: "Переписали все интерфейсы, пуши и письма на живой человеческий язык. Переписали правила. Сделали внутренний словарь и checks для редакторов. NPS текстов вырос с 24 до 68 за полгода.",
    tags: ["copy", "tov", "ux"],
    flip: false,
    light: false,
  },
  {
    n: "06",
    year: "2021—…",
    title: ["Параллельно: ", <span className="accent" key="a">личная практика</span>],
    role: "Mind-stack",
    client: "Сам",
    body: "Системное мышление, формальная логика, философия. Веду заметки, разбираю длинные тексты, пишу эссе. Не считаю это хобби — это рабочий инструмент: мышление быстрее, чем модель.",
    tags: ["thinking", "writing", "long form"],
    flip: true,
    light: false,
  },
];

function Case({ c }) {
  return (
    <article className={`case ${c.flip ? 'flip' : ''} ${c.light ? 'light' : ''} reveal`} data-screen-label={`case-${c.n}`}>
      <div className="num">
        <b>{c.n}</b>
        <div>{c.year}</div>
        <div style={{ marginTop: 16 }}>{c.client}</div>
        <div>{c.role}</div>
      </div>
      <div className="body">
        <h2>{c.title}</h2>
        <p>{c.body}</p>
        <div className="meta">
          {c.tags.map((t, i) => <span key={i}>{t}</span>)}
        </div>
      </div>
      <div className="visual" aria-hidden="true">
        <div className="layer l1">image · 16:10</div>
        <div className="layer l2">detail · 4:3</div>
        <div className="layer l3">{c.n}</div>
      </div>
    </article>
  );
}

function PortfolioApp() {
  // reveal observer
  React.useEffect(() => {
    const els = document.querySelectorAll('.reveal');
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('in'); });
    }, { threshold: 0.08 });
    els.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <>
      <CustomCursor />
      <a href="index.html" className="back-link">← index</a>

      <section className="portfolio-hero">
        <div className="hero-name">004 / Portfolio · 2021—2026</div>
        <h1>
          немного из<br />
          того, что<br />
          <span style={{ fontStyle: 'italic', color: 'var(--accent)' }}>делал.</span>
        </h1>
        <p className="sub">
          Кейсы — выборочно. Где-то <em>стратегия</em>, где-то <em>оркестрация</em> агентов, где-то всё руками. Полный список — в личке.
        </p>
      </section>

      {CASES.map((c) => <Case key={c.n} c={c} />)}

      <section className="footer">
        <h2 className="footer-cta">
          <a href="https://t.me/antiosov" target="_blank" rel="noreferrer">
            на<br />
            <span className="accent">связь →</span>
          </a>
        </h2>
        <div className="footer-meta">
          <div>telegram · <a href="https://t.me/antiosov" target="_blank" rel="noreferrer">@antiosov</a></div>
          <div>response · в течение дня</div>
          <div>зона · MSK / GMT+3</div>
          <div style={{ marginTop: 24 }}>© 2026</div>
        </div>
      </section>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<PortfolioApp />);
