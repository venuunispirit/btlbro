#!/usr/bin/env node
// Seeds all hardcoded frontend data into the CMS (db.json site_content + products).
// Array sections are stored as { items: [...] } so the admin editor can read/write them.
// Run once: node server/seed-cms-data.mjs

import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(__dirname, 'data', 'db.json');
const adapter = new JSONFile(file);
const db = new Low(adapter, {});

await db.read();
if (!db.data) { console.error('Cannot read db.json'); process.exit(1); }

if (!db.data.site_content) db.data.site_content = {};
if (!db.data.products) db.data.products = [];

const c = db.data.site_content;

// ─── Landing Page Content ────────────────────────────────────────────
c.hero = {
  eyebrow: 'Integrated Marketing & Business Growth',
  headline: 'Ideas That Build Brands. Strategies That Grow Business.',
  headline_accent: 'Strategies That Grow Business.',
  copy: 'BTLbro brings creative, activation, digital and business development together to help brands reach the right people, generate opportunities and drive measurable growth.',
  cta_primary: 'Cart',
  cta_primary_link: '/products',
  cta_secondary: 'Explore Our Work',
  cta_secondary_link: '#work',
  hero_image: 'https://images.unsplash.com/photo-1600880292203-757bb62b4baf?auto=format&fit=crop&w=1800&q=80',
  collage_retail_image: 'https://images.unsplash.com/photo-1593113646773-028c64a8f1b8?auto=format&fit=crop&w=1600&q=80',
  collage_phone_image: 'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?auto=format&fit=crop&w=1200&q=80',
  phone_overlay_title: 'Digital Amplification',
  phone_overlay_text: 'Extend reach. Drive engagement. Multiply impact.',
};

// Array sections wrapped in { items: [...] } for the editor
c.hero_features = {
  items: [
    { title: 'Creative Strategy', desc: 'Insight-led ideas that build brands' },
    { title: 'On-ground Execution', desc: 'Flawless execution where it matters' },
    { title: 'Business Growth', desc: 'From engagement to measurable results' },
  ],
};

c.marquee = {
  items: [
    { title: 'Retail Activation', desc: 'Engaging customers directly at retail locations.', image: 'https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=900&q=80' },
    { title: 'Event Marketing', desc: 'Creating memorable brand experiences.', image: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=900&q=80' },
    { title: 'Brand Experience', desc: 'Turning interactions into connections.', image: 'https://images.unsplash.com/photo-1521737604893-d14cc237f11d?auto=format&fit=crop&w=900&q=80' },
    { title: 'Field Research', desc: 'Ground insights that guide strategy.', image: 'https://images.unsplash.com/photo-1531482615713-2afd69097998?auto=format&fit=crop&w=900&q=80' },
    { title: 'Digital Amplification', desc: 'Extending reach across every channel.', image: 'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?auto=format&fit=crop&w=900&q=80' },
  ],
  speed_seconds: '5',
};

c.hero_stats = {
  items: [
    { value: '500+', label: 'Activations Executed' },
    { value: '50+', label: 'Cities Covered' },
    { value: '250+', label: 'Brands Served' },
  ],
};

c.trust = {
  label: 'Trusted by ambitious brands across industries',
  logos: ['Third Wave Coffee', 'Anand Diagnostics', 'Ceyone', 'HDFC Bank', 'IDFC FIRST Bank', 'Equitas Small Finance Bank', 'LuLu Mall', 'Godrej', 'Life Skill', 'Decathlon'],
};

c.value_chain = {
  lede: "BTLbro doesn't stop at advertising. Every engagement moves a brand along the same line —",
  stages: [
    { stage: 'Attention', note: 'Creative media & brand marketing get you noticed.' },
    { stage: 'Engagement', note: 'Retail, social and digital create real interaction.' },
    { stage: 'Activation', note: 'BTL / TTL / ATL put you in front of the right rooms.' },
    { stage: 'Leads', note: 'Field campaigns convert interest into qualified pipeline.' },
    { stage: 'Partnerships', note: 'B2B tie-ups turn pipeline into structured deals.' },
    { stage: 'Revenue', note: 'Business development closes the loop on growth.' },
  ],
  trust_label: 'Built for brands that want more than impressions',
  trust_names: ['Placeholder Co.', 'Placeholder Retail', 'Placeholder FMCG', 'Placeholder Tech', 'Placeholder Fin', 'Placeholder D2C'],
};

c.pillars = {
  items: [
    {
      tag: 'Creative & Brand',
      headline: 'Make your brand impossible to ignore.',
      body: 'Build identity, visibility and communication that gets your brand noticed by the right audience — on shelf, on screen and on the street.',
      services: 'Creative Media, Brand Marketing, Retail Branding, Social Media Marketing, Digital Marketing',
      cta: 'Explore Creative & Brand',
      image: 'https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=1200&q=80',
    },
    {
      tag: 'Business Growth',
      headline: 'Turn opportunities into revenue.',
      body: 'We connect marketing activity to the pipeline — qualified leads, B2B tie-ups and revenue opportunities your business team can act on.',
      services: 'Business Development, Revenue Generation, Lead Generation, B2B Tie-ups',
      cta: 'Explore Business Growth',
      image: 'https://images.unsplash.com/photo-1521737604893-d14cc237f11d?auto=format&fit=crop&w=1200&q=80',
    },
    {
      tag: 'Media & Activations',
      headline: 'Put your brand where people are.',
      body: 'From corporate parks to retail aisles and residential communities, we plan and execute activations across the full BTL–TTL–ATL spectrum.',
      services: 'Brand Activation, BTL, TTL, ATL, Corporate Activations, RWA Activations, Retail Activations',
      cta: 'Explore Activations',
      image: 'https://images.unsplash.com/photo-1573164713988-8665fc963095?auto=format&fit=crop&w=1200&q=80',
    },
    {
      tag: 'Research & Impact',
      headline: 'Understand markets. Create impact.',
      body: 'Field research and CSR programs that help brands make better decisions and build genuine goodwill with the communities they serve.',
      services: 'Field Research, Consumer Research, Market Insights, CSR Campaigns',
      cta: 'Explore Research & Impact',
      image: 'https://images.unsplash.com/photo-1531482615713-2afd69097998?auto=format&fit=crop&w=1200&q=80',
    },
  ],
};

c.capability_directory = {
  items: [
    { cat: 'Brand', items: 'Creative Media · Brand Marketing · Retail Branding & Placement' },
    { cat: 'Growth', items: 'Business Development · Revenue Generation · Lead Generation · B2B Tie-ups' },
    { cat: 'Media', items: 'BTL · TTL · ATL · Brand Activation' },
    { cat: 'Digital', items: 'Social Media Marketing · Digital Marketing' },
    { cat: 'Insights', items: 'Field Research · Market Research' },
    { cat: 'Impact', items: 'CSR Campaigns' },
  ],
};

c.outcomes = {
  items: [
    { title: 'Build Brand Awareness', detail: 'Reach new audiences and increase visibility through creative media, brand marketing and retail placement designed to get you noticed.' },
    { title: 'Generate Leads', detail: 'Field and digital campaigns engineered to capture qualified prospects, not just impressions — with clear hand-off to your sales team.' },
    { title: 'Increase Revenue', detail: 'Marketing activity mapped directly to business opportunities: pipeline, partnerships and measurable commercial outcomes.' },
    { title: 'Enter New Markets', detail: 'Field research, activations and local partnerships that de-risk expansion into a new city, category or customer segment.' },
    { title: 'Build B2B Partnerships', detail: 'Strategic tie-ups and business development that turn brand relationships into structured commercial agreements.' },
    { title: 'Engage Consumers', detail: 'Real-world and digital interactions designed around genuine participation, not passive impressions.' },
  ],
};

c.channels = {
  items: [
    { key: 'ATL', title: 'Build mass awareness.', items: 'Outdoor · Mass Media · Large-scale campaigns', width: '30%' },
    { key: 'BTL', title: 'Create direct engagement.', items: 'Activations · Retail · Corporate · Communities', width: '40%' },
    { key: 'TTL', title: 'Connect both worlds.', items: 'Integrated campaigns · Digital amplification · Offline + online', width: '30%' },
  ],
  statement: 'BTLbro plans around the business objective — not around a single channel.',
};

c.case_studies = {
  items: [
    {
      client: 'Placeholder Client', type: 'Corporate Activation', title: 'Engaging a distributed tech workforce',
      challenge: 'Low in-person engagement across five tech parks.',
      solution: 'A five-city corporate activation series with live product sampling.',
      result: '8,000+ employees engaged in six weeks.',
      image: 'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?auto=format&fit=crop&w=1200&q=80',
    },
    {
      client: 'Placeholder Client', type: 'RWA Activation', title: 'Reaching families where they live',
      challenge: 'Category awareness was flat in residential catchments.',
      solution: 'Weekend community activations across twenty-plus gated communities.',
      result: 'Strong sampling and sign-up volume across communities.',
      image: 'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?auto=format&fit=crop&w=1200&q=80',
    },
    {
      client: 'Placeholder Client', type: 'Retail Promotion', title: 'Driving trial at the shelf',
      challenge: 'A new SKU needed visibility inside high-footfall retail.',
      solution: 'In-mall promoters and branded sampling counters.',
      result: 'Strong footfall-to-trial conversion across malls.',
      image: 'https://images.unsplash.com/photo-1560264280-88b68371db39?auto=format&fit=crop&w=1200&q=80',
    },
  ],
};

c.process_steps = {
  items: [
    { title: 'Understand', items: 'Business objective, Audience, Market, Challenge' },
    { title: 'Strategize', items: 'Channel, Creative, Activation, Growth plan' },
    { title: 'Execute', items: 'Digital, On-ground, Media, Partnerships' },
    { title: 'Amplify', items: 'Content, Social, Media, B2B opportunities' },
    { title: 'Measure', items: 'Reach, Leads, Engagement, Business outcomes' },
  ],
};

c.industries = {
  items: ['FMCG', 'Consumer Tech', 'Healthcare', 'Fintech', 'Retail', 'Food & Beverage', 'Automotive', 'Real Estate', 'Education', 'D2C', 'Corporate', 'Lifestyle'],
};

c.growth_section = {
  label: 'Beyond Marketing',
  headline: "We don't stop at visibility.",
  statement: 'We help turn attention into opportunity — and opportunity into business.',
  points: ['Lead Generation', 'B2B Partnerships', 'Business Development', 'Revenue Opportunities', 'Market Expansion', 'Strategic Tie-ups'],
  cta: 'Explore Growth Solutions',
  image: 'https://images.unsplash.com/photo-1556157382-97eda2d62296?auto=format&fit=crop&w=1200&q=80',
};

c.research = {
  label: 'Research & Insights',
  headline: 'Better decisions start with better insights.',
  sub: "BTLbro's field research capabilities help brands understand consumers, markets and opportunities before making critical decisions.",
  points: 'Field Research · Consumer Surveys · Market Validation · Competitor Insights · Location Research · Campaign Feedback',
  cta: 'Explore Research',
  image: 'https://images.unsplash.com/photo-1531482615713-2afd69097998?auto=format&fit=crop&w=1200&q=80',
};

c.csr = {
  headline: 'Campaigns that create more than visibility.',
  text: 'Plan and execute CSR initiatives that connect brands with communities through meaningful, measurable action.',
  points: 'Community Engagement · Awareness Campaigns · On-ground Execution · Impact Documentation · CSR Communication',
  cta: 'Explore CSR Campaigns',
  image: 'https://images.unsplash.com/photo-1593113646773-028c64a8f1b8?auto=format&fit=crop&w=1600&q=80',
};

c.testimonials = {
  items: [
    { quote: 'BTLbro helped us connect with our audience in the right places. The execution was seamless from planning through to on-ground delivery.', name: 'Placeholder Name', role: 'Marketing Lead, Placeholder Co.' },
    { quote: 'Their team thinks about business outcomes, not just campaign metrics. That distinction changed how we brief them.', name: 'Placeholder Name', role: 'Brand Manager, Placeholder Co.' },
  ],
};

c.insights = {
  items: [
    { title: 'How BTL Marketing Drives Measurable Business Growth', tag: 'Strategy' },
    { title: 'ATL vs BTL vs TTL: Choosing the Right Strategy', tag: 'Guide' },
    { title: 'How Hyperlocal Marketing Helps Brands Enter New Markets', tag: 'Growth' },
  ],
};

c.final_cta = {
  label: 'Got a business challenge?',
  headline: "Let's turn it into an opportunity.",
  text: "Whether you need visibility, engagement, leads, partnerships or revenue growth — let's build the right strategy together.",
  cta_primary: 'Customize Campaign',
  cta_primary_link: '/customize',
  cta_secondary: 'Talk to Our Team',
};

c.planner = {
  headline: 'Where do you want your brand to show up?',
  cities: ['Bengaluru', 'Mumbai', 'Delhi NCR', 'Hyderabad', 'Pune', 'Chennai'],
};

c.why_btlbro = {
  headline: 'Why brands work with BTLbro.',
  statement: 'Brands choose BTLbro for <strong>integrated expertise</strong> — creative, marketing, activation and growth under one roof — backed by <strong>hyperlocal intelligence</strong> across audiences and markets, delivered through <strong>end-to-end execution</strong> from strategy to reporting, guided by <strong> business-first thinking</strong> rather than vanity metrics, supported by a genuine <strong> on-ground network</strong>, and proven with <strong>measurable impact</strong> at every stage.',
};

c.footer = {
  company_name: 'BTLbro',
  tagline: 'Integrated Marketing & Business Growth',
  email: 'hello@btlbro.in',
  phone: '',
  address: '',
};

// ─── Products ────────────────────────────────────────────────────────
const seedProducts = [
  { name: 'Premium Roll Up Standee', category: 'Standee & Banners', price: 2499, description: 'Retractable roll-up standee with aluminium frame and printed vinyl graphic.', icon: '🎪', rating: 4.6, reviews: 212, use: 'Indoor', sizes: [{ label: '2×5 ft', mult: 1 }, { label: '2.5×6 ft', mult: 1.35 }, { label: '3×6 ft', mult: 1.7 }], finishing: [{ label: 'Carry bag', price: 250 }, { label: 'Premium vinyl upgrade', price: 480 }] },
  { name: 'Custom Vinyl Banner', category: 'Standee & Banners', price: 649, description: 'Heavy-duty 13 oz vinyl banner, weather-resistant with UV inks.', icon: '🚩', rating: 4.4, reviews: 389, use: 'Outdoor', sizes: [{ label: '3×2 ft', mult: 1 }, { label: '5×3 ft', mult: 1.8 }, { label: '8×4 ft', mult: 3.2 }], finishing: [{ label: 'Extra grommets', price: 120 }, { label: 'Pole pockets', price: 200 }] },
  { name: 'Digital Screen Advertising', category: 'Digital Screens', price: 2999, description: 'Your ad looped on LED screens in apartments, cafés and gyms.', icon: '📺', rating: 4.8, reviews: 96, use: 'Indoor', sizes: [{ label: '1 location / month', mult: 1 }, { label: '5 locations / month', mult: 4.4 }, { label: '10 locations / month', mult: 8.2 }], finishing: [{ label: 'Creative design service', price: 1500 }] },
  { name: 'Society Notice Board Branding', category: 'Notice Boards', price: 349, description: 'A4/A3 branded inserts on society notice boards.', icon: '📌', rating: 4.5, reviews: 158, use: 'Indoor', sizes: [{ label: '1 board / month', mult: 1 }, { label: '10 boards / month', mult: 8.5 }, { label: '25 boards / month', mult: 19 }], finishing: [{ label: 'A3 upgrade', price: 90 }, { label: 'Design service', price: 900 }] },
  { name: 'Lift Branding Wrap', category: 'Lift Branding', price: 1899, description: 'Full wrap or panel branding inside residential lifts.', icon: '🛗', rating: 4.7, reviews: 141, use: 'Indoor', sizes: [{ label: '1 lift / month', mult: 1 }, { label: '5 lifts / month', mult: 4.3 }, { label: '10 lifts / month', mult: 7.8 }], finishing: [{ label: 'Full cab wrap (4 panels)', price: 1200 }, { label: 'Design service', price: 900 }] },
  { name: 'Custom Canopy Tent 10×10', category: 'Canopy & Tents', price: 18999, description: 'Printed canopy with steel frame — events, activations, melas.', icon: '⛺', rating: 4.6, reviews: 87, use: 'Outdoor', sizes: [{ label: '10×10 ft', mult: 1 }, { label: '10×15 ft', mult: 1.4 }, { label: '10×20 ft', mult: 1.8 }], finishing: [{ label: 'Back wall print', price: 3500 }, { label: '2 sidewalls', price: 4200 }] },
  { name: 'Feather Flag (Teardrop)', category: 'Flags', price: 1549, description: 'Single/double-sided polyester feather flag with pole set.', icon: '🚩', rating: 4.5, reviews: 233, use: 'Outdoor', sizes: [{ label: '8 ft', mult: 1 }, { label: '10 ft', mult: 1.25 }, { label: '13 ft', mult: 1.6 }], finishing: [{ label: 'Double-sided print', price: 900 }, { label: 'Cross base', price: 650 }] },
  { name: 'Coroplast Yard Sign', category: 'Signage & Decals', price: 249, description: 'Lightweight corrugated plastic sign with H-stake.', icon: '🪧', rating: 4.3, reviews: 176, use: 'Outdoor', sizes: [{ label: '12×18 in', mult: 1 }, { label: '18×24 in', mult: 1.9 }, { label: '24×36 in', mult: 3.4 }], finishing: [{ label: 'H-stake included', price: 0 }, { label: 'UV lamination', price: 150 }] },
  { name: 'Custom Vinyl Decal / Sticker Sheet', category: 'Signage & Decals', price: 199, description: 'Die-cut adhesive decals for walls, windows and products.', icon: '✂️', rating: 4.4, reviews: 302, use: 'Indoor', sizes: [{ label: 'A4 sheet', mult: 1 }, { label: 'A3 sheet', mult: 1.8 }, { label: '2×3 ft', mult: 4.5 }], finishing: [{ label: 'Matte lamination', price: 120 }, { label: 'Transfer tape', price: 80 }] },
  { name: 'Expo Stall Space Booking', category: 'Stall & Events', price: 12499, description: 'Book branded stall presence at curated society events.', icon: '🏪', rating: 4.7, reviews: 54, use: 'Indoor', sizes: [{ label: '1 event', mult: 1 }, { label: '3 events', mult: 2.7 }, { label: '6 events', mult: 4.8 }], finishing: [{ label: 'Table + cloth', price: 800 }, { label: 'Promoter staff / day', price: 1500 }] },
  { name: 'Marketing Brochures / Flyers', category: 'Marketing Materials', price: 599, description: 'Offset-printed flyers and brochures on 130 GSM art paper.', icon: '📄', rating: 4.5, reviews: 421, use: 'Indoor', sizes: [{ label: '100 pcs', mult: 1 }, { label: '500 pcs', mult: 3.4 }, { label: '1000 pcs', mult: 5.6 }], finishing: [{ label: 'A4 size', price: 0 }, { label: 'A3 size', price: 60 }, { label: 'Matte finish', price: 40 }] },
  { name: 'Corporate Gift Hamper', category: 'Gifting', price: 4499, description: 'Custom-branded hampers for corporate gifting.', icon: '🎁', rating: 4.8, reviews: 67, use: 'Indoor', sizes: [{ label: 'Basic (10 pcs)', mult: 1 }, { label: 'Premium (10 pcs)', mult: 1.9 }, { label: 'Luxury (10 pcs)', mult: 3.2 }], finishing: [{ label: 'Custom logo print', price: 700 }, { label: 'Gift wrap + card', price: 350 }] },
];

if (db.data.products.length === 0) {
  let nextId = 1;
  for (const p of seedProducts) {
    db.data.products.push({
      id: nextId++, name: p.name, category: p.category, price: p.price, mrp: null,
      description: p.description, image: '', size_label: p.sizes[0]?.label || '', stock: null,
      tags: [], is_active: true,
      icon: p.icon, rating: p.rating, reviews: p.reviews, use: p.use, printed: 'Printed',
      sizes: p.sizes, finishing: p.finishing,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
  }
  console.log(`✅ Seeded ${seedProducts.length} products`);
} else {
  console.log(`ℹ️  Products already exist (${db.data.products.length}), skipping`);
}

await db.write();
console.log(`✅ CMS content blocks seeded: ${Object.keys(c).join(', ')}`);
