import React, { useState, useEffect, useRef } from "react";
import {
  Lightbulb, Handshake, TrendingUp, Filter, Users, ShoppingBag,
  Search, Megaphone, ThumbsUp, Target, HeartHandshake,
} from "lucide-react";

/* ============================================================
   BTLbro — Orbital Ecosystem Hero
   Full-viewport hero: ecosystem fills the section absolutely,
   so the orbit is always centered with zero gap below navbar.
   ============================================================ */

const services = [
  { label: "Creative Media", icon: Lightbulb, href: "/services/creative-media" },
  { label: "Business Development", icon: Handshake, href: "/services/business-development" },
  { label: "Revenue Generation", icon: TrendingUp, href: "/services/revenue-generation" },
  { label: "Lead Generation", icon: Filter, href: "/services/lead-generation" },
  { label: "B2B Tie-ups", icon: Users, href: "/services/b2b-tieups" },
  { label: "Retail Branding & Placement", icon: ShoppingBag, href: "/services/retail-branding" },
  { label: "Field Research", icon: Search, href: "/services/field-research" },
  { label: "Digital Marketing", icon: Megaphone, href: "/services/digital-marketing" },
  { label: "Social Media Marketing", icon: ThumbsUp, href: "/services/social-media-marketing" },
  { label: "ATL / TTL / BTL", icon: Target, href: "/services/btl-marketing" },
  { label: "CSR Campaigns", icon: HeartHandshake, href: "/services/csr-campaigns" },
];

const jitter = [
  { radius: 0, angle: 0, size: 148, duration: 6.2 },
  { radius: 18, angle: 1.5, size: 138, duration: 7.4 },
  { radius: -14, angle: -1, size: 130, duration: 5.6 },
  { radius: 12, angle: 1.5, size: 142, duration: 8.1 },
  { radius: -18, angle: -1.5, size: 134, duration: 6.8 },
  { radius: 14, angle: 1, size: 144, duration: 7.9 },
  { radius: 0, angle: -1.5, size: 138, duration: 5.9 },
  { radius: -14, angle: 1.5, size: 132, duration: 8.6 },
  { radius: 12, angle: -1, size: 140, duration: 6.4 },
  { radius: -12, angle: 1.5, size: 136, duration: 7.1 },
  { radius: 18, angle: -1.5, size: 146, duration: 9.0 },
];

const BASE_RADIUS = 430;
const ANGLE_STEP = 360 / services.length;
const ORBIT_FOOTPRINT = (BASE_RADIUS + 18 + 148 / 2) * 2;

const rings = [
  { size: 420, base: "rgba(24,24,24,0.07)", arc: "rgba(242,112,29,0.6)", arcDeg: 46, duration: 16, reverse: false },
  { size: 560, base: "rgba(242,112,29,0.14)", arc: "rgba(242,112,29,0.55)", arcDeg: 60, duration: 22, reverse: true },
  { size: 680, base: "rgba(24,24,24,0.06)", arc: "rgba(242,112,29,0.5)", arcDeg: 38, duration: 27, reverse: false },
  { size: 800, base: "rgba(242,112,29,0.11)", arc: "rgba(242,112,29,0.45)", arcDeg: 54, duration: 33, reverse: true },
  { size: 900, base: "rgba(24,24,24,0.05)", arc: "rgba(242,112,29,0.4)", arcDeg: 34, duration: 40, reverse: false },
  { size: 980, base: "rgba(242,112,29,0.09)", arc: "rgba(242,112,29,0.35)", arcDeg: 48, duration: 47, reverse: true },
];

const orbitDots = [
  { ring: 1, clock: 2, size: 9, opacity: 0.9 },
  { ring: 3, clock: 5, size: 7, opacity: 0.5 },
  { ring: 1, clock: 8, size: 8, opacity: 0.7 },
  { ring: 5, clock: 10.5, size: 10, opacity: 0.85 },
  { ring: 3, clock: 0.5, size: 7, opacity: 0.45 },
  { ring: 5, clock: 6, size: 8, opacity: 0.6 },
  { ring: 0, clock: 9, size: 6, opacity: 0.5 },
];

function toXY(angleDeg, radius) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: Math.sin(rad) * radius, y: -Math.cos(rad) * radius };
}

/* ---- Sub-components ---- */

function LogoMark({ size = 54 }) {
  return null;
}

function Wordmark({ scale = 2.5 }) {
  return (
    <span className="ob-wordmark" style={{ fontSize: 26 * scale }}>
      BTL<span className="ob-wordmark-orange">bro</span>
    </span>
  );
}

function Rings() {
  return (
    <div className="ob-rings" aria-hidden="true">
      {rings.map((r, i) => (
        <div
          key={i}
          className="ob-ring"
          style={{
            width: r.size, height: r.size,
            "--ring-base": r.base,
            "--ring-arc": r.arc,
            "--arc-deg": r.arcDeg,
            "--ring-dur": `${r.duration}s`,
            "--ring-dir": r.reverse ? "reverse" : "normal",
          }}
        >
          {orbitDots.filter((d) => d.ring === i).map((d, j) => {
            const { x, y } = toXY((d.clock / 12) * 360, r.size / 2);
            return (
              <span
                key={j}
                className="ob-orbit-dot"
                style={{
                  left: `calc(50% + ${x}px)`, top: `calc(50% + ${y}px)`,
                  width: d.size, height: d.size, opacity: d.opacity,
                }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

function ServiceBubble({ service, j }) {
  const angle = j * ANGLE_STEP + jitter[j].angle;
  const radius = BASE_RADIUS + jitter[j].radius;
  const { x: fx, y: fy } = toXY(angle, radius);
  const size = jitter[j].size;
  const Icon = service.icon;

  return (
    <div className="ob-orbit-item" style={{ left: `calc(50% + ${fx}px)`, top: `calc(50% + ${fy}px)` }}>
      <a
        href={service.href}
        className="ob-bubble"
        style={{
          width: size, height: size,
          "--fx": `${(j % 2 === 0 ? 1 : -1) * 3}px`,
          "--fy": `${(j % 3 === 0 ? -1 : 1) * 5}px`,
          animationDuration: `${jitter[j].duration}s`,
        }}
      >
        <Icon size={Math.round(size * 0.16)} strokeWidth={1.7} color="#F2701D" />
        <span className="ob-bubble-label">{service.label}</span>
        <span className="ob-bubble-go">↗</span>
      </a>
    </div>
  );
}

/* ---- Main OrbitHero ---- */

export default function OrbitHero() {
  const heroRef = useRef(null);
  const [parallax, setParallax] = useState({ x: 0, y: 0 });
  const [isDesktop, setIsDesktop] = useState(true);
  const [orbitScale, setOrbitScale] = useState(1);

  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 980);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    if (!heroRef.current) return;
    const el = heroRef.current;
    const compute = () => {
      const rect = el.getBoundingClientRect();
      const scaleX = Math.min(1, (rect.width - 48) / ORBIT_FOOTPRINT);
      const scaleY = Math.min(1, (rect.height - 80) / ORBIT_FOOTPRINT);
      setOrbitScale(Math.max(0.55, Math.min(scaleX, scaleY)));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onMouseMove = (e) => {
    if (!isDesktop || !heroRef.current) return;
    const rect = heroRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const nx = (e.clientX - cx) / (rect.width / 2);
    const ny = (e.clientY - cy) / (rect.height / 2);
    setParallax({ x: Math.max(-1, Math.min(1, nx)) * 6, y: Math.max(-1, Math.min(1, ny)) * 6 });
  };

  const onMouseLeave = () => setParallax({ x: 0, y: 0 });

  return (
    <>
      <style>{CSS}</style>
      <section
        className="ob-hero"
        id="top"
        ref={heroRef}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
      >
        <div className="ob-hero-warmth" aria-hidden="true" />

        <div
          className="ob-ecosystem ob-ecosystem-desktop"
          style={{ transform: `translate(${parallax.x}px, ${parallax.y}px) scale(${orbitScale})` }}
        >
          <Rings />
          <div className="ob-hub">
            <LogoMark size={54} />
            <Wordmark scale={2.5} />
          </div>
          {services.map((s, j) => (
            <ServiceBubble key={s.label} service={s} j={j} />
          ))}
        </div>

        <div className="ob-ecosystem-mobile">
          <div className="ob-hub ob-hub-mobile">
            <LogoMark size={40} />
            <Wordmark scale={1.6} />
          </div>
          <div className="ob-mobile-grid">
            {services.map((s) => {
              const Icon = s.icon;
              return (
                <a href={s.href} className="ob-bubble ob-bubble-mobile" key={s.label}>
                  <Icon size={22} strokeWidth={1.7} color="#F2701D" />
                  <span className="ob-bubble-label">{s.label}</span>
                </a>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}

/* ---- Scoped CSS ---- */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Zilla+Slab:wght@600;700&family=Inter:wght@400;500;600;700&display=swap');

/* Hero fills the viewport — no min-height tricks, no flex centering */
.ob-hero {
  --ob-orange: #F2701D;
  --ob-ink: #181818;
  position: relative;
  width: 100%;
  height: 100vh;
  overflow: hidden;
  max-width: none !important;
  margin: 0 !important;
  padding: 0 !important;
  background: #FFFEFC;
}
@media (max-width: 640px) {
  .ob-hero { height: auto; min-height: 100vh; padding: 20px 0 40px !important; overflow: visible; }
}

.ob-hero-warmth {
  position: absolute; inset: 0;
  background: none;
  pointer-events: none; z-index: 0;
}

/* Desktop ecosystem — absolutely fills the hero, orbit centered */
.ob-ecosystem-desktop {
  position: absolute !important;
  inset: 0 !important;
  width: 100% !important;
  max-width: none !important;
  height: auto !important;
  margin: 0 !important;
  padding: 0 !important;
  transform-origin: center center;
  transition: transform .3s ease-out;
}
@media (max-width: 979px) { .ob-ecosystem-desktop { display: none; } }

.ob-rings { position: absolute; inset: 0; }
.ob-ring {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  border-radius: 50%;
}
.ob-ring::before {
  content: ""; position: absolute; inset: 0; border-radius: 50%;
  border: 1px solid var(--ring-base, rgba(24,24,24,0.05));
}
.ob-ring::after {
  content: ""; position: absolute; inset: 0; border-radius: 50%;
  background: conic-gradient(from 0deg,
    var(--ring-arc, rgba(242,112,29,0.5)) 0deg,
    rgba(242,112,29,0) calc(var(--arc-deg, 40) * 1deg),
    rgba(242,112,29,0) 360deg);
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 1.5px), #000 calc(100% - 1.5px));
  mask: radial-gradient(farthest-side, transparent calc(100% - 1.5px), #000 calc(100% - 1.5px));
  animation: ob-ringSweep var(--ring-dur, 30s) linear infinite;
  animation-direction: var(--ring-dir, normal);
  filter: blur(0.3px);
}
@keyframes ob-ringSweep { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

.ob-orbit-dot {
  position: absolute; border-radius: 50%; transform: translate(-50%, -50%);
  background: radial-gradient(circle at 34% 28%, #ffc899 0%, var(--ob-orange) 55%, #c85c12 100%);
  box-shadow: 0 0 0 3px rgba(242,112,29,0.10), 0 0 12px rgba(242,112,29,0.4);
}

.ob-hub {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  display: flex; flex-direction: column; align-items: center; gap: 10px; z-index: 3;
}
.ob-wordmark {
  font-family: 'Zilla Slab', serif; font-weight: 700; letter-spacing: -0.01em; color: var(--ob-ink);
}
.ob-wordmark-orange { color: var(--ob-orange); }

.ob-orbit-item { position: absolute; transform: translate(-50%, -50%); z-index: 2; }
.ob-bubble {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  border-radius: 50%; background: #FFFFFF; border: 1px solid rgba(20,20,20,0.04);
  box-shadow: 0 18px 45px rgba(25,20,15,0.055), 0 6px 18px rgba(25,20,15,0.035);
  padding: 10px; text-align: center; position: relative; overflow: hidden;
  animation-name: ob-orbitFloat; animation-timing-function: ease-in-out;
  animation-iteration-count: infinite; animation-direction: alternate;
  transition: transform .22s ease, border-color .22s ease, box-shadow .22s ease;
}
@keyframes ob-orbitFloat { 0% { transform: translate(0,0); } 100% { transform: translate(var(--fx), var(--fy)); } }
.ob-bubble:hover {
  transform: translateY(-4px) scale(1.025) !important;
  border-color: rgba(255,120,0,0.18);
  box-shadow: 0 22px 55px rgba(25,20,15,0.08), 0 8px 22px rgba(255,120,0,0.06);
  animation-play-state: paused; z-index: 5;
}
.ob-bubble:hover svg { transform: translateY(-2px); }
.ob-bubble svg { transition: transform .2s ease; flex-shrink: 0; }
.ob-bubble-label { font-size: 12px; font-weight: 600; color: var(--ob-ink); line-height: 1.2; max-width: 76%; }
.ob-bubble-go {
  position: absolute; top: 10px; right: 14px; font-size: 12px;
  color: var(--ob-orange); opacity: 0; transition: opacity .2s ease;
}
.ob-bubble:hover .ob-bubble-go { opacity: 1; }

/* ---- Mobile ecosystem ---- */
.ob-ecosystem-mobile { display: none; }
@media (max-width: 979px) {
  .ob-ecosystem-mobile { display: block; padding: 0 20px; text-align: center; }
  .ob-hub-mobile { position: static; transform: none; margin: 0 auto 36px; }
  .ob-mobile-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; max-width: 460px; margin: 0 auto; }
  .ob-mobile-grid a:nth-child(4n+1) { margin-top: 26px; }
  .ob-mobile-grid a:nth-child(4n+4) { margin-top: 26px; }
  .ob-bubble-mobile {
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
    background: #fff; border: 1px solid rgba(20,20,20,0.06); border-radius: 20px;
    box-shadow: 0 10px 28px rgba(25,20,15,0.06);
    padding: 20px 10px; text-align: center;
    animation: ob-orbitFloat 6.5s ease-in-out infinite alternate;
  }
  .ob-bubble-mobile:nth-child(odd) { animation-duration: 7.2s; --fx: 2px; --fy: -4px; }
  .ob-bubble-mobile:nth-child(even) { animation-duration: 5.8s; --fx: -2px; --fy: 4px; }
  .ob-bubble-mobile .ob-bubble-label { font-size: 12.5px; max-width: none; }
}
@media (prefers-reduced-motion: reduce) {
  .ob-bubble, .ob-bubble-mobile, .ob-ring, .ob-ring::after { animation: none !important; }
}
`;
