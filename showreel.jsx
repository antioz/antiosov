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
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
            <iframe
              src="https://kinescope.io/embed/dZ4XPSzyNY3iLDazh4APjG"
              allow="autoplay; fullscreen; picture-in-picture; encrypted-media; gyroscope; accelerometer; clipboard-write; screen-wake-lock;"
              frameBorder="0"
              allowFullScreen
              style={{ width: '100%', height: '100%', display: 'block' }}
            />
          </div>
        }
      </div>
    </section>);

}
window.Showreel = Showreel;