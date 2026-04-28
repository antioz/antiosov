/* global React, ReactDOM, CustomCursor, TopBar */

const CASES = [
  {
    n: "01",
    year: "2026",
    title: [<span className="accent" key="a">Контент‑завод</span>, " звезд"],
    role: "идея + пайплайн + запуск",
    client: "Пет-проект",
    body: "От инсайта до релиза. Цельный пайплайн «сбор данных — анализ — текст — музыка — постинг» с минимальным участием человека, в процесс активно вовлечены 1–2 кожаных мешка. Затраты стремятся к нулю. Тесты пройдены, работа идёт, готов к масштабированию. Кстати, есть окошко для инвестиций.",
    tags: ["ИИ", "автоматизация", "контент"],
    flip: false,
    light: false,
    imgs: ["assets/1-1.png", "assets/1-2.png"],
    imgPos: ["center center", "center top"],
    blur: [3, 0],
  },
  {
    n: "02",
    year: "2026",
    title: [<span className="accent" key="a">Landing page</span>, " builder"],
    role: "продукт",
    client: "Пет-проект",
    body: "Топовый оркестр агентов для автоматического создания рекламных лендингов. Зашкаливающее количество маркетинговых трюков на квадратный килобайт.",
    tags: ["ИИ", "автоматизация", "маркетинг"],
    flip: true,
    light: false,
    imgs: ["assets/2-1.jpg", "assets/2-2.jpg"],
    imgPos: ["center center", "center center"],
    blur: [2, 2],
  },
  {
    n: "03",
    year: "2026",
    title: ["ИИ-ролики для ", <span className="accent" key="a">ВТБ</span>],
    role: "продакшн",
    client: "ВТБ",
    body: "Получил заказ, собрал команду, всё сделали в лучшем виде. Ищите на просторах рунета. Идея на стороне заказчика.",
    tags: ["видео", "продакшн"],
    flip: false,
    light: false,
    imgs: ["assets/3-1.PNG", "assets/3-2.PNG"],
    imgPos: ["center center", "center center"],
  },
  {
    n: "04",
    year: "",
    title: ["Новый продукт на ", <span className="accent" key="a">рынке США</span>],
    role: "СМО",
    client: "Hoof Doctor",
    body: "Маркетинг с нуля на очень консервативном рынке ухода за лошадьми. Перфоманс, кастомер суппорт, SMM, контент. Результат: $1кк выручки за первый год, 25% retention rate, сообщество ~9000 человек.",
    tags: ["перфоманс", "контент"],
    flip: true,
    light: false,
    imgs: ["assets/4-1.jpg", "assets/4-2.PNG"],
    imgPos: ["center center", "center top"],
  },
  {
    n: "05",
    year: "",
    title: ["musical.ly / ", <span className="accent" key="a">TikTok</span>, " в СНГ"],
    role: "партнёр",
    client: "TikTok",
    body: "Моя команда в составе Qmarketing занималась онбордингом первых контент-криейторов. Да, горжусь. Нет, не стыдно.",
    tags: ["контент", "онбординг"],
    flip: false,
    light: false,
    imgs: ["assets/5-1.jpg", "assets/5-2.png"],
    imgPos: ["center center", "center center"],
  },
  {
    n: "06",
    year: "2025",
    title: ["Упаковка ", <span className="accent" key="a">B2B бизнеса</span>],
    role: "стратегия + упаковка",
    client: "Альфа Констракт",
    body: "Сделал позиционирование, сайт, велком-бук, полный маркетинг-кит, мерч. HR и коммерция в восторге, работают теперь на 146% лучше.",
    tags: ["стратегия", "брендинг", "B2B"],
    flip: true,
    light: false,
    imgs: ["assets/6-1.jpg", "assets/6-2.JPEG"],
    imgPos: ["center top", "center center"],
  },
  {
    n: "07",
    year: "2025",
    title: ["Цифровая инклюзия ", <span className="accent" key="a" style={{ display: 'inline-block', whiteSpace: 'nowrap' }}>в музеях</span>],
    role: "продакшн",
    client: "Русский Музей",
    body: "Сделали с экспертами методическое пособие: редактура, дизайн, иллюстрации, вёрстка, адаптация под скринридер. 100% аналоговый труд.",
    tags: ["дизайн", "текст"],
    flip: false,
    light: false,
    imgs: ["assets/7-1.png", "assets/7-2.png"],
    imgPos: ["center top", "center top"],
  },
  {
    n: "08",
    year: "2025",
    title: ["Ролики для ", <span className="accent" key="a">Skyeng</span>],
    role: "креативный продюсер",
    client: "Skyeng",
    body: "Работал над проектом на позиции креативного продюсера со стороны агентства Smetana.",
    tags: ["видео", "продакшн"],
    flip: true,
    light: false,
    imgs: ["assets/8-1.jpg", "assets/8-2.jpg"],
    imgPos: ["center top", "center center"],
  },
  {
    n: "09",
    year: "2024",
    title: ["Дизайн спецпроектов ", <span className="accent" key="a">Forbes</span>],
    role: "спецпроекты",
    client: "Forbes",
    body: "Дизайн и вёрстка, красиво и оперативно.",
    tags: ["дизайн", "вёрстка"],
    flip: false,
    light: false,
    imgs: ["assets/9-1.png", "assets/9-2.png"],
    imgPos: ["center center", "center top"],
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
        <div className="layer l1" style={c.imgs ? { background: `url(${c.imgs[0]}) ${c.imgPos?.[0] || 'center center'} / cover no-repeat` } : {}}>
          {c.blur?.[0] > 0 && <div style={{ position: 'absolute', inset: 0, backdropFilter: `blur(${c.blur[0]}px)`, WebkitBackdropFilter: `blur(${c.blur[0]}px)` }}></div>}
          {!c.imgs && 'image · 16:10'}
        </div>
        <div className="layer l2" style={c.imgs ? { background: `url(${c.imgs[1]}) ${c.imgPos?.[1] || 'center center'} / cover no-repeat` } : {}}>
          {c.blur?.[1] > 0 && <div style={{ position: 'absolute', inset: 0, backdropFilter: `blur(${c.blur[1]}px)`, WebkitBackdropFilter: `blur(${c.blur[1]}px)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', letterSpacing: '0.3em', color: 'rgba(244,244,240,0.18)', textTransform: 'uppercase', userSelect: 'none' }}>hidden</span></div>}
          {!c.imgs && 'detail · 4:3'}
        </div>
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
      <a href="index.html" className="back-link">← главная</a>

      <section className="portfolio-hero">
        <div className="hero-name">004 / Portfolio</div>
        <h1>
          Антиосов.<br />
          <span style={{ fontStyle: 'italic', color: 'var(--accent)' }}>Найдется все.</span>
        </h1>
        <p className="sub">
          Отобрал кейсы, которые иллюстрируют мой опыт решения бизнес-задач и построения работающих систем. Показываю на карточках.
        </p>
      </section>

      {CASES.map((c) => <Case key={c.n} c={c} />)}

      <section className="portfolio-cta-block reveal">
        <p>Если хотите больше примеров или обсудить, чем могу быть полезен вашему бизнесу — давайте пообщаемся лично.</p>
        <a href="https://t.me/antiosov" target="_blank" rel="noreferrer" className="cta-btn">написать в ЛС →</a>
      </section>

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
          <div style={{ marginTop: 24 }}>© 2026</div>
        </div>
      </section>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<PortfolioApp />);
