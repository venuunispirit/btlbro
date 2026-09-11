import React, { useState, useEffect, useRef } from "react";
import {
  Lightbulb, Handshake, TrendingUp, Filter, Users, ShoppingBag,
  Search, Megaphone, ThumbsUp, Target, HeartHandshake,
} from "lucide-react";

const services = [
  { label: "Creative Media", icon: Lightbulb },
  { label: "Business Development", icon: Handshake },
  { label: "Revenue Generation", icon: TrendingUp },
  { label: "Lead Generation", icon: Filter },
  { label: "B2B Tie-ups", icon: Users },
  { label: "Retail Branding & Placement", icon: ShoppingBag },
  { label: "Field Research", icon: Search },
  { label: "Digital Marketing", icon: Megaphone },
  { label: "Social Media Marketing", icon: ThumbsUp },
  { label: "ATL / TTL / BTL", icon: Target },
  { label: "CSR Campaigns", icon: HeartHandshake },
];

const BASE_RADIUS = 270;
const N = services.length;
const ANGLE_STEP = 360 / N;
const jitterR = [0, 14, -10, 10, -14, 12, 0, -12, 10, -10, 14];
const jitterA = [0, 1.3, -1, 1.3, -1.3, 1, -1.3, 1.3, -1, 1.3, -1.3];
const sizes = [138, 128, 122, 132, 124, 134, 128, 122, 130, 126, 136];

const rings = [
  { size: 250, base: "rgba(24,24,24,0.07)", arc: "rgba(242,112,29,0.6)", deg: 46, dur: 7, rev: false },
  { size: 340, base: "rgba(242,112,29,0.14)", arc: "rgba(242,112,29,0.55)", deg: 60, dur: 9, rev: true },
  { size: 420, base: "rgba(24,24,24,0.06)", arc: "rgba(242,112,29,0.5)", deg: 38, dur: 12, rev: false },
  { size: 500, base: "rgba(242,112,29,0.11)", arc: "rgba(242,112,29,0.45)", deg: 54, dur: 14, rev: true },
  { size: 580, base: "rgba(24,24,24,0.05)", arc: "rgba(242,112,29,0.4)", deg: 34, dur: 17, rev: false },
  { size: 660, base: "rgba(242,112,29,0.09)", arc: "rgba(242,112,29,0.35)", deg: 48, dur: 20, rev: true },
];

function toXY(angleDeg, radius) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: Math.sin(rad) * radius, y: -Math.cos(rad) * radius };
}

/* ---- Sound helpers (Web Audio API, no external files) ---- */
let audioCtx = null;
function getAudioCtx() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  } catch {
    return null;
  }
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** Soft whoosh — filtered noise sweep */
function playWhoosh() {
  if (prefersReducedMotion()) return;
  const ctx = getAudioCtx();
  if (!ctx) return;
  const dur = 0.45;
  const t = ctx.currentTime;

  const bufferSize = ctx.sampleRate * dur;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const bandpass = ctx.createBiquadFilter();
  bandpass.type = "bandpass";
  bandpass.frequency.setValueAtTime(300, t);
  bandpass.frequency.exponentialRampToValueAtTime(1800, t + dur * 0.6);
  bandpass.frequency.exponentialRampToValueAtTime(400, t + dur);
  bandpass.Q.value = 0.8;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.12, t + 0.08);
  gain.gain.linearRampToValueAtTime(0, t + dur);

  source.connect(bandpass).connect(gain).connect(ctx.destination);
  source.start(t);
  source.stop(t + dur);
}

/** Gentle chime — three soft harmonics */
function playChime() {
  if (prefersReducedMotion()) return;
  const ctx = getAudioCtx();
  if (!ctx) return;
  const t = ctx.currentTime;
  const notes = [523, 659, 784]; // C5, E5, G5
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;

    const gain = ctx.createGain();
    const start = t + i * 0.12;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.09, start + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.9);

    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.9);
  });
}

export default function IntroScreen({ onComplete }) {
  const screenRef = useRef(null);
  const canvasRef = useRef(null);
  const timers = useRef([]);

  const [stage, setStage] = useState("");
  const [canvasScale, setCanvasScale] = useState(1);
  const [flyTransform, setFlyTransform] = useState(null);

  // Fit canvas to viewport
  useEffect(() => {
    function fit() {
      const margin = 60;
      const avail = Math.min(window.innerWidth - margin, window.innerHeight - margin);
      setCanvasScale(Math.max(0.42, Math.min(1, avail / 820)));
    }
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  // Timeline orchestration
  useEffect(() => {
    const stages = [
      { cls: "stage-logo", delay: 150 },
      { cls: "stage-cards-out", delay: 500 },
      { cls: "stage-rings", delay: 500 },
      { cls: "stage-spin", delay: 1200 },
      { cls: "stage-collapse", delay: 6200 },
      { cls: "stage-fly", delay: 6800 },
      { cls: "stage-fade", delay: 7500 },
    ];
    const removeStages = [
      { cls: "stage-cards-out", delay: 6200 },
      { cls: "stage-collapse", delay: 7200 },
    ];

    // Clear existing timers
    timers.current.forEach(clearTimeout);
    timers.current = [];

    // Reset
    setStage("");
    void screenRef.current?.offsetWidth;

    // Sound effects at key moments
    timers.current.push(setTimeout(() => playWhoosh(), 150));  // logo appears
    timers.current.push(setTimeout(() => playChime(), 6800)); // intro completes

    // Add stages
    stages.forEach(({ cls, delay }) => {
      timers.current.push(
        setTimeout(() => setStage((prev) => (prev ? `${prev} ${cls}` : cls)), delay)
      );
    });

    // Remove stages
    removeStages.forEach(({ cls, delay }) => {
      timers.current.push(
        setTimeout(() => {
          setStage((prev) => {
            if (!prev) return prev;
            return prev
              .split(" ")
              .filter((s) => s !== cls)
              .join(" ");
          });
        }, delay)
      );
    });

    // Compute fly target (navbar logo position)
    timers.current.push(
      setTimeout(() => {
        const navLogo = document.querySelector(".logo");
        if (navLogo) {
          const rect = navLogo.getBoundingClientRect();
          const hubEl = screenRef.current?.querySelector(".intro-hub");
          if (hubEl) {
            const hubRect = hubEl.getBoundingClientRect();
            const hubCX = hubRect.left + hubRect.width / 2;
            const hubCY = hubRect.top + hubRect.height / 2;
            const navCX = rect.left + rect.width / 2;
            const navCY = rect.top + rect.height / 2;
            const dx = navCX - hubCX;
            const dy = navCY - hubCY;
            setFlyTransform({ dx, dy, scale: 0.45 });
          }
        }
      }, 6800)
    );

    // Complete -> transition to site
    timers.current.push(
      setTimeout(() => {
        onComplete?.();
      }, 8200)
    );

    return () => timers.current.forEach(clearTimeout);
  }, [onComplete]);

  return (
    <>
      <style>{CSS}</style>
      <div
        ref={screenRef}
        className={`intro-screen ${stage}`}
      >
        <div className="intro-vignette" />

        <div
          className="intro-canvas"
          ref={canvasRef}
          style={{ transform: `scale(${canvasScale})` }}
        >
          {/* Rings */}
          <div className="intro-rings">
            {rings.map((r, i) => (
              <div
                key={i}
                className="intro-ring"
                style={{
                  width: r.size,
                  height: r.size,
                  "--rb": r.base,
                  "--ra": r.arc,
                  "--deg": `${r.deg}deg`,
                  "--dur": `${r.dur}s`,
                  "--dir": r.rev ? "reverse" : "normal",
                }}
              />
            ))}
          </div>

          {/* Items */}
          <div className="intro-items">
            {services.map((s, j) => {
              const angle = j * ANGLE_STEP + jitterA[j];
              const radius = BASE_RADIUS + jitterR[j];
              const { x, y } = toXY(angle, radius);
              const size = sizes[j];
              const Icon = s.icon;

              return (
                <div
                  key={j}
                  className="intro-item"
                  style={{
                    "--tx": `${x.toFixed(1)}px`,
                    "--ty": `${y.toFixed(1)}px`,
                    "--delay": `${j * 0.07}s`,
                    "--delay-back": `${(N - 1 - j) * 0.06}s`,
                  }}
                >
                  <div className="intro-item-inner">
                    <div
                      className="intro-bubble"
                      style={{ width: size, height: size }}
                    >
                      <Icon size={22} strokeWidth={1.7} color="#F2701D" />
                      <span className="intro-bubble-label">{s.label}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Hub / Logo */}
          <div
            className="intro-hub"
            style={
              flyTransform
                ? {
                    transform: `translate(calc(-50% + ${flyTransform.dx}px), calc(-50% + ${flyTransform.dy}px)) scale(${flyTransform.scale})`,
                    transition: "transform 0.9s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.9s ease",
                    opacity: 0.95,
                  }
                : undefined
            }
          >
            <div className="intro-wordmark">
              BTL<span>bro</span>
            </div>
            <div className="intro-tagline">Your growth ecosystem</div>
          </div>
        </div>

        {/* Skip button */}
        <button
          className="intro-skip"
          onClick={() => onComplete?.()}
        >
          Skip Intro
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="13 17 18 12 13 7" />
            <polyline points="6 17 11 12 6 7" />
          </svg>
        </button>
      </div>
    </>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Zilla+Slab:wght@600;700&family=Inter:wght@400;500;600;700&display=swap');

.intro-screen {
  --orange: #F2701D;
  --ink: #181818;
  --cream: #FFFEFC;
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(circle at center, rgba(255,120,0,0.05), transparent 55%), var(--cream);
  overflow: hidden;
  transition: opacity 0.6s ease;
}
.stage-fly .intro-items { opacity: 0; transition: opacity 0.6s ease; }
.stage-fade { opacity: 0; pointer-events: none; }

.intro-vignette {
  position: absolute; inset: 0;
  background: radial-gradient(circle at center, transparent 55%, rgba(24,24,24,0.05) 100%);
  pointer-events: none;
}

.intro-canvas {
  position: relative;
  width: 820px; height: 820px;
  transform-origin: center center;
}

/* ---------- Rings ---------- */
.intro-rings {
  position: absolute; inset: 0;
  opacity: 0; transition: opacity 0.9s ease;
}
.stage-rings .intro-rings,
.stage-spin .intro-rings,
.stage-collapse .intro-rings { opacity: 1; }
.stage-fly .intro-rings { opacity: 0; transition: opacity 0.6s ease; }
.stage-fade .intro-rings { opacity: 0; }

.intro-ring {
  position: absolute; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  border-radius: 50%;
}
.intro-ring::before {
  content: ""; position: absolute; inset: 0; border-radius: 50%;
  border: 1px solid var(--rb, rgba(24,24,24,0.06));
}
.intro-ring::after {
  content: ""; position: absolute; inset: 0; border-radius: 50%;
  background: conic-gradient(from 0deg, var(--ra, rgba(242,112,29,0.5)) 0deg, rgba(242,112,29,0) var(--deg, 42deg), rgba(242,112,29,0) 360deg);
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 1.5px), #000 calc(100% - 1.5px));
  mask: radial-gradient(farthest-side, transparent calc(100% - 1.5px), #000 calc(100% - 1.5px));
  animation: introRingSweep var(--dur, 24s) linear infinite;
  animation-direction: var(--dir, normal);
}
.stage-spin .intro-ring::after {
  animation-name: introRingSweep;
}
@keyframes introRingSweep { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

/* ---------- Items ---------- */
.intro-items {
  position: absolute; inset: 0;
}

.intro-item {
  position: absolute; top: 50%; left: 50%;
  transform: translate(-50%, -50%) scale(0);
  opacity: 0; z-index: 6;
  transition: transform 0.95s cubic-bezier(0.2, 0.85, 0.25, 1), opacity 0.7s ease;
  transition-delay: var(--delay, 0s);
}
.stage-cards-out .intro-item {
  transform: translate(calc(-50% + var(--tx)), calc(-50% + var(--ty))) scale(1);
  opacity: 1;
}
.stage-collapse .intro-item {
  transform: translate(-50%, -50%) scale(0);
  opacity: 0;
  transition: transform 0.8s cubic-bezier(0.5, 0, 0.75, 0), opacity 0.5s ease;
  transition-delay: var(--delay-back, 0s);
}

.intro-item-inner { transform: rotate(0deg); }

.intro-bubble {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  border-radius: 50%; background: #fff; border: 1px solid rgba(20,20,20,0.05);
  box-shadow: 0 16px 40px rgba(25,20,15,0.07), 0 6px 16px rgba(25,20,15,0.04);
  padding: 10px; text-align: center;
}
.intro-bubble-label {
  font-size: 11.5px; font-weight: 600; color: var(--ink); line-height: 1.2; max-width: 82%;
}

/* ---------- Hub / Logo ---------- */
.intro-hub {
  position: absolute; top: 50%; left: 50%;
  transform: translate(-50%, -50%) scale(0.3);
  opacity: 0;
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  z-index: 5;
  transition: transform 1s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.9s ease;
  filter: drop-shadow(0 8px 24px rgba(242,112,29,0.0));
}
.stage-logo .intro-hub { opacity: 1; transform: translate(-50%, -50%) scale(1); }
.stage-complete .intro-hub {
  animation: introHubPulse 2.4s ease-in-out infinite;
}
@keyframes introHubPulse {
  0%, 100% { filter: drop-shadow(0 8px 24px rgba(242,112,29,0.0)); transform: translate(-50%, -50%) scale(1); }
  50% { filter: drop-shadow(0 8px 30px rgba(242,112,29,0.28)); transform: translate(-50%, -50%) scale(1.035); }
}

.intro-wordmark {
  font-family: 'Zilla Slab', serif; font-weight: 700;
  font-size: 52px; letter-spacing: -0.01em; color: var(--ink);
  white-space: nowrap; position: relative; z-index: 2;
}
.intro-wordmark span { color: var(--orange); }

.intro-tagline {
  font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 600;
  letter-spacing: 0.16em; text-transform: uppercase; color: rgba(24,24,24,0.45);
  opacity: 0; transform: translateY(6px);
  transition: opacity 0.8s ease, transform 0.8s ease;
}
.stage-complete .intro-tagline { opacity: 1; transform: translateY(0); }

/* ---------- Skip button ---------- */
.intro-skip {
  position: absolute; bottom: 36px; left: 50%;
  transform: translateX(-50%);
  display: flex; align-items: center; gap: 8px;
  padding: 11px 20px; border-radius: 999px;
  background: #fff; border: 1px solid rgba(20,20,20,0.08);
  box-shadow: 0 10px 30px rgba(25,20,15,0.08);
  font-family: 'Inter', sans-serif; font-weight: 600; font-size: 13px; color: var(--ink);
  cursor: pointer; z-index: 10;
  transition: box-shadow 0.2s ease, opacity 0.3s ease;
}
.intro-skip:hover {
  box-shadow: 0 14px 36px rgba(242,112,29,0.18);
}
.stage-fade .intro-skip { opacity: 0; pointer-events: none; }

@media (prefers-reduced-motion: reduce) {
  .intro-items, .intro-ring::after { animation: none !important; }
}
`;
