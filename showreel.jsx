/* global React */
function Showreel() {
  const [playing, setPlaying] = React.useState(false);
  return (
    <section className="showreel">
      <div className="section-tag">001 / ШОУРИЛ</div>
      <div className="showreel-frame">
        {!playing ?
        <button className="play" onClick={() => setPlaying(true)} aria-label="Play showreel">
            ▸ play
          </button> :

        <div className="label">
            [ video placeholder · ссылка появится позже ]
          </div>
        }
      </div>
      <div className="showreel-meta">
        <span>FILE_ANTIOSOV_REEL_2026.mp4</span>
        <span>02 : 47 · 4K</span>
        <span>↗ заглушка</span>
      </div>
    </section>);

}
window.Showreel = Showreel;