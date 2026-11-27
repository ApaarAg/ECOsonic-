import React, { useEffect, useRef, useState } from 'react';
import { ValleyAudioStore } from './valley/audio';
import { ValleyEngine } from './valley/ValleyEngine';
import { StudioDrawer, StudioSection } from './components/StudioDrawer';

export default function App() {
  const valleyRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<ValleyEngine | null>(null);
  const audioRef = useRef<ValleyAudioStore | null>(null);

  const [loaded, setLoaded] = useState(false);
  const [introShown, setIntroShown] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [isHovered, setIsHovered] = useState(false);
  const [activeSection, setActiveSection] = useState<StudioSection>(null);

  useEffect(() => {
    const container = valleyRef.current;
    if (!container) return;

    const audioStore = new ValleyAudioStore();
    audioStore.initAudio();
    audioRef.current = audioStore;

    let shown = false;
    const engine = new ValleyEngine(
      container,
      () => setLoaded(true),
      () => {
        if (!shown) {
          shown = true;
          setIntroShown(true);
        }
      },
      audioStore,
    );
    engineRef.current = engine;

    return () => {
      engine.destroy();
      engineRef.current = null;
      audioStore.dispose();
      audioRef.current = null;
    };
  }, []);

  const handleToggleSound = () => {
    const store = audioRef.current;
    if (!store || !store.isInitialized) return;
    const muted = store.toggleMute();
    setIsMuted(muted);
  };

  const handleGoEnter = () => {
    setIsHovered(true);
    engineRef.current?.startHoverTransition();
  };

  const handleGoLeave = () => {
    setIsHovered(false);
    engineRef.current?.stopHoverTransition();
  };

  return (
    <>
      <div
        id="valley"
        ref={valleyRef}
        aria-hidden="true"
        data-testid="valley-scene"
        data-loaded={String(loaded)}
        data-hover-transition={String(isHovered)}
      >
        <div className="js-canvas-container" />
      </div>

      <div className={`ui${introShown ? ' on' : ''}`} id="ui">
        <header className="fh-header">
          <a
            className="logo"
            href="#top"
            aria-label="ECOsonic"
            onClick={(e) => {
              e.preventDefault();
              setActiveSection(null);
            }}
          >
            ECOsonic
          </a>
          <nav className="fh-nav" aria-label="Main">
            <a
              href="#work"
              onClick={(e) => {
                e.preventDefault();
                setActiveSection('work');
              }}
            >
              Work
            </a>
            <a
              href="#about"
              onClick={(e) => {
                e.preventDefault();
                setActiveSection('about');
              }}
            >
              About
            </a>
            <a
              href="#journal"
              onClick={(e) => {
                e.preventDefault();
                setActiveSection('journal');
              }}
            >
              Journal
            </a>
            <a
              className="pill"
              href="#contact"
              onClick={(e) => {
                e.preventDefault();
                setActiveSection('contact');
              }}
            >
              Let’s talk
            </a>
          </nav>
        </header>

        <section className="hero">
          <h1>ECOsonic</h1>
          <p className="cap">
            Rooted in nature.
            <br />
            Built for what’s next.
          </p>
          <a
            className="go"
            href="#work"
            id="go"
            aria-label="See our work"
            onPointerEnter={handleGoEnter}
            onPointerLeave={handleGoLeave}
            onFocus={handleGoEnter}
            onBlur={handleGoLeave}
            onClick={(e) => {
              e.preventDefault();
              setActiveSection('work');
            }}
          >
            <svg viewBox="0 0 24 24">
              <path d="M4 12h16M14 6l6 6-6 6" />
            </svg>
          </a>
        </section>

        <div className="corner">
          <span>Scroll to wander</span>
          <i />
          <button
            type="button"
            className="sound"
            id="sound"
            aria-pressed={!isMuted}
            aria-label="Ambient sound"
            onClick={handleToggleSound}
          >
            <svg viewBox="0 0 24 24">
              <path d="M4 9.5v5h3.5L12 18V6L7.5 9.5Z" />
              <path className="w" d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
              <path className="x" d="m16 10 4 4m0-4-4 4" />
            </svg>
          </button>
        </div>
      </div>

      <div className={`loader${loaded ? ' gone' : ''}`} id="loader" aria-hidden="true">
        <span />
      </div>

      <StudioDrawer
        section={activeSection}
        onClose={() => setActiveSection(null)}
        onSelectSection={(next) => setActiveSection(next)}
      />
    </>
  );
}
