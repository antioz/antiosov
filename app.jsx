/* global React, ReactDOM, CustomCursor, TopBar, Hero, Showreel, About, Clients, Footer, useTweaks, TweaksPanel, TweakSection, TweakColor, TweakSelect, TweakToggle */
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#00E0A4",
  "palette": "dark",
  "monoMeta": true
}/*EDITMODE-END*/;

function applyTheme(t) {
  const root = document.documentElement.style;
  root.setProperty('--accent', t.accent);
  // pick a readable ink color for accents
  root.setProperty('--accent-ink', '#0a0a0a');
  if (t.palette === 'light') {
    root.setProperty('--bg', '#f4f4f0');
    root.setProperty('--bg-elev', '#ebebe5');
    root.setProperty('--fg', '#0a0a0a');
    root.setProperty('--fg-dim', '#777');
    root.setProperty('--fg-fade', '#bbb');
    root.setProperty('--line', '#d8d8d2');
  } else {
    root.setProperty('--bg', '#0a0a0a');
    root.setProperty('--bg-elev', '#111111');
    root.setProperty('--fg', '#f4f4f0');
    root.setProperty('--fg-dim', '#888');
    root.setProperty('--fg-fade', '#444');
    root.setProperty('--line', '#1f1f1f');
  }
}

function App() {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);

  React.useEffect(() => { applyTheme(tweaks); }, [tweaks]);

  // reveal observer
  React.useEffect(() => {
    const els = document.querySelectorAll('.reveal');
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('in'); });
    }, { threshold: 0.1 });
    els.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <>
      <CustomCursor />
      <TopBar />
      <Hero />
      <Showreel />
      <About />
      <Clients />
      <Footer />

      <TweaksPanel title="Tweaks">
        <TweakSection label="Палитра">
          <TweakSelect
            label="Фон"
            value={tweaks.palette}
            onChange={(v) => setTweak('palette', v)}
            options={[
              { value: 'dark', label: 'тёмная' },
              { value: 'light', label: 'светлая' },
            ]}
          />
          <TweakColor
            label="Акцент"
            value={tweaks.accent}
            onChange={(v) => setTweak('accent', v)}
          />
          <TweakSelect
            label="Пресеты"
            value={tweaks.accent}
            onChange={(v) => setTweak('accent', v)}
            options={[
              { value: '#D4FF3A', label: 'lime' },
              { value: '#FF4D1A', label: 'orange' },
              { value: '#FF2D6B', label: 'magenta' },
              { value: '#3D5AFE', label: 'blue' },
              { value: '#00E0A4', label: 'mint' },
              { value: '#FFFFFF', label: 'mono' },
            ]}
          />
        </TweakSection>
      </TweaksPanel>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
