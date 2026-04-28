/* global React */
const { useEffect: useHeroEffect, useState: useHeroState } = React;

function Hero() {
  return (
    <section className="hero">
      <div>
        <div className="hero-name">
          <span>Дмитрий Антиосов</span> · креативный директор
        </div>

        <h1 className="hero-title" aria-label="AI-native, smart, creative">
          <span className="row"><span className="word"><span className="accent">AI</span>-NATIVE</span></span>
          <span className="row"><span className="word">SMART</span></span>
          <span className="row"><span className="word">CREATIVE<span className="accent">.</span></span></span>
        </h1>
      </div>
    </section>);

}

window.Hero = Hero;