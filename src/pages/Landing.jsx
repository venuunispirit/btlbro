import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import {
  ArrowRight, ArrowUpRight, MapPin, Users, Target, Radio,
  Wallet, Quote, Linkedin, Instagram, Facebook, Youtube,
  ChevronLeft, ChevronRight, Lightbulb, TrendingUp, Calendar
} from "lucide-react";
import OrbitHero from "../components/OrbitHero.jsx";
import Footer from "../components/Footer.jsx";
import IntroScreen from "../components/IntroScreen.jsx";
import CampaignModal from "../components/CampaignModal.jsx";
import { isCompleteCampaign } from "../utils/campaignMath.js";
import MarketingTool from "./MarketingTool.jsx";

/* ============================================================
   BTLbro — Integrated Marketing & Business Growth Partner
   Fetches content from CMS API (/api/content). Falls back to
   hardcoded data if API is unavailable.
   ============================================================ */

const IMG = {
  hero: "https://images.unsplash.com/photo-1600880292203-757bb62b4baf?auto=format&fit=crop&w=1800&q=80",
  creative: "https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=1200&q=80",
  growth: "https://images.unsplash.com/photo-1521737604893-d14cc237f11d?auto=format&fit=crop&w=1200&q=80",
  media: "https://images.unsplash.com/photo-1573164713988-8665fc963095?auto=format&fit=crop&w=1200&q=80",
  research: "https://images.unsplash.com/photo-1531482615713-2afd69097998?auto=format&fit=crop&w=1200&q=80",
  case1: "https://images.unsplash.com/photo-1556761175-5973dc0f32e7?auto=format&fit=crop&w=1200&q=80",
  case2: "https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?auto=format&fit=crop&w=1200&q=80",
  case3: "https://images.unsplash.com/photo-1560264280-88b68371db39?auto=format&fit=crop&w=1200&q=80",
  csr: "https://images.unsplash.com/photo-1593113646773-028c64a8f1b8?auto=format&fit=crop&w=1600&q=80",
  bizdev: "https://images.unsplash.com/photo-1556157382-97eda2d62296?auto=format&fit=crop&w=1200&q=80",
};

/* ---------------- CMS Content Hook ---------------- */

function useContent() {
  const [content, setContent] = useState({});
  useEffect(() => {
    fetch("/api/content")
      .then((r) => r.json())
      .then((d) => { if (d.content) setContent(d.content); })
      .catch(() => {});
  }, []);
  return content;
}

// Merge CMS data with hardcoded fallback. If CMS has the key, use it; otherwise fallback.
function cmsVal(cms, key, fallback) {
  if (cms && cms[key] !== undefined && cms[key] !== null && cms[key] !== '') return cms[key];
  return fallback;
}

/* ---------------- Data (hardcoded fallbacks) ---------------- */

const navItems = [
  { label: "Solutions", children: ["Creative & Brand", "Business Growth", "Media & Activations", "Research & Impact"] },
  { label: "Services", children: ["Brand Marketing", "Business Development", "Lead Generation", "BTL / ATL / TTL", "Digital Marketing", "Field Research"] },
  { label: "Industries", children: ["FMCG", "Consumer Tech", "Healthcare", "Fintech", "Retail", "D2C"] },
  { label: "Our Work", children: null },
  { label: "Insights", children: null },
  { label: "About", children: null },
];

const DEFAULT_VALUE_CHAIN = [
  { stage: "Attention", note: "Creative media & brand marketing get you noticed." },
  { stage: "Engagement", note: "Retail, social and digital create real interaction." },
  { stage: "Activation", note: "BTL / TTL / ATL put you in front of the right rooms." },
  { stage: "Leads", note: "Field campaigns convert interest into qualified pipeline." },
  { stage: "Partnerships", note: "B2B tie-ups turn pipeline into structured deals." },
  { stage: "Revenue", note: "Business development closes the loop on growth." },
];

const DEFAULT_PILLARS = [
  { n: "01", tag: "Creative & Brand", headline: "Make your brand impossible to ignore.", body: "Build identity, visibility and communication that gets your brand noticed by the right audience.", services: "Creative Media, Brand Marketing, Retail Branding, Social Media Marketing, Digital Marketing", cta: "Explore Creative & Brand", img: IMG.creative },
  { n: "02", tag: "Business Growth", headline: "Turn opportunities into revenue.", body: "We connect marketing activity to the pipeline — qualified leads, B2B tie-ups and revenue opportunities.", services: "Business Development, Revenue Generation, Lead Generation, B2B Tie-ups", cta: "Explore Business Growth", img: IMG.growth },
  { n: "03", tag: "Media & Activations", headline: "Put your brand where people are.", body: "From corporate parks to retail aisles and residential communities, we plan and execute activations.", services: "Brand Activation, BTL, TTL, ATL, Corporate Activations, RWA Activations, Retail Activations", cta: "Explore Activations", img: IMG.media },
  { n: "04", tag: "Research & Impact", headline: "Understand markets. Create impact.", body: "Field research and CSR programs that help brands make better decisions.", services: "Field Research, Consumer Research, Market Insights, CSR Campaigns", cta: "Explore Research & Impact", img: IMG.research },
];

const DEFAULT_OUTCOMES = [
  { title: "Build Brand Awareness", detail: "Reach new audiences and increase visibility through creative media, brand marketing and retail placement designed to get you noticed." },
  { title: "Generate Leads", detail: "Field and digital campaigns engineered to capture qualified prospects, not just impressions — with clear hand-off to your sales team." },
  { title: "Increase Revenue", detail: "Marketing activity mapped directly to business opportunities: pipeline, partnerships and measurable commercial outcomes." },
  { title: "Enter New Markets", detail: "Field research, activations and local partnerships that de-risk expansion into a new city, category or customer segment." },
  { title: "Build B2B Partnerships", detail: "Strategic tie-ups and business development that turn brand relationships into structured commercial agreements." },
  { title: "Engage Consumers", detail: "Real-world and digital interactions designed around genuine participation, not passive impressions." },
];

const DEFAULT_CHANNELS = [
  { key: "ATL", title: "Build mass awareness.", items: "Outdoor · Mass Media · Large-scale campaigns", width: "30%" },
  { key: "BTL", title: "Create direct engagement.", items: "Activations · Retail · Corporate · Communities", width: "40%" },
  { key: "TTL", title: "Connect both worlds.", items: "Integrated campaigns · Digital amplification · Offline + online", width: "30%" },
];

const DEFAULT_CASE_STUDIES = [
  { client: "Placeholder Client", type: "Corporate Activation", title: "Engaging a distributed tech workforce", challenge: "Low in-person engagement across five tech parks.", solution: "A five-city corporate activation series with live product sampling.", result: "8,000+ employees engaged in six weeks.", img: IMG.case1 },
  { client: "Placeholder Client", type: "RWA Activation", title: "Reaching families where they live", challenge: "Category awareness was flat in residential catchments.", solution: "Weekend community activations across twenty-plus gated communities.", result: "Strong sampling and sign-up volume across communities.", img: IMG.case2 },
  { client: "Placeholder Client", type: "Retail Promotion", title: "Driving trial at the shelf", challenge: "A new SKU needed visibility inside high-footfall retail.", solution: "In-mall promoters and branded sampling counters.", result: "Strong footfall-to-trial conversion across malls.", img: IMG.case3 },
];

const DEFAULT_PROCESS_STEPS = [
  { n: "01", title: "Understand", items: "Business objective, Audience, Market, Challenge" },
  { n: "02", title: "Strategize", items: "Channel, Creative, Activation, Growth plan" },
  { n: "03", title: "Execute", items: "Digital, On-ground, Media, Partnerships" },
  { n: "04", title: "Amplify", items: "Content, Social, Media, B2B opportunities" },
  { n: "05", title: "Measure", items: "Reach, Leads, Engagement, Business outcomes" },
];

const DEFAULT_INDUSTRIES = ["FMCG", "Consumer Tech", "Healthcare", "Fintech", "Retail", "Food & Beverage", "Automotive", "Real Estate", "Education", "D2C", "Corporate", "Lifestyle"];

const DEFAULT_GROWTH_POINTS = ["Lead Generation", "B2B Partnerships", "Business Development", "Revenue Opportunities", "Market Expansion", "Strategic Tie-ups"];

const DEFAULT_TRUST_LOGOS = ["Third Wave Coffee", "Anand Diagnostics", "Ceyone", "HDFC Bank", "IDFC FIRST Bank", "Equitas Small Finance Bank", "LuLu Mall", "Godrej", "Life Skill", "Decathlon"];

const DEFAULT_HERO_FEATURES = [
  { title: "Creative Strategy", desc: "Insight-led ideas that build brands" },
  { title: "On-ground Execution", desc: "Flawless execution where it matters" },
  { title: "Business Growth", desc: "From engagement to measurable results" },
];

const DEFAULT_HERO_STATS = [
  { value: "500+", label: "Activations Executed" },
  { value: "50+", label: "Cities Covered" },
  { value: "250+", label: "Brands Served" },
];

const DEFAULT_CAPABILITY_DIRECTORY = [
  { cat: "Brand", items: "Creative Media · Brand Marketing · Retail Branding & Placement" },
  { cat: "Growth", items: "Business Development · Revenue Generation · Lead Generation · B2B Tie-ups" },
  { cat: "Media", items: "BTL · TTL · ATL · Brand Activation" },
  { cat: "Digital", items: "Social Media Marketing · Digital Marketing" },
  { cat: "Insights", items: "Field Research · Market Research" },
  { cat: "Impact", items: "CSR Campaigns" },
];

const DEFAULT_INSIGHTS = [
  { title: "How BTL Marketing Drives Measurable Business Growth", tag: "Strategy" },
  { title: "ATL vs BTL vs TTL: Choosing the Right Strategy", tag: "Guide" },
  { title: "How Hyperlocal Marketing Helps Brands Enter New Markets", tag: "Growth" },
];

const DEFAULT_TESTIMONIALS = [
  { quote: "BTLbro helped us connect with our audience in the right places. The execution was seamless from planning through to on-ground delivery.", name: "Placeholder Name", role: "Marketing Lead, Placeholder Co." },
  { quote: "Their team thinks about business outcomes, not just campaign metrics. That distinction changed how we brief them.", name: "Placeholder Name", role: "Brand Manager, Placeholder Co." },
];

/* ---------------- Helpers ---------------- */

function useReveal() {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setShown(true); io.unobserve(el); } },
      { threshold: 0.12 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, shown];
}

function Reveal({ children, className = "", delay = 0, as = "div" }) {
  const [ref, shown] = useReveal();
  const Tag = as;
  return (
    <Tag ref={ref} className={`reveal ${shown ? "reveal-in" : ""} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </Tag>
  );
}

function SectionMark({ index, label }) {
  return (
    <div className="section-mark">
      <span className="section-mark-index">{index}</span>
      <span className="section-mark-line" />
      <span className="section-mark-label">{label}</span>
    </div>
  );
}

/* ---------------- Sections (accept CMS content as props) ---------------- */

const topFeatures = DEFAULT_HERO_FEATURES;
const topStats = DEFAULT_HERO_STATS;
const topTrustLogos = DEFAULT_TRUST_LOGOS;

function Hero({ cms }) {
  const h = cms.hero || {};
  const features = (cms.hero_features?.items) || (Array.isArray(cms.hero_features) ? cms.hero_features : null) || topFeatures;
  const stats = (cms.hero_stats?.items) || (Array.isArray(cms.hero_stats) ? cms.hero_stats : null) || topStats;
  const heroImg = h.hero_image || IMG.hero;
  const retailImg = h.collage_retail_image || IMG.csr;
  const phoneImg = h.collage_phone_image || IMG.case2;

  return (
    <section className="hero" id="top">
      <div className="hero-left">
        <span className="hero-eyebrow">{h.eyebrow || "Integrated Marketing & Business Growth"}</span>
        <h1 className="hero-heading">
          {h.headline ? h.headline.split('.').slice(0, -1).join('.') + '.' : "Ideas That Build Brands."}
          <br />
          <span className="accent">{h.headline_accent || "Strategies That Grow Business."}</span>
        </h1>
        <span className="hero-rule" />
        <p className="hero-copy">{h.copy || "BTLbro brings creative, activation, digital and business development together to help brands reach the right people, generate opportunities and drive measurable growth."}</p>
        <div className="hero-ctas">
          <a href={h.cta_primary_link || "#contact"} className="btn btn-primary btn-lg">{h.cta_primary || "Cart"} <ArrowUpRight size={16} /></a>
          <a href={h.cta_secondary_link || "#work"} className="hero-text-link">{h.cta_secondary || "Explore Our Work"} <ArrowRight size={15} /></a>
        </div>
        <div className="hero-features">
          {features.map((f, i) => (
            <React.Fragment key={f.title}>
              <div className="hero-feature">
                <Lightbulb size={22} color="#F2701D" strokeWidth={1.8} />
                <div>
                  <div className="hero-feature-title">{f.title}</div>
                  <div className="hero-feature-desc">{f.desc}</div>
                </div>
              </div>
              {i < features.length - 1 && <span className="hero-feature-divider" />}
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="hero-right">
        <div className="collage-top">
          <img src={heroImg} alt="Brand activation" />
        </div>
        <div className="collage-bottom">
          <div className="collage-retail"><img src={retailImg} alt="Retail display" /></div>
          <div className="collage-phone">
            <img src={phoneImg} alt="Digital content" />
            <div className="collage-phone-overlay">
              <div>
                <h4>{h.phone_overlay_title || "Digital Amplification"}</h4>
                <p>{h.phone_overlay_text || "Extend reach. Drive engagement. Multiply impact."}</p>
              </div>
              <div className="collage-socials">
                <span><Instagram size={14} /></span>
                <span><Facebook size={14} /></span>
                <span><Youtube size={14} /></span>
                <span><Linkedin size={14} /></span>
              </div>
            </div>
          </div>
        </div>
        <div className="stat-card">
          {stats.map((s) => (
            <div className="stat-row" key={s.label}>
              <span className="stat-icon"><Calendar size={18} color="#F2701D" strokeWidth={2} /></span>
              <div>
                <div className="stat-value">{s.value}</div>
                <div className="stat-label">{s.label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function TrustStrip({ cms }) {
  const t = cms.trust || {};
  const logos = t.logos || topTrustLogos;
  return (
    <section className="trust">
      <span className="trust-label">{t.label || "Trusted by ambitious brands across industries"}</span>
      <div className="trust-marquee">
        <div className="trust-marquee-track">
          {[...logos, ...logos].map((l, i) => (
            <span key={i} className="trust-marquee-item">{l}</span>
          ))}
        </div>
      </div>
    </section>
  );
}/* Campaign card carousel — ONE horizontal line (flex-wrap: nowrap), driven by
   the admin Marquee section. Every `speedSeconds` the track slides smoothly so
   the next card reaches the highlighted center position (zoom + orange border
   + glow). Clones of the last/first card at the track edges make the infinite
   loop seamless: after sliding onto the end-clone (which looks like Card 1) we
   snap back to the real Card 1 with the transition disabled — invisible. */
const CAROUSEL_SLIDE_MS = 600;

function CampaignMarquee({ campaigns, speedSeconds = 5, onOpenCard }) {
  const items = Array.isArray(campaigns) ? campaigns : [];
  const total = items.length;
  const perCardMs = Math.max(1, parseInt(speedSeconds, 10) || 5) * 1000;

  // pos = index of the track child currently centered/highlighted.
  // The track holds `repeat` copies of the card list (measured against the
  // viewport) so the viewport NEVER sees past the track ends — after the
  // last card, the first card follows seamlessly, forever.
  const [pos, setPos] = useState(null);
  const [instant, setInstant] = useState(false); // true while snapping back invisibly
  const [step, setStep] = useState(0); // card width incl. right margin
  const [viewportW, setViewportW] = useState(0);
  const viewportRef = useRef(null);
  const cardRefs = useRef([]);

  // Measure the first real card (width + horizontal margin) and the viewport.
  useLayoutEffect(() => {
    const card = cardRefs.current[0];
    const vp = viewportRef.current;
    if (!card || !vp) return undefined;
    const measure = () => {
      const cs = window.getComputedStyle(card);
      setStep(card.offsetWidth + parseFloat(cs.marginLeft || 0) + parseFloat(cs.marginRight || 0));
      setViewportW(vp.offsetWidth);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(card);
    ro.observe(vp);
    return () => ro.disconnect();
  }, [total]);

  // Anchor pos once we know how many cards we have; re-anchor if the
  // campaign list size changes (admin saved edits).
  useEffect(() => {
    setPos((p) => (p === null || p >= total * 2 ? total : p));
  }, [total]);

  useEffect(() => {
    if (total <= 1) return undefined;
    const timer = setInterval(() => {
      setPos((p) => (p === null ? p : p + 1));
    }, perCardMs);
    return () => clearInterval(timer);
  }, [total, perCardMs]);

  // After sliding into the third copy (visually identical to the second),
  // snap back one copy-width with transitions disabled — invisible.
  useEffect(() => {
    if (pos === null || pos < total * 2) return undefined;
    const t = setTimeout(() => {
      setInstant(true);
      setPos((p) => p - total);
    }, CAROUSEL_SLIDE_MS + 60);
    return () => clearTimeout(t);
  }, [pos, total]);

  useEffect(() => {
    if (!instant) return undefined;
    const r = requestAnimationFrame(() => setInstant(false));
    return () => cancelAnimationFrame(r);
  }, [instant]);

  if (total === 0) return null;

  // Repeat the list enough times that (viewport + buffer) is always covered:
  // cards needed ≈ viewport/step + 4 → copies = that / total, min 3.
  const repeat = Math.max(3, Math.ceil((viewportW / Math.max(1, step) + 4) / Math.max(1, total)));
  const trackItems = [];
  for (let r = 0; r < repeat; r++) {
    for (let i = 0; i < total; i++) trackItems.push(items[i]);
  }
  const activePos = pos === null ? total : pos;
  const offset = Math.max(0, activePos * step - Math.max(0, (viewportW - step) / 2));

  return (
    <section className="campaign-marquee" aria-label="Campaign highlights">
      <div className="carousel-viewport" ref={viewportRef}>
        <div
          className="carousel-track"
          style={{ transform: `translate3d(${-offset}px, 0, 0)`, transition: instant ? "none" : undefined }}
        >
          {trackItems.map((c, i) => {
            const realIndex = i % total;
            return (
              <article
                className={`carousel-card${i === activePos ? " is-active" : ""}${onOpenCard ? " is-clickable" : ""}`}
                key={i}
                ref={(el) => { cardRefs.current[i] = el; }}
                {...(onOpenCard ? {
                  role: "button",
                  tabIndex: 0,
                  "aria-label": `Open campaign details: ${c.title || "Untitled"}`,
                  onClick: () => onOpenCard(c),
                  onKeyDown: (e) => {
                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenCard(c); }
                  },
                } : {})}
              >
                {onOpenCard && <span className="campaign-card-open-hint" aria-hidden="true">View details →</span>}
                {c.image ? (
                  <img src={c.image} alt={c.title || "Campaign"} loading="lazy" />
                ) : (
                  <div className="campaign-card-fallback" aria-hidden="true">{String(realIndex + 1).padStart(2, "0")}</div>
                )}
                <div className="campaign-card-shade" />
                <div className="campaign-card-text">
                  <h4>{c.title || ""}</h4>
                  {c.desc ? <p>{c.desc}</p> : null}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function GrowthLine({ cms }) {
  const [active, setActive] = useState(null);
  const vc = cms.value_chain || {};
  const stages = vc.stages || DEFAULT_VALUE_CHAIN;
  const trustNames = vc.trust_names || [];

  return (
    <section className="growth-line">
      <p className="growth-line-lede">{vc.lede || "BTLbro doesn't stop at advertising. Every engagement moves a brand along the same line —"}</p>
      <div className="chain">
        {stages.map((v, i) => (
          <div key={v.stage} className={`chain-node ${active === i ? "chain-node-active" : ""}`}
            onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)}>
            <span className="chain-index">{String(i + 1).padStart(2, "0")}</span>
            <span className="chain-stage">{v.stage}</span>
            {i < stages.length - 1 && <span className="chain-arrow"><ArrowRight size={14} /></span>}
          </div>
        ))}
      </div>
      <div className="chain-note">{active !== null ? stages[active].note : "Hover a stage to see how BTLbro moves you through it."}</div>
      <div className="trust-row">
        <span className="mono-label">{vc.trust_label || "Built for brands that want more than impressions"}</span>
        <div className="trust-names">
          {trustNames.map((b, i) => (<span key={i}>{b}</span>))}
        </div>
      </div>
    </section>
  );
}

function Pillars({ cms }) {
  const cmsPillars = cms.pillars?.items || (Array.isArray(cms.pillars) ? cms.pillars : null);
  const pillars = (Array.isArray(cmsPillars) && cmsPillars.length > 0)
    ? cmsPillars.map((p, i) => ({ ...DEFAULT_PILLARS[i], ...p, img: p.image || DEFAULT_PILLARS[i]?.img }))
    : DEFAULT_PILLARS;

  return (
    <section className="pillars" id="solutions">
      <SectionMark index="01" label="Core Solutions" />
      <Reveal><h2 className="section-title">Everything your brand needs to move forward.</h2></Reveal>
      <Reveal delay={80}><p className="section-sub">From creating attention to generating revenue, BTLbro connects marketing, activation and business growth under one roof.</p></Reveal>
      <div className="pillar-list">
        {pillars.map((p, i) => {
          const reversed = i % 2 === 1;
          return (
            <Reveal key={p.n || i} className={`pillar-block ${reversed ? "reversed" : ""}`}>
              <div className="pillar-media">
                <img src={p.img} alt={p.headline} />
                <span className="pillar-outline-num">{p.n || String(i + 1).padStart(2, "0")}</span>
              </div>
              <div className="pillar-content">
                <span className="mono-label">{p.tag}</span>
                <h3 className="pillar-headline">{p.headline}</h3>
                <p className="pillar-body">{p.body}</p>
                <p className="pillar-services">{p.services}</p>
                <a href="#capabilities" className="text-link">{p.cta} <ArrowRight size={15} /></a>
              </div>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}

function Capabilities({ cms }) {
  const dir = cms.capability_directory?.items || (Array.isArray(cms.capability_directory) ? cms.capability_directory : null) || DEFAULT_CAPABILITY_DIRECTORY;
  return (
    <section className="capabilities" id="capabilities">
      <SectionMark index="02" label="Complete Capabilities" />
      <Reveal><h2 className="section-title">One partner. Multiple capabilities.</h2></Reveal>
      <div className="directory">
        {dir.map((row, i) => (
          <Reveal key={row.cat} delay={i * 40} className="directory-row">
            <span className="directory-cat">{row.cat}</span>
            <span className="directory-leader" />
            <span className="directory-items">{row.items}</span>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function Outcomes({ cms }) {
  const [sel, setSel] = useState(0);
  const outcomes = cms.outcomes?.items || (Array.isArray(cms.outcomes) ? cms.outcomes : null) || DEFAULT_OUTCOMES;
  return (
    <section className="outcomes">
      <SectionMark index="03" label="Business Outcomes" />
      <Reveal><h2 className="section-title">What are you trying to achieve?</h2></Reveal>
      <div className="outcome-layout">
        <ul className="outcome-list">
          {outcomes.map((o, i) => (
            <li key={o.title}>
              <button className={`outcome-item ${sel === i ? "outcome-item-active" : ""}`} onClick={() => setSel(i)}>
                <span className="outcome-num">{String(i + 1).padStart(2, "0")}</span>
                <span>{o.title}</span>
                <ArrowRight size={16} className="outcome-arrow" />
              </button>
            </li>
          ))}
        </ul>
        <div className="outcome-detail">
          <span className="mono-label">{String(sel + 1).padStart(2, "0")} / {String(outcomes.length).padStart(2, "0")}</span>
          <h3>{outcomes[sel].title}</h3>
          <p>{outcomes[sel].detail}</p>
          <a href="#contact" className="btn btn-primary">Tell Us Your Goal <ArrowRight size={15} /></a>
        </div>
      </div>
    </section>
  );
}

function ChannelExplainer({ cms }) {
  const channelData = cms.channels || {};
  const channels = channelData.items || (Array.isArray(cms.channels) ? cms.channels : null) || DEFAULT_CHANNELS;
  const statement = channelData.statement || "BTLbro plans around the business objective — not around a single channel.";
  const channelItems = channels.filter(c => c.key);
  return (
    <section className="channels">
      <SectionMark index="04" label="No Channel Boundaries" />
      <Reveal><h2 className="section-title">Marketing without channel boundaries.</h2></Reveal>
      <Reveal className="spectrum-bar">
        {channelItems.map((c) => <span key={c.key} style={{ width: c.width || "33%" }} />)}
      </Reveal>
      <div className="channel-grid">
        {channelItems.map((c, i) => (
          <Reveal key={c.key} delay={i * 70} className="channel-col">
            <div className="channel-key">{c.key}</div>
            <p className="channel-title">{c.title}</p>
            <p className="channel-items">{c.items}</p>
          </Reveal>
        ))}
      </div>
      <Reveal className="channel-statement">{statement}</Reveal>
    </section>
  );
}

function FeaturedWork({ cms }) {
  const [hover, setHover] = useState(0);
  const cmsCases = cms.case_studies?.items || (Array.isArray(cms.case_studies) ? cms.case_studies : null);
  const caseStudies = (Array.isArray(cmsCases) && cmsCases.length > 0)
    ? cmsCases.map((cs, i) => ({ ...DEFAULT_CASE_STUDIES[i], ...cs, img: cs.image || DEFAULT_CASE_STUDIES[i]?.img }))
    : DEFAULT_CASE_STUDIES;

  return (
    <section className="work" id="work">
      <SectionMark index="05" label="Featured Work" />
      <Reveal><h2 className="section-title">Work that creates movement.</h2></Reveal>
      <Reveal delay={70}><p className="section-sub">Placeholder case studies shown for layout — replace with verified BTLbro results.</p></Reveal>
      <div className="work-layout">
        <ul className="work-list">
          {caseStudies.map((cs, i) => (
            <li key={cs.title} className={`work-row ${hover === i ? "work-row-active" : ""}`} onMouseEnter={() => setHover(i)}>
              <span className="work-index">{String(i + 1).padStart(2, "0")}</span>
              <div className="work-row-text">
                <span className="mono-label">{cs.client} · {cs.type}</span>
                <h4>{cs.title}</h4>
                <div className="work-row-detail">
                  <p><span>Challenge</span>{cs.challenge}</p>
                  <p><span>Solution</span>{cs.solution}</p>
                  <p><span>Result</span>{cs.result}</p>
                </div>
              </div>
              <ArrowUpRight size={18} className="work-row-icon" />
            </li>
          ))}
        </ul>
        <div className="work-preview">
          <img src={caseStudies[hover]?.img} alt={caseStudies[hover]?.title} />
        </div>
      </div>
    </section>
  );
}

function WhyBTLbro({ cms }) {
  const w = cms.why_btlbro || {};
  return (
    <section className="why">
      <SectionMark index="06" label="Why BTLbro" />
      <Reveal><h2 className="section-title">{w.headline || "Why brands work with BTLbro."}</h2></Reveal>
      <Reveal className="why-statement" dangerouslySetInnerHTML={{ __html: w.statement || 'Brands choose BTLbro for <strong>integrated expertise</strong> — creative, marketing, activation and growth under one roof — backed by <strong>hyperlocal intelligence</strong> across audiences and markets, delivered through <strong>end-to-end execution</strong> from strategy to reporting, guided by <strong> business-first thinking</strong> rather than vanity metrics, supported by a genuine <strong> on-ground network</strong>, and proven with <strong>measurable impact</strong> at every stage.' }} />
    </section>
  );
}

function Process({ cms }) {
  const stepsArr = cms.process_steps?.items || (Array.isArray(cms.process_steps) ? cms.process_steps : null);
  const steps = (Array.isArray(stepsArr) && stepsArr.length > 0)
    ? stepsArr.map((s, i) => ({ ...DEFAULT_PROCESS_STEPS[i], ...s }))
    : DEFAULT_PROCESS_STEPS;

  return (
    <section className="process">
      <SectionMark index="07" label="The BTLbro Method" />
      <Reveal><h2 className="section-title">From brief to business impact.</h2></Reveal>
      <div className="process-track">
        {steps.map((s, i) => (
          <Reveal key={s.n || i} delay={i * 60} className="process-step">
            <div className="process-num">{s.n || String(i + 1).padStart(2, "0")}</div>
            <h5>{s.title}</h5>
            <p>{s.items}</p>
          </Reveal>
        ))}
        <div className="process-line" />
      </div>
    </section>
  );
}

function CampaignPlanner() {
  const [city, setCity] = useState("Bengaluru");
  const popular = ["Bengaluru", "Mumbai", "Delhi NCR", "Hyderabad", "Pune", "Chennai"];
  return (
    <section className="planner" id="planner">
      <SectionMark index="08" label="Activation & Market Discovery" />
      <Reveal><h2 className="section-title">Where do you want your brand to show up?</h2></Reveal>
      <Reveal className="planner-panel">
        <div className="planner-fields">
          <div className="planner-field">
            <label><MapPin size={13} /> City</label>
            <select value={city} onChange={(e) => setCity(e.target.value)}>
              {popular.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="planner-field">
            <label><Users size={13} /> Audience</label>
            <select defaultValue="Working Professionals">
              <option>Working Professionals</option>
              <option>Families &amp; Residents</option>
              <option>Students</option>
              <option>Retail Shoppers</option>
            </select>
          </div>
          <div className="planner-field">
            <label><Target size={13} /> Objective</label>
            <select defaultValue="Lead Generation">
              <option>Lead Generation</option>
              <option>Brand Awareness</option>
              <option>Product Trial</option>
              <option>Market Entry</option>
            </select>
          </div>
          <div className="planner-field">
            <label><Radio size={13} /> Channel</label>
            <select defaultValue="BTL Activation">
              <option>BTL Activation</option>
              <option>Retail Promotion</option>
              <option>Digital Amplification</option>
              <option>Corporate Activation</option>
            </select>
          </div>
          <div className="planner-field">
            <label><Wallet size={13} /> Budget</label>
            <select defaultValue="₹1L – ₹5L">
              <option>₹50K – ₹1L</option>
              <option>₹1L – ₹5L</option>
              <option>₹5L – ₹20L</option>
              <option>₹20L+</option>
            </select>
          </div>
          <a href="#contact" className="btn btn-primary planner-cta">Build My Campaign <ArrowRight size={15} /></a>
        </div>
        <div className="planner-popular">
          <span className="mono-label">Popular Markets</span>
          <div>
            {popular.map((c) => (
              <button key={c} className={`chip ${c === city ? "chip-active" : ""}`} onClick={() => setCity(c)}>{c}</button>
            ))}
          </div>
        </div>
      </Reveal>
    </section>
  );
}

function Industries({ cms }) {
  const items = cms.industries?.items || (Array.isArray(cms.industries) ? cms.industries : null) || DEFAULT_INDUSTRIES;
  return (
    <section className="industries">
      <SectionMark index="09" label="Industries" />
      <Reveal><h2 className="section-title">Built for ambitious brands.</h2></Reveal>
      <Reveal className="industry-inline">
        {items.map((ind, i) => (
          <React.Fragment key={ind}>
            <span>{ind}</span>
            {i < items.length - 1 && <span className="industry-sep">/</span>}
          </React.Fragment>
        ))}
      </Reveal>
    </section>
  );
}

function GrowthSection({ cms }) {
  const g = cms.growth_section || {};
  const points = g.points || DEFAULT_GROWTH_POINTS;
  return (
    <section className="growth-dark">
      <div className="growth-inner">
        <div className="growth-text">
          <span className="mono-label mono-label-light">{g.label || "Beyond Marketing"}</span>
          <h2>{g.headline || "We don't stop at visibility."}</h2>
          <p className="growth-statement">{g.statement || "We help turn attention into opportunity — and opportunity into business."}</p>
          <ol className="growth-list">
            {points.map((g, i) => <li key={g}><span>{String(i + 1).padStart(2, "0")}</span>{g}</li>)}
          </ol>
          <a href="#contact" className="btn btn-primary">{g.cta || "Explore Growth Solutions"} <ArrowRight size={15} /></a>
        </div>
        <div className="growth-media">
          <img src={g.image || IMG.bizdev} alt="Business development" />
        </div>
      </div>
    </section>
  );
}

function Research({ cms }) {
  const r = cms.research || {};
  return (
    <section className="research">
      <div className="research-media"><img src={r.image || IMG.research} alt="Field research" /></div>
      <div className="research-text">
        <span className="mono-label">{r.label || "Research & Insights"}</span>
        <h2 className="section-title">{r.headline || "Better decisions start with better insights."}</h2>
        <p className="section-sub">{r.sub || "BTLbro's field research capabilities help brands understand consumers, markets and opportunities before making critical decisions."}</p>
        <p className="inline-list">{r.points || "Field Research · Consumer Surveys · Market Validation · Competitor Insights · Location Research · Campaign Feedback"}</p>
        <a href="#contact" className="text-link">{r.cta || "Explore Research"} <ArrowRight size={15} /></a>
      </div>
    </section>
  );
}

function CSR({ cms }) {
  const cs = cms.csr || {};
  return (
    <section className="csr">
      <div className="csr-media"><img src={cs.image || IMG.csr} alt="CSR activation" /></div>
      <div className="csr-overlay">
        <span className="mono-label mono-label-light">Purpose With Impact</span>
        <h2>{cs.headline || "Campaigns that create more than visibility."}</h2>
        <p>{cs.text || "Plan and execute CSR initiatives that connect brands with communities through meaningful, measurable action."}</p>
        <p className="inline-list inline-list-light">{cs.points || "Community Engagement · Awareness Campaigns · On-ground Execution · Impact Documentation · CSR Communication"}</p>
        <a href="#contact" className="btn btn-outline-light">{cs.cta || "Explore CSR Campaigns"} <ArrowRight size={15} /></a>
      </div>
    </section>
  );
}

function Testimonials({ cms }) {
  const items = cms.testimonials?.items || (Array.isArray(cms.testimonials) ? cms.testimonials : null) || DEFAULT_TESTIMONIALS;
  const [idx, setIdx] = useState(0);
  return (
    <section className="testimonials">
      <span className="mono-label">Trusted Relationships</span>
      <Reveal><h2 className="section-title">Real outcomes, told plainly.</h2></Reveal>
      <Reveal delay={60}><p className="section-sub" style={{ fontStyle: "italic" }}>Placeholder quotes shown for layout — replace with verified testimonials.</p></Reveal>
      <Reveal className="testimonial-block">
        <Quote size={26} color="#FF7900" />
        <p className="testimonial-quote">{items[idx]?.quote}</p>
        <div className="testimonial-footer">
          <div>
            <div className="testimonial-name">{items[idx]?.name}</div>
            <div className="testimonial-role">{items[idx]?.role}</div>
          </div>
          <div className="testimonial-nav">
            <button onClick={() => setIdx((idx - 1 + items.length) % items.length)}><ChevronLeft size={16} /></button>
            <button onClick={() => setIdx((idx + 1) % items.length)}><ChevronRight size={16} /></button>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

function Insights({ cms }) {
  const items = cms.insights?.items || (Array.isArray(cms.insights) ? cms.insights : null) || DEFAULT_INSIGHTS;
  return (
    <section className="insights">
      <SectionMark index="10" label="Insights" />
      <Reveal><h2 className="section-title">Ideas for marketers who want results.</h2></Reveal>
      <ul className="insight-list">
        {items.map((a, i) => (
          <Reveal as="li" key={a.title} delay={i * 50} className="insight-row">
            <span className="mono-label">{a.tag}</span>
            <h4>{a.title}</h4>
            <ArrowRight size={16} className="insight-arrow" />
          </Reveal>
        ))}
      </ul>
    </section>
  );
}

function FinalCTA({ cms }) {
  const f = cms.final_cta || {};
  const stages = (cms.value_chain?.stages || DEFAULT_VALUE_CHAIN).map(v => v.stage);
  return (
    <section className="final-cta" id="contact">
      <div className="final-cta-inner">
        <Reveal className="final-cta-left">
          <span className="mono-label mono-label-onorange">{f.label || "Got a business challenge?"}</span>
          <h2>{f.headline || "Let's turn it into an opportunity."}</h2>
          <p>{f.text || "Whether you need visibility, engagement, leads, partnerships or revenue growth — let's build the right strategy together."}</p>
          <div className="final-cta-row">
            <a href={f.cta_primary_link || "/customize"} className="btn btn-white">{f.cta_primary || "Customize Campaign"} <ArrowRight size={16} /></a>
            <a href="#contact" className="final-cta-link">{f.cta_secondary || "Talk to Our Team"} <ArrowRight size={15} /></a>
          </div>
        </Reveal>
        <Reveal delay={100} className="final-cta-chain">
          {stages.map((s, i) => (
            <span key={s} className={i === stages.length - 1 ? "final-stage final-stage-last" : "final-stage"}>{s}</span>
          ))}
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------- Root ---------------- */

export default function BTLbroLanding({ activeTab: activeTabProp, setActiveTab: setActiveTabProp }) {
  const [showIntro, setShowIntro] = useState(() => {
    return !sessionStorage.getItem('btl_intro_played');
  });
  const [activeTabLocal, setActiveTabLocal] = useState("marketing");
  const activeTab = activeTabProp ?? activeTabLocal;
  const setActiveTab = setActiveTabProp ?? setActiveTabLocal;
  const cms = useContent();
  const [openCampaign, setOpenCampaign] = useState(null);

  /* Open the popup INSTANTLY with the card's data, then re-fetch the CMS in
     the background so admin edits show up immediately. Even if the fetch
     fails or hangs, the popup always opens (never blocked on the network). */
  const handleOpenCampaign = useCallback((cardItem) => {
    setOpenCampaign(cardItem);
    fetch("/api/content")
      .then((r) => r.json())
      .then((d) => {
        const fresh = d.content?.marquee?.items;
        if (!Array.isArray(fresh)) return;
        const idx = fresh.findIndex((it) => it.title === cardItem.title && it.image === cardItem.image);
        if (idx >= 0) setOpenCampaign(fresh[idx]);
      })
      .catch(() => { /* keep the already-loaded copy */ });
  }, []);

  const handleIntroComplete = useCallback(() => {
    sessionStorage.setItem('btl_intro_played', '1');
    setShowIntro(false);
  }, []);

  return (
    <div className="btlbro-root">
      <style>{CSS}</style>
      {showIntro && <IntroScreen onComplete={handleIntroComplete} />}
      <div className="tab-content-fade" key={activeTab}>
        {activeTab === "website" ? (
          <>
            <div className="top">
              <Hero cms={cms} />
              <TrustStrip cms={cms} />
            </div>
            <main>
              <CampaignMarquee
                campaigns={((cms.marquee && Array.isArray(cms.marquee.items) ? cms.marquee.items : null) || []).filter(isCompleteCampaign)}
                speedSeconds={cms.marquee?.speed_seconds || 5}
                onOpenCard={handleOpenCampaign}
              />
              <GrowthLine cms={cms} />
              <Pillars cms={cms} />
              <Capabilities cms={cms} />
              <Outcomes cms={cms} />
              <ChannelExplainer cms={cms} />
              <FeaturedWork cms={cms} />
              <WhyBTLbro cms={cms} />
              <Process cms={cms} />
              <CampaignPlanner />
              <Industries cms={cms} />
              <GrowthSection cms={cms} />
              <Research cms={cms} />
              <CSR cms={cms} />
              <Testimonials cms={cms} />
              <Insights cms={cms} />
              <FinalCTA cms={cms} />
            </main>
            <Footer />
            <CampaignModal campaign={openCampaign} onClose={() => setOpenCampaign(null)} />
          </>
        ) : (
          <MarketingTool />
        )}
      </div>
    </div>
  );
}

/* ---------------- CSS (unchanged from original) ---------------- */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@500;700;800&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600&family=Zilla+Slab:wght@500;600;700&display=swap');

.btlbro-root {
  --orange: #FF7900;
  --ink: #161616;
  --secondary: #656565;
  --muted: #949494;
  --grey: #B8AFA6;
  --bg: #FFFFFF;
  --warm-bg: #FFFFFF;
  --border: #E5E1DA;
  --dark-bg: #171717;
  --max-w: 1360px;
  --pad-desktop: 56px;
  --pad-tablet: 30px;
  --pad-mobile: 18px;
  --font-display: 'Manrope', sans-serif;
  --font-body: 'Inter', sans-serif;
  --font-mono: 'IBM Plex Mono', monospace;
  font-family: var(--font-body);
  color: var(--ink);
  background: var(--bg);
  -webkit-font-smoothing: antialiased;
  overflow-x: clip;
}
.btlbro-root * { box-sizing: border-box; }
.btlbro-root h1, .btlbro-root h2, .btlbro-root h3, .btlbro-root h4, .btlbro-root h5, .btlbro-root h6 {
  margin: 0; font-family: var(--font-display); font-weight: 800; letter-spacing: -0.025em; color: var(--ink);
}
.btlbro-root p { margin: 0; }
.btlbro-root ul, .btlbro-root ol { list-style: none; margin: 0; padding: 0; }
.btlbro-root a { color: inherit; text-decoration: none; }
.btlbro-root button { font-family: inherit; cursor: pointer; background: none; border: none; }
.btlbro-root section { padding: 100px var(--pad-desktop); position: relative; max-width: var(--max-w); margin: 0 auto; }
.tab-content-fade { animation: tabFadeIn 0.4s ease; }
@keyframes tabFadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (max-width: 1024px) { .btlbro-root section { padding: 76px var(--pad-tablet); } }
@media (max-width: 640px) { .btlbro-root section { padding: 58px var(--pad-mobile); } }

.mono-label { font-family: var(--font-mono); font-size: 11.5px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--orange); }
.mono-label-light { color: rgba(255,255,255,.72); }
.mono-label-onorange { color: rgba(255,255,255,.85); }

.section-mark { display: flex; align-items: center; gap: 14px; margin-bottom: 22px; }
.section-mark-index { font-family: var(--font-mono); font-size: 12px; color: var(--muted); }
.section-mark-line { width: 32px; height: 1px; background: var(--border); }
.section-mark-label { font-family: var(--font-mono); font-size: 11.5px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--secondary); }

.section-title { font-size: 36px; line-height: 1.16; margin-top: 6px; max-width: 700px; }
.section-sub { font-family: var(--font-body); font-size: 15.5px; color: var(--secondary); margin-top: 14px; line-height: 1.6; max-width: 620px; }
@media (max-width: 640px) { .section-title { font-size: 27px; } }

.reveal { opacity: 0; transform: translateY(16px); transition: opacity .55s ease, transform .55s ease; }
.reveal-in { opacity: 1; transform: translateY(0); }
@media (prefers-reduced-motion: reduce) { .reveal { opacity: 1; transform: none; transition: none; } }

.btn { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; font-size: 14px; padding: 11px 20px; border-radius: 3px; border: 1px solid transparent; transition: all .18s ease; white-space: nowrap; }
.btn-primary { background: var(--orange); color: #fff; }
.btn-primary:hover { background: #e56d00; }
.btn-outline-light { border-color: rgba(255,255,255,.4); color: #fff; }
.btn-outline-light:hover { background: rgba(255,255,255,.1); }
.btn-white { background: #fff; color: var(--orange); }
.btn-lg { padding: 13px 22px; font-size: 14.5px; }

.text-link { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; font-size: 14px; color: var(--ink); border-bottom: 1px solid var(--ink); padding-bottom: 2px; }
.text-link:hover { color: var(--orange); border-color: var(--orange); }
.text-link svg { transition: transform .2s ease; }
.text-link:hover svg { transform: translateX(3px); }

.top { --torange: #F2701D; --tink: #1A1A1A; --tsec: #6B6B6B; --tbg: #FFFFFF; --ttrust-bg: #F3F0EA; --tborder: #E7E2D8; --tmax-w: 1400px; font-family: 'Inter', sans-serif; color: var(--tink); background: var(--tbg); }
.top a { color: inherit; text-decoration: none; }
.top p, .top h1, .top h4 { margin: 0; }
.top .btn { display: inline-flex; align-items: center; gap: 7px; font-weight: 600; font-size: 14.5px; padding: 12px 20px; border-radius: 8px; white-space: nowrap; transition: all .15s ease; }
.top .btn-primary { background: var(--torange); color: #fff; }
.top .btn-primary:hover { background: #d8620f; }
.top .btn-outline { border: 1.5px solid #D8D2C6; color: var(--tink); }
.top .btn-outline:hover { border-color: var(--tink); }
.top .btn-lg { padding: 13px 22px; font-size: 15px; }

.top .hero { max-width: var(--tmax-w); margin: 0 auto; padding: 20px 40px 56px; display: grid; grid-template-columns: 0.86fr 1.14fr; gap: 48px; align-items: center; min-height: 100vh; }
@media (max-width: 1100px) { .top .hero { grid-template-columns: 1fr; padding: 20px 20px 40px; } }
.top .hero-eyebrow { display: block; font-size: 12.5px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: var(--torange); }
.top .hero-heading { font-family: 'Zilla Slab', serif; font-weight: 700; font-size: 50px; line-height: 1.06; letter-spacing: -0.01em; margin-top: 14px; color: var(--tink); }
.top .hero-heading .accent { color: var(--torange); }
@media (max-width: 1300px) { .top .hero-heading { font-size: 42px; } }
@media (max-width: 640px) { .top .hero-heading { font-size: 32px; } }
.top .hero-rule { display: block; width: 46px; height: 3px; background: var(--torange); margin-top: 22px; border-radius: 2px; }
.top .hero-copy { font-size: 15.5px; line-height: 1.65; color: var(--tsec); margin-top: 20px; max-width: 460px; }
.top .hero-ctas { display: flex; align-items: center; gap: 26px; margin-top: 26px; flex-wrap: wrap; }
.top .hero-text-link { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; font-size: 14.5px; color: var(--tink); }
.top .hero-text-link:hover { color: var(--torange); }

.top .hero-features { display: flex; align-items: flex-start; gap: 20px; margin-top: 48px; flex-wrap: wrap; }
.top .hero-feature { display: flex; align-items: flex-start; gap: 10px; max-width: 150px; }
.top .hero-feature-title { font-size: 13.5px; font-weight: 700; color: var(--tink); }
.top .hero-feature-desc { font-size: 12px; color: var(--tsec); line-height: 1.4; margin-top: 3px; }
.top .hero-feature-divider { width: 1px; align-self: stretch; background: var(--tborder); margin-top: 4px; }
@media (max-width: 640px) { .top .hero-feature-divider { display: none; } }

.top .hero-right { position: relative; min-height: 640px; height: 100%; }
@media (max-width: 1100px) { .top .hero-right { min-height: 520px; margin-top: 8px; } }
.top .collage-top { position: absolute; top: 0; left: 0; right: 0; height: 60%; overflow: hidden; border-radius: 4px; clip-path: polygon(5% 0, 100% 0, 100% 100%, 0% 100%); }
.top .collage-top img { width: 100%; height: 100%; object-fit: cover; display: block; }
.top .collage-bottom { position: absolute; left: 0; right: 0; bottom: 0; top: 62%; display: flex; gap: 4px; }
.top .collage-retail, .top .collage-phone { position: relative; height: 100%; overflow: hidden; border-radius: 4px; }
.top .collage-retail { flex: 0 0 46%; clip-path: polygon(0 0, 100% 0, 92% 100%, 0% 100%); }
.top .collage-phone { flex: 1; clip-path: polygon(9% 0, 100% 0, 100% 100%, 0% 100%); }
.top .collage-retail img, .top .collage-phone img { width: 100%; height: 100%; object-fit: cover; display: block; }
.top .collage-phone-overlay { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(10,10,10,.15) 0%, rgba(10,10,10,.86) 46%, rgba(10,10,10,.92) 100%); display: flex; flex-direction: column; justify-content: center; align-items: flex-end; text-align: right; padding: 24px 28px; gap: 20px; color: #fff; }
.top .collage-phone-overlay h4 { font-family: 'Zilla Slab', serif; font-size: 21px; font-weight: 700; line-height: 1.15; color: #fff; }
.top .collage-phone-overlay p { font-size: 12.5px; color: rgba(255,255,255,.82); line-height: 1.5; margin-top: 10px; }
.top .collage-socials { display: flex; gap: 8px; }
.top .collage-socials span { width: 26px; height: 26px; border: 1px solid rgba(255,255,255,.5); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #fff; }
.top .stat-card { position: absolute; right: 20px; top: 46%; transform: translateY(-50%); width: 220px; background: #fff; border-radius: 10px; padding: 18px; display: flex; flex-direction: column; gap: 14px; box-shadow: 0 24px 50px rgba(20,15,5,.12); z-index: 5; }
.top .stat-row { display: flex; align-items: center; gap: 12px; }
.top .stat-icon { width: 34px; height: 34px; border-radius: 8px; background: #FBEADB; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.top .stat-value { font-family: 'Zilla Slab', serif; font-size: 19px; font-weight: 700; color: var(--tink); line-height: 1; }
.top .stat-label { font-size: 11px; color: var(--tsec); margin-top: 4px; }
@media (max-width: 1100px) { .top .stat-card { position: static; transform: none; width: auto; margin-top: 16px; flex-direction: row; justify-content: space-between; } }
@media (max-width: 640px) { .top .stat-card { flex-direction: column; } }

/* ---------- Campaign card carousel (one line, sliding, infinite) ---------- */
.btlbro-root section.campaign-marquee { padding-top: 8px; padding-bottom: 8px; }
.carousel-viewport { overflow: hidden; width: 100%; padding: 18px 0 22px; }
.carousel-track { display: flex; flex-wrap: nowrap; align-items: center; will-change: transform; transition: transform 600ms cubic-bezier(.33,.1,.2,1); }
.carousel-card { position: relative; flex: 0 0 auto; width: 320px; height: 205px; margin-right: 18px; border-radius: 10px; overflow: hidden; background: #F0EDE9; border: 2px solid transparent; transform: scale(1); transform-origin: center; transition: transform 600ms cubic-bezier(.33,.1,.2,1), box-shadow 600ms ease, border-color 600ms ease; z-index: 1; }
.carousel-card img { width: 100%; height: 100%; object-fit: cover; display: block; transition: filter 600ms ease; }
.campaign-card-fallback { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-family: 'Zilla Slab', serif; font-size: 44px; font-weight: 700; color: #C9C4BE; background: linear-gradient(135deg, #F5F2EE, #EAE5DF); }
.campaign-card-shade { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,0) 42%, rgba(0,0,0,.72) 100%); transition: background 600ms ease; pointer-events: none; }
.campaign-card-text { position: absolute; left: 16px; right: 16px; bottom: 13px; color: #fff; }
/* Explicit white: the global .btlbro-root h4 { color: var(--ink) } rule would
   otherwise win and render dark titles on the dark image shade */
.campaign-card-text h4 { margin: 0; font-family: 'Zilla Slab', serif; font-size: 18px; font-weight: 700; line-height: 1.2; color: #fff; }
.campaign-card-text p { margin: 4px 0 0; font-size: 12.5px; line-height: 1.45; color: rgba(255,255,255,.78); white-space: pre-line; max-height: 0; opacity: 0; overflow: hidden; transition: max-height 600ms ease, opacity 600ms ease; }
.carousel-card.is-active { transform: scale(1.10); border-color: #FF7A00; box-shadow: 0 0 0 4px rgba(255,122,0,.16), 0 14px 44px rgba(255,122,0,.30); z-index: 5; }
.carousel-card.is-active img { filter: brightness(1.08); }
.carousel-card.is-active .campaign-card-shade { background: linear-gradient(180deg, rgba(0,0,0,.05) 30%, rgba(0,0,0,.85) 100%); }
.carousel-card.is-active .campaign-card-text p { max-height: 60px; opacity: 1; }
.carousel-card:hover:not(.is-active) { transform: scale(1.02); z-index: 2; }
@media (max-width: 1440px) { .carousel-card { width: 280px; height: 185px; } }
@media (max-width: 1200px) { .carousel-card { width: 250px; height: 170px; } }
@media (max-width: 640px) { .carousel-card { width: 240px; height: 160px; } .campaign-card-text h4 { font-size: 15px; } .campaign-card-text p { display: none; } }
@media (prefers-reduced-motion: reduce) { .carousel-track, .carousel-card { transition: none; } .carousel-card.is-active { transform: none; } }

.top .trust { background: var(--bg); padding: 38px 0 32px; text-align: center; overflow: hidden; }
@media (max-width: 640px) { .top .trust { padding: 28px 0 24px; } }
.top .trust-label { display: block; font-size: 11px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--tsec); margin-bottom: 22px; }
.top .trust-marquee { width: 100%; overflow: hidden; }
.top .trust-marquee-track { display: flex; width: max-content; animation: trustScroll 30s linear infinite; }
.top .trust-marquee-track:hover { animation-play-state: paused; }
@keyframes trustScroll { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
.top .trust-marquee-item { flex-shrink: 0; padding: 0 40px; font-family: 'Zilla Slab', serif; font-size: 18px; font-weight: 600; color: #4A4A4A; opacity: .7; letter-spacing: -0.01em; white-space: nowrap; transition: opacity .2s ease; }
.top .trust-marquee-item:hover { opacity: 1; }

.growth-line { text-align: left; }
.growth-line-lede { font-family: var(--font-display); font-size: 22px; font-weight: 700; max-width: 640px; line-height: 1.4; }
.chain { display: flex; align-items: center; flex-wrap: wrap; gap: 0; margin-top: 40px; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
.chain-node { display: flex; align-items: center; gap: 10px; padding: 22px 18px; cursor: default; transition: background .2s ease; flex: 1; min-width: 150px; }
.chain-node-active { background: var(--warm-bg); }
.chain-index { font-family: var(--font-mono); font-size: 11px; color: var(--muted); }
.chain-stage { font-family: var(--font-display); font-weight: 800; font-size: 16px; }
.chain-node-active .chain-stage { color: var(--orange); }
.chain-arrow { color: var(--muted); margin-left: auto; }
@media (max-width: 900px) { .chain { flex-direction: column; } .chain-node { width: 100%; border-bottom: 1px solid var(--border); } .chain-arrow { display: none; } }
.chain-note { font-family: var(--font-mono); font-size: 12.5px; color: var(--secondary); margin-top: 16px; min-height: 18px; }
.trust-row { margin-top: 64px; padding-top: 36px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 18px; }
.trust-names { display: flex; flex-wrap: wrap; gap: 28px; }
.trust-names span { font-family: var(--font-mono); font-size: 13px; color: var(--muted); letter-spacing: 0.02em; }

.pillar-list { display: flex; flex-direction: column; gap: 84px; margin-top: 48px; }
.pillar-block { display: grid; grid-template-columns: 1fr 1fr; gap: 56px; align-items: center; }
.pillar-block.reversed { direction: rtl; }
.pillar-block.reversed > * { direction: ltr; }
@media (max-width: 900px) { .pillar-block, .pillar-block.reversed { grid-template-columns: 1fr; direction: ltr; gap: 26px; } }
.pillar-media { position: relative; }
.pillar-media img { width: 100%; height: 320px; object-fit: cover; display: block; }
.pillar-outline-num { position: absolute; top: -34px; left: -8px; font-family: var(--font-display); font-size: 96px; font-weight: 800; line-height: 1; color: transparent; -webkit-text-stroke: 1.5px var(--border); }
@media (max-width: 900px) { .pillar-outline-num { display: none; } }
.pillar-headline { font-size: 29px; line-height: 1.22; margin-top: 14px; }
.pillar-body { font-family: var(--font-body); font-size: 15px; color: var(--secondary); line-height: 1.65; margin-top: 14px; max-width: 460px; }
.pillar-services { font-family: var(--font-mono); font-size: 12.5px; color: var(--muted); margin-top: 18px; line-height: 1.7; max-width: 440px; }
.pillar-content .text-link { margin-top: 22px; }

.directory { margin-top: 40px; border-top: 1px solid var(--border); }
.directory-row { display: flex; align-items: baseline; gap: 16px; padding: 20px 0; border-bottom: 1px solid var(--border); transition: padding-left .2s ease; }
.directory-row:hover { padding-left: 10px; }
.directory-cat { font-family: var(--font-display); font-weight: 800; font-size: 16px; min-width: 96px; }
.directory-row:hover .directory-cat { color: var(--orange); }
.directory-leader { flex: 1; border-bottom: 1px dotted var(--border); transform: translateY(-4px); }
.directory-items { font-family: var(--font-body); font-size: 13.5px; color: var(--secondary); text-align: right; max-width: 60%; }
@media (max-width: 700px) { .directory-row { flex-wrap: wrap; } .directory-leader { display: none; } .directory-items { text-align: left; max-width: 100%; } }

.outcome-layout { display: grid; grid-template-columns: 0.9fr 1.1fr; gap: 40px; margin-top: 44px; align-items: start; }
@media (max-width: 900px) { .outcome-layout { grid-template-columns: 1fr; } }
.outcome-list { border-top: 1px solid var(--border); }
.outcome-item { width: 100%; display: flex; align-items: center; gap: 14px; padding: 18px 4px; border-bottom: 1px solid var(--border); font-family: var(--font-display); font-weight: 700; font-size: 15.5px; color: var(--secondary); text-align: left; }
.outcome-item:hover { color: var(--ink); }
.outcome-item-active { color: var(--orange); }
.outcome-num { font-family: var(--font-mono); font-weight: 500; font-size: 12px; color: var(--muted); }
.outcome-arrow { margin-left: auto; opacity: 0; transition: opacity .2s ease, transform .2s ease; }
.outcome-item-active .outcome-arrow, .outcome-item:hover .outcome-arrow { opacity: 1; transform: translateX(2px); }
.outcome-detail { border-left: 2px solid var(--orange); padding-left: 28px; }
@media (max-width: 900px) { .outcome-detail { border-left: none; border-top: 2px solid var(--orange); padding-left: 0; padding-top: 24px; } }
.outcome-detail h3 { font-size: 26px; margin-top: 10px; }
.outcome-detail p { font-family: var(--font-body); font-size: 15px; color: var(--secondary); margin-top: 14px; line-height: 1.65; }
.outcome-detail .btn { margin-top: 26px; }

.spectrum-bar { display: flex; height: 6px; margin-top: 40px; border-radius: 2px; overflow: hidden; }
.spectrum-bar span:nth-child(1) { background: var(--ink); }
.spectrum-bar span:nth-child(2) { background: var(--orange); }
.spectrum-bar span:nth-child(3) { background: var(--grey); }
.channel-grid { display: grid; grid-template-columns: repeat(3, 1fr); margin-top: 0; }
@media (max-width: 800px) { .channel-grid { grid-template-columns: 1fr; } }
.channel-col { padding: 26px 24px 26px 0; border-right: 1px solid var(--border); }
.channel-col:last-child { border-right: none; }
@media (max-width: 800px) { .channel-col { border-right: none; border-bottom: 1px solid var(--border); padding: 22px 0; } }
.channel-key { font-family: var(--font-display); font-size: 30px; font-weight: 800; }
.channel-title { font-family: var(--font-body); font-size: 15.5px; font-weight: 600; margin-top: 10px; }
.channel-items { font-family: var(--font-mono); font-size: 12px; color: var(--muted); margin-top: 12px; line-height: 1.7; }
.channel-statement { margin-top: 40px; font-family: var(--font-display); font-size: 19px; font-weight: 700; padding: 24px 0; border-top: 1px solid var(--border); }

.work-layout { display: grid; grid-template-columns: 0.65fr 0.35fr; gap: 40px; margin-top: 44px; align-items: start; }
@media (max-width: 900px) { .work-layout { grid-template-columns: 1fr; } }
.work-list { border-top: 1px solid var(--border); }
.work-row { display: flex; gap: 16px; padding: 22px 0; border-bottom: 1px solid var(--border); cursor: pointer; transition: padding-left .2s ease; }
.work-row:hover { padding-left: 8px; }
.work-index { font-family: var(--font-mono); font-size: 12px; color: var(--muted); padding-top: 2px; }
.work-row-text { flex: 1; }
.work-row-text h4 { font-size: 18px; margin-top: 6px; }
.work-row-detail { display: none; margin-top: 10px; }
.work-row-active .work-row-detail { display: block; }
.work-row-detail p { font-size: 13.5px; color: var(--secondary); line-height: 1.6; margin-top: 6px; }
.work-row-detail p span { font-family: var(--font-mono); font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin-right: 8px; }
.work-row-icon { color: var(--muted); flex-shrink: 0; transition: color .2s ease; }
.work-row-active .work-row-icon { color: var(--orange); }
.work-preview { position: sticky; top: 100px; }
.work-preview img { width: 100%; border-radius: 6px; display: block; }

.why-statement { font-family: var(--font-display); font-size: 20px; font-weight: 700; line-height: 1.55; margin-top: 24px; color: var(--secondary); }
.why-statement strong { color: var(--ink); }

.process-track { display: flex; gap: 0; margin-top: 44px; position: relative; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
.process-step { flex: 1; padding: 28px 20px; min-width: 140px; }
.process-num { font-family: var(--font-mono); font-size: 12px; color: var(--muted); }
.process-step h5 { font-family: var(--font-display); font-size: 17px; font-weight: 800; margin-top: 8px; }
.process-step p { font-family: var(--font-mono); font-size: 11.5px; color: var(--muted); margin-top: 8px; line-height: 1.7; }
.process-line { display: none; }

.planner-panel { background: var(--warm-bg); border: 1px solid var(--border); border-radius: 6px; padding: 32px; margin-top: 36px; display: flex; flex-direction: column; gap: 28px; }
.planner-fields { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-end; }
.planner-field { display: flex; flex-direction: column; gap: 6px; min-width: 160px; flex: 1; }
.planner-field label { font-family: var(--font-mono); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--secondary); display: flex; align-items: center; gap: 4px; }
.planner-field select { padding: 10px 12px; border: 1px solid var(--border); border-radius: 4px; font-family: var(--font-body); font-size: 13.5px; background: #fff; }
.planner-cta { margin-top: 0; }
.planner-popular { display: flex; flex-direction: column; gap: 10px; }
.planner-popular > div { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { padding: 6px 14px; border: 1px solid var(--border); border-radius: 999px; font-size: 12px; font-weight: 600; color: var(--secondary); transition: all .15s ease; }
.chip:hover, .chip-active { background: var(--orange); border-color: var(--orange); color: #fff; }

.industry-inline { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 24px; font-family: var(--font-display); font-size: 22px; font-weight: 800; }
.industry-sep { color: var(--border); font-weight: 400; }

.growth-dark { background: var(--dark-bg); color: #fff; padding: 100px var(--pad-desktop); max-width: var(--max-w); margin: 0 auto; }
@media (max-width: 1024px) { .growth-dark { padding: 76px var(--pad-tablet); } }
@media (max-width: 640px) { .growth-dark { padding: 58px var(--pad-mobile); } }
.growth-inner { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; align-items: center; }
@media (max-width: 900px) { .growth-inner { grid-template-columns: 1fr; } }
.growth-text h2 { color: #fff; font-size: 32px; margin-top: 8px; }
.growth-statement { color: rgba(255,255,255,.7); font-size: 15.5px; line-height: 1.6; margin-top: 14px; }
.growth-list { margin-top: 24px; display: flex; flex-direction: column; gap: 14px; }
.growth-list li { display: flex; align-items: center; gap: 12px; font-size: 15px; color: rgba(255,255,255,.85); }
.growth-list li span { font-family: var(--font-mono); font-size: 11px; color: var(--orange); }
.growth-media img { width: 100%; border-radius: 6px; display: block; }

.research { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; align-items: center; }
@media (max-width: 900px) { .research { grid-template-columns: 1fr; } }
.research-media img { width: 100%; border-radius: 6px; display: block; }
.research-text .section-title { font-size: 30px; }
.research-text .section-sub { margin-top: 14px; }
.inline-list { font-family: var(--font-mono); font-size: 12.5px; color: var(--muted); margin-top: 16px; line-height: 1.8; }
.inline-list-light { color: rgba(255,255,255,.6); }

.csr { position: relative; min-height: 520px; display: flex; align-items: flex-end; overflow: hidden; }
.csr-media { position: absolute; inset: 0; }
.csr-media img { width: 100%; height: 100%; object-fit: cover; }
.csr-overlay { position: relative; z-index: 2; padding: 40px; background: linear-gradient(180deg, transparent 0%, rgba(0,0,0,.8) 100%); width: 100%; color: #fff; }
.csr-overlay h2 { color: #fff; font-size: 28px; margin-top: 8px; }
.csr-overlay p { font-size: 15px; line-height: 1.6; margin-top: 12px; color: rgba(255,255,255,.8); }

.testimonials { text-align: center; }
.testimonial-block { max-width: 680px; margin: 32px auto 0; text-align: left; border-left: 3px solid var(--orange); padding-left: 28px; }
.testimonial-quote { font-family: var(--font-display); font-size: 20px; font-weight: 700; line-height: 1.5; color: var(--secondary); margin-top: 16px; }
.testimonial-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 20px; }
.testimonial-name { font-weight: 700; font-size: 14px; }
.testimonial-role { font-size: 12.5px; color: var(--muted); margin-top: 2px; }
.testimonial-nav { display: flex; gap: 8px; }
.testimonial-nav button { width: 32px; height: 32px; border: 1px solid var(--border); border-radius: 50%; display: flex; align-items: center; justify-content: center; transition: all .15s ease; }
.testimonial-nav button:hover { border-color: var(--orange); color: var(--orange); }

.insight-list { margin-top: 32px; border-top: 1px solid var(--border); }
.insight-row { display: flex; align-items: center; gap: 14px; padding: 20px 0; border-bottom: 1px solid var(--border); cursor: pointer; transition: padding-left .2s ease; }
.insight-row:hover { padding-left: 8px; }
.insight-row h4 { font-size: 17px; flex: 1; }
.insight-arrow { color: var(--muted); flex-shrink: 0; transition: all .2s ease; }
.insight-row:hover .insight-arrow { color: var(--orange); transform: translateX(3px); }

.final-cta { background: var(--orange); color: #fff; }
.final-cta-inner { display: flex; justify-content: space-between; align-items: center; gap: 48px; }
@media (max-width: 900px) { .final-cta-inner { flex-direction: column; text-align: center; } }
.final-cta-left { max-width: 520px; }
.final-cta-left h2 { color: #fff; font-size: 34px; margin-top: 8px; }
.final-cta-left p { font-size: 15.5px; color: rgba(255,255,255,.85); margin-top: 14px; line-height: 1.6; }
.final-cta-row { display: flex; gap: 20px; margin-top: 28px; flex-wrap: wrap; }
.final-cta-link { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; font-size: 14px; color: #fff; border-bottom: 1px solid rgba(255,255,255,.5); padding-bottom: 2px; }
.final-cta-chain { display: flex; flex-direction: column; gap: 6px; }
.final-stage { display: inline-block; padding: 10px 20px; border: 1px solid rgba(255,255,255,.3); border-radius: 4px; font-family: var(--font-display); font-weight: 800; font-size: 15px; color: #fff; text-align: center; }
.final-stage-last { background: #fff; color: var(--orange); border-color: #fff; }

/* ---------------- Campaign popup — glassmorphism (uploaded image bg, left info, right graph) ---------------- */
.carousel-card.is-clickable { cursor: pointer; }
.campaign-card-open-hint { position: absolute; top: 8px; right: 8px; z-index: 3; background: rgba(17,17,17,.55); color: #fff; backdrop-filter: blur(4px); font-size: 10px; font-weight: 600; letter-spacing: .04em; padding: 4px 9px; border-radius: 999px; opacity: 0; transform: translateY(-4px); transition: opacity .25s ease, transform .25s ease; pointer-events: none; }
.carousel-card.is-clickable:hover .campaign-card-open-hint, .carousel-card.is-clickable:focus-visible .campaign-card-open-hint { opacity: 1; transform: translateY(0); }
.carousel-card.is-clickable:focus-visible { outline: 3px solid #FF7A00; outline-offset: 2px; }

.cmod-backdrop { position: fixed; inset: 0; z-index: 9999; background: rgba(9,12,20,.6); backdrop-filter: blur(7px); -webkit-backdrop-filter: blur(7px); display: flex; align-items: center; justify-content: center; padding: 24px; animation: cmodFade .22s ease; }
@keyframes cmodFade { from { opacity: 0; } to { opacity: 1; } }
/* Dialog: the UPLOADED campaign image is the background (single image source) */
.cmod-dialog { position: relative; width: min(1120px, 96vw); height: min(680px, 92vh); border-radius: 24px; overflow: hidden; background-size: cover; background-position: center; background-color: #101623; border: 1px solid rgba(255,255,255,.18); box-shadow: 0 34px 90px rgba(2,6,18,.5); animation: cmodRise .28s cubic-bezier(.2,.8,.3,1); display: flex; flex-direction: column; }
.cmod-dialog.cmod-nobg { background: linear-gradient(135deg, #1B2637 0%, #0D1420 100%); }
@keyframes cmodRise { from { opacity: 0; transform: translateY(18px) scale(.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
@media (prefers-reduced-motion: reduce) { .cmod-backdrop, .cmod-dialog, .cmod-ins, .cmod-ins-backdrop { animation: none !important; } }
/* Translucent overlay: dark under the info column, light wash under the graph panel */
.cmod-bg-overlay { position: absolute; inset: 0; z-index: 1; pointer-events: none; background: linear-gradient(90deg, rgba(10,14,24,.8) 0%, rgba(10,14,24,.62) 34%, rgba(240,243,248,.42) 62%, rgba(240,243,248,.52) 100%); }
.cmod-backdrop .cmod-close { position: absolute; top: 16px; right: 16px; z-index: 30; width: 40px; height: 40px; border-radius: 50%; border: 1px solid rgba(255,255,255,.4); background: rgba(15,20,32,.5); color: #fff; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: background .18s ease, transform .25s ease; }
.cmod-close:hover { background: rgba(15,20,32,.82); transform: rotate(90deg); }
.cmod-close:focus-visible { outline: 3px solid #FF7A00; outline-offset: 2px; }

/* Layout: LEFT info column over the image | RIGHT translucent graph panel */
.cmod-main { position: relative; z-index: 2; flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(300px, 4fr) 6fr; }
.cmod-left { min-width: 0; padding: 24px 20px 20px 26px; display: flex; flex-direction: column; gap: 9px; overflow-y: auto; }
.cmod-title-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.cmod-backdrop .cmod-title { margin: 0; font-size: 25px; font-weight: 800; letter-spacing: -0.02em; color: #fff; line-height: 1.12; text-shadow: 0 2px 14px rgba(0,0,0,.5); }
/* Every heading/paragraph inside the popup is white — beats the global ink rules */
.cmod-backdrop h1, .cmod-backdrop h2, .cmod-backdrop h3, .cmod-backdrop h4, .cmod-backdrop h5, .cmod-backdrop h6 { color: #fff; }
.cmod-backdrop p { color: rgba(255,255,255,.92); }
.cmod-backdrop .cmod-desc { margin: 0; font-size: 12.5px; color: rgba(255,255,255,.92); line-height: 1.5; text-shadow: 0 1px 8px rgba(0,0,0,.45); white-space: pre-line; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.cmod-badge { padding: 5px 14px; border-radius: 999px; font-size: 11.5px; font-weight: 800; letter-spacing: .06em; color: #fff; box-shadow: 0 4px 14px rgba(2,6,18,.25); }
.cmod-badge-btl { background: linear-gradient(135deg, #F97316, #EA6A0A); }
.cmod-badge-ttl { background: linear-gradient(135deg, #3B82F6, #2563EB); }
.cmod-badge-atl { background: linear-gradient(135deg, #10B981, #0B915F); }
.cmod-badge-gamified { background: linear-gradient(135deg, #8B5CF6, #7C3AED); }
.cmod-sec-label { display: flex; align-items: center; gap: 7px; margin-top: 5px; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .07em; color: #fff; text-shadow: 0 1px 8px rgba(0,0,0,.5); }
.cmod-sec-label svg { color: #FFB067; flex-shrink: 0; }

/* Glass metric cards — 4 compact cards in a row */
.cmod-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.cmod-metric { background: rgba(255,255,255,.13); border: 1px solid rgba(255,255,255,.24); border-radius: 13px; padding: 9px 10px; backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); box-shadow: 0 6px 18px rgba(2,6,18,.18); min-width: 0; }
.cmod-metric-label { font-size: 8.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: rgba(255,255,255,.78); line-height: 1.4; }
.cmod-metric-value { font-size: 14px; font-weight: 800; letter-spacing: -0.01em; color: #fff; line-height: 1.3; margin-top: 3px; white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.cmod-metric-blue { background: rgba(37,99,235,.32); border-color: rgba(130,170,250,.5); }
.cmod-metric-blue .cmod-metric-value { color: #C4D7FF; }
.cmod-metric-orange { background: rgba(249,115,22,.34); border-color: rgba(250,175,110,.55); }
.cmod-metric-orange .cmod-metric-value { color: #FFDDBF; }

/* HR utilisation */
.cmod-hr-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.cmod-pill { background: rgba(255,255,255,.13); border: 1px solid rgba(255,255,255,.24); border-radius: 999px; padding: 7px 16px; backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); min-width: 0; text-align: center; }
.cmod-pill-label { font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: rgba(255,255,255,.78); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cmod-pill-value { font-size: 14.5px; font-weight: 800; color: #fff; margin-top: 1px; }
.cmod-pill-accent { background: rgba(249,115,22,.88); border-color: rgba(255,195,135,.65); }
.cmod-pill-accent .cmod-pill-label { color: rgba(255,255,255,.92); }
.cmod-pill-accent .cmod-pill-value { color: #fff; }

/* RIGHT — large translucent graph panel */
.cmod-right { min-width: 0; margin: 18px 18px 18px 4px; border-radius: 18px; background: rgba(255,255,255,.66); border: 1px solid rgba(255,255,255,.75); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); box-shadow: 0 12px 36px rgba(2,6,18,.18); padding: 13px 16px 15px; display: flex; flex-direction: column; min-height: 0; }
/* Start Date | End Date chips — straight from the campaign's own dates */
.cmod-range { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; margin-bottom: 6px; padding-right: 42px; }
.cmod-range-chip { display: inline-flex; flex-direction: column; gap: 1px; background: #fff; border: 1px solid #E5E9F2; border-radius: 10px; padding: 4px 12px; box-shadow: 0 2px 8px rgba(15,23,42,.07); }
.cmod-range-chip-label { font-size: 8.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; color: #94A3B8; }
.cmod-range-chip-value { font-size: 12.5px; font-weight: 800; color: #172033; white-space: nowrap; }
.cmod-range-arrow { color: #F97316; font-weight: 800; font-size: 16px; }
.cmod-range-spacer { flex: 1; }
.cmod-legend { display: flex; gap: 12px; font-size: 11px; font-weight: 700; color: #475569; }
.cmod-legend-item { display: inline-flex; align-items: center; gap: 5px; }
.cmod-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; display: inline-block; }

/* Chart */
.cmod-chart { position: relative; flex: 1; min-height: 0; }
.cmod-chart svg { display: block; }
.cmod-chart-empty { border: 1.5px dashed #D7DEE9; border-radius: 12px; height: 100%; min-height: 150px; display: flex; align-items: center; justify-content: center; text-align: center; color: #94A3B8; font-size: 12.5px; padding: 16px; box-sizing: border-box; }
.cmod-tooltip { position: absolute; top: 6px; left: 50%; transform: translateX(-50%); background: rgba(15,23,42,.94); color: #fff; border-radius: 9px; padding: 7px 12px; font-size: 11.5px; line-height: 1.55; box-shadow: 0 8px 22px rgba(15,23,42,.25); z-index: 4; white-space: nowrap; pointer-events: none; }
.cmod-tooltip-date { font-weight: 700; margin-bottom: 2px; }
.cmod-tooltip-row { display: flex; align-items: center; gap: 6px; }

/* Orange "Campaign Insights" pill — bottom-right under the graph */
.cmod-backdrop .cmod-btn-insights { align-self: flex-end; display: inline-flex; align-items: center; gap: 8px; margin-top: 10px; background: linear-gradient(135deg, #F97316, #EA6A0A); color: #fff; border: none; border-radius: 999px; padding: 12px 26px; font-size: 14px; font-weight: 800; letter-spacing: .02em; cursor: pointer; box-shadow: 0 8px 22px rgba(249,115,22,.42); transition: transform .18s ease, box-shadow .18s ease, filter .18s ease; }
.cmod-btn-insights:hover { transform: translateY(-2px); box-shadow: 0 12px 28px rgba(249,115,22,.55); filter: brightness(1.06); }
.cmod-btn-insights:active { transform: translateY(0); }
.cmod-btn-insights:focus-visible { outline: 3px solid rgba(249,115,22,.45); outline-offset: 2px; }

/* ===== Insights popup — SECOND modal opened on top of the first ===== */
.cmod-ins-backdrop { position: absolute; inset: 0; z-index: 40; background: rgba(9,12,20,.52); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); display: flex; align-items: center; justify-content: center; padding: 22px; animation: cmodFade .2s ease; }
.cmod-ins { position: relative; width: min(560px, 100%); max-height: 100%; border-radius: 20px; overflow: hidden; background-size: cover; background-position: center; background-color: #101623; border: 1px solid rgba(255,255,255,.22); box-shadow: 0 30px 70px rgba(2,6,18,.55); animation: cmodRise .25s cubic-bezier(.2,.8,.3,1); display: flex; }
.cmod-ins.cmod-nobg { background: linear-gradient(135deg, #1B2637 0%, #0D1420 100%); }
.cmod-ins-overlay { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(10,14,24,.8), rgba(10,14,24,.88)); }
.cmod-ins-backdrop .cmod-ins-close { position: absolute; top: 14px; right: 14px; z-index: 5; width: 34px; height: 34px; border-radius: 50%; border: 1px solid rgba(255,255,255,.35); background: rgba(15,20,32,.55); color: #fff; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: background .15s ease; }
.cmod-ins-close:hover { background: rgba(15,20,32,.85); }
.cmod-ins-close:focus-visible { outline: 3px solid #FF7A00; outline-offset: 2px; }
.cmod-ins-body { position: relative; z-index: 2; flex: 1; overflow-y: auto; padding: 22px 24px; display: flex; flex-direction: column; gap: 12px; }
.cmod-backdrop .cmod-ins-title { margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -0.02em; color: #fff; }
.cmod-ins-period { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; font-size: 12px; font-weight: 600; color: rgba(255,255,255,.85); }
.cmod-ins-period svg { color: #FFB067; }
.cmod-ins-chips { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px; }
.cmod-ins-chip { background: rgba(255,255,255,.13); border: 1px solid rgba(255,255,255,.24); border-radius: 14px; padding: 11px 8px; backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); text-align: center; }
.cmod-ins-chip-value { font-size: 19px; font-weight: 800; color: #fff; }
.cmod-ins-chip-label { font-size: 8.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: rgba(255,255,255,.72); margin-top: 2px; }
.cmod-ins-sec { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .09em; color: #FFB067; margin-top: 2px; }
.cmod-ins-cmp { display: flex; flex-direction: column; gap: 10px; }
.cmod-ins-row { background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.2); border-radius: 13px; padding: 11px 14px; backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
.cmod-ins-row-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; font-size: 12.5px; font-weight: 700; color: rgba(255,255,255,.9); }
.cmod-ins-row-head b { font-size: 15px; color: #fff; }
.cmod-ins-bar { height: 7px; border-radius: 999px; background: rgba(255,255,255,.18); overflow: hidden; margin-top: 7px; }
.cmod-ins-bar-fill { height: 100%; border-radius: 999px; transition: width .5s ease; }
.cmod-ins-vals { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 6px; font-size: 11.5px; color: rgba(255,255,255,.75); }
.cmod-ins-vals b { color: #fff; font-weight: 700; }
.cmod-ins-backdrop .cmod-ins-btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; margin-top: 4px; background: linear-gradient(135deg, #F97316, #EA6A0A); color: #fff; border: none; border-radius: 999px; padding: 11px 22px; font-size: 13.5px; font-weight: 800; cursor: pointer; box-shadow: 0 8px 22px rgba(249,115,22,.4); transition: transform .18s ease, box-shadow .18s ease; }
.cmod-ins-btn:hover { transform: translateY(-2px); box-shadow: 0 12px 26px rgba(249,115,22,.52); }
.cmod-ins-btn:focus-visible { outline: 3px solid rgba(249,115,22,.45); outline-offset: 2px; }

/* Responsive */
@media (max-width: 640px) {
  .cmod-backdrop { padding: 10px; }
  .cmod-dialog { border-radius: 18px; height: auto; }
  .cmod-bg-overlay { background: linear-gradient(180deg, rgba(10,14,24,.82), rgba(10,14,24,.9)); }
  .cmod-title { font-size: 21px; }
  .cmod-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
  .cmod-hr-grid { grid-template-columns: 1fr; gap: 7px; }
  .cmod-pill { border-radius: 13px; }
  .cmod-ins-chips { gap: 7px; }
  .cmod-ins-chip-value { font-size: 16px; }
  .cmod-btn-insights { align-self: stretch; justify-content: center; }
  .cmod-tooltip { position: static; transform: none; margin-top: 8px; white-space: normal; }
}
`;
