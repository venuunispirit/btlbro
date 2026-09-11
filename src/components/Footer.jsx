import React from "react";
import { Linkedin, Instagram, Facebook, Youtube, Phone, Mail } from "lucide-react";

/* ============================================================
   BTLbro — Footer component
   Self-contained: renders its own <style> so it can be dropped
   into any page without depending on a global stylesheet.
   ============================================================ */

const footerCols = [
  { heading: "Solutions", links: ["Creative & Brand", "Business Growth", "Media & Activations", "Research & Impact"] },
  { heading: "Services", links: ["Brand Marketing", "Business Development", "Lead Generation", "BTL / ATL / TTL", "Digital Marketing", "Field Research"] },
  { heading: "Company", links: ["About", "Our Work", "Insights", "Careers", "Contact"] },
];

function Logo({ dark = false }) {
  return (
    <div className="logo">
      <svg width="20" height="20" viewBox="0 0 22 22" fill="none" aria-hidden="true">
        <circle cx="11" cy="4" r="1.8" fill="#FF7900" />
        <circle cx="4" cy="11" r="1.8" fill="#FF7900" />
        <circle cx="18" cy="11" r="1.8" fill="#FF7900" />
        <circle cx="11" cy="18" r="1.8" fill="#FF7900" />
        <circle cx="11" cy="11" r="2.3" fill={dark ? "#ffffff" : "#161616"} />
      </svg>
      <span className="logo-text">
        <span className="logo-word">
          <span style={{ color: dark ? "#fff" : "#161616" }}>BTL</span>
          <span style={{ color: "#FF7900" }}>bro</span>
        </span>
        <span className="logo-tag" style={{ color: dark ? "rgba(255,255,255,.55)" : "#949494" }}>Hyperlocal marketing, simplified.</span>
      </span>
    </div>
  );
}

export default function Footer() {
  return (
    <>
      <style>{CSS}</style>
      <footer className="footer">
        <div className="footer-top">
          <div className="footer-brand">
            <Logo dark />
            <p>Integrated marketing, activation and business growth solutions for ambitious brands.</p>
          </div>
          {footerCols.map((col) => (
            <div key={col.heading} className="footer-col">
              <h6>{col.heading}</h6>
              {col.links.map((l) => <a key={l} href="#solutions">{l}</a>)}
            </div>
          ))}
          <div className="footer-col">
            <h6>Connect</h6>
            <a href="tel:+918012345678"><Phone size={14} /> +91 80 1234 5678</a>
            <a href="mailto:hello@btlbro.com"><Mail size={14} /> hello@btlbro.com</a>
            <div className="footer-social">
              <Linkedin size={16} /><Instagram size={16} /><Facebook size={16} /><Youtube size={16} />
            </div>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} BTLbro. All rights reserved.</span>
          <div className="footer-legal">
            <a href="#privacy">Privacy Policy</a>
            <a href="#terms">Terms</a>
            <a href="#cookies">Cookies</a>
          </div>
        </div>
      </footer>
    </>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@500;700;800&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600&display=swap');

.footer {
  --ink: #161616;
  --orange: #FF7900;
  --font-display: 'Manrope', sans-serif;
  --font-body: 'Inter', sans-serif;
  --font-mono: 'IBM Plex Mono', monospace;
  --max-w: 1360px;
  --pad-desktop: 56px;
  background: var(--ink);
  color: rgba(255,255,255,.7);
  padding: 72px var(--pad-desktop) 0;
  font-family: var(--font-body);
}
.footer a { color: inherit; text-decoration: none; }
.footer p, .footer h6 { margin: 0; }

.footer .logo { display: flex; align-items: center; gap: 8px; }
.footer .logo-text { display: flex; flex-direction: column; line-height: 1.1; }
.footer .logo-word { font-family: var(--font-display); font-size: 21px; font-weight: 800; letter-spacing: -0.01em; }
.footer .logo-tag { font-size: 9px; font-weight: 500; }

.footer-top { max-width: var(--max-w); margin: 0 auto; display: grid; grid-template-columns: 1.4fr 1fr 1fr 1fr; gap: 40px; padding-bottom: 56px; border-bottom: 1px solid rgba(255,255,255,.1); }
@media (max-width: 900px) { .footer-top { grid-template-columns: 1fr 1fr; } }
@media (max-width: 560px) { .footer-top { grid-template-columns: 1fr; } }
.footer-brand p { font-family: var(--font-body); font-size: 13.5px; margin-top: 14px; line-height: 1.6; max-width: 260px; color: rgba(255,255,255,.5); }
.footer-col h6 { font-family: var(--font-mono); color: #fff; font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 16px; }
.footer-col a { display: flex; align-items: center; gap: 8px; font-family: var(--font-body); font-size: 13.5px; padding: 6px 0; color: rgba(255,255,255,.62); }
.footer-col a:hover { color: var(--orange); }
.footer-social { display: flex; gap: 14px; margin-top: 10px; color: rgba(255,255,255,.62); }
.footer-bottom { max-width: var(--max-w); margin: 0 auto; display: flex; justify-content: space-between; align-items: center; padding: 22px 0; font-family: var(--font-mono); font-size: 11.5px; flex-wrap: wrap; gap: 12px; }
.footer-legal { display: flex; gap: 20px; }
.footer-legal a:hover { color: var(--orange); }
`;
