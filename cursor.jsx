/* global React */
const { useEffect, useRef, useState } = React;

function CustomCursor() {
  const dotRef = useRef(null);
  const ringRef = useRef(null);
  const [hovering, setHovering] = useState(false);

  useEffect(() => {
    let mx = -100, my = -100;
    let rx = -100, ry = -100;
    let raf;

    function onMove(e) {
      mx = e.clientX;
      my = e.clientY;
      if (dotRef.current) {
        dotRef.current.style.transform = `translate(${mx}px, ${my}px) translate(-50%, -50%)`;
      }
    }
    function loop() {
      rx += (mx - rx) * 0.18;
      ry += (my - ry) * 0.18;
      if (ringRef.current) {
        ringRef.current.style.transform = `translate(${rx}px, ${ry}px) translate(-50%, -50%)`;
      }
      raf = requestAnimationFrame(loop);
    }
    function onOver(e) {
      const t = e.target;
      if (t.closest('a, button, .case, .showreel-frame .play, .footer-cta')) {
        setHovering(true);
      } else {
        setHovering(false);
      }
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseover', onOver);
    raf = requestAnimationFrame(loop);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseover', onOver);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <>
      <div ref={dotRef} className={`cursor ${hovering ? 'hover' : ''}`} />
      <div ref={ringRef} className="cursor-ring" style={{ opacity: hovering ? 0 : 1 }} />
    </>
  );
}

function TopBar({ showBack }) {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const hh = String(time.getHours()).padStart(2, '0');
  const mm = String(time.getMinutes()).padStart(2, '0');
  const ss = String(time.getSeconds()).padStart(2, '0');

  return (
    <div className="topbar">
      {showBack ? (
        <a href="index.html" className="brand">← <b>D.A.</b> / index</a>
      ) : (
        <div className="brand"><b>t.me/</b>antiosov</div>
      )}
      <div className="clock">
        <span className="dot" />
        <span>MSK · {hh}:{mm}:{ss}</span>
      </div>
    </div>
  );
}

window.CustomCursor = CustomCursor;
window.TopBar = TopBar;
