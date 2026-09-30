import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import {
  Search, Star, X, Minus, Plus, ShoppingCart, ArrowLeft, ArrowRight,
  Truck, ShieldCheck, Palette, ChevronDown, Trash2, FileText, Heart,
} from "lucide-react";
import {
  getUser as getSessionUser, getToken, login as apiLogin, register as apiRegister,
  logout as apiLogout, mergeGuestCart, addToCart as apiAddToCart, removeFromCart as apiRemoveFromCart,
  getWishlist as apiGetWishlist, toggleWishlist as apiToggleWishlist,
} from "../services/shopClient.js";

/* ============================================================
   BTLbro — Products & Services (e-commerce catalog)
   Fetches from CMS API (/api/products). Falls back to hardcoded
   PRODUCTS if the API is unavailable.
   ============================================================ */

// ---------- Hardcoded fallback (used when API is down) ----------
const FALLBACK_PRODUCTS = [
  { id: "standee-premium", name: "Premium Roll Up Standee", category: "Standee & Banners", use: "Indoor", printed: "Printed", rating: 4.6, reviews: 212, icon: "🎪", desc: "Retractable roll-up standee with aluminium frame and printed vinyl graphic.", sizes: [{ label: "2×5 ft", mult: 1 }, { label: "2.5×6 ft", mult: 1.35 }, { label: "3×6 ft", mult: 1.7 }], finishing: [{ label: "Carry bag", price: 250 }, { label: "Premium vinyl upgrade", price: 480 }], base: 2499 },
  { id: "vinyl-banner", name: "Custom Vinyl Banner", category: "Standee & Banners", use: "Outdoor", printed: "Printed", rating: 4.4, reviews: 389, icon: "🚩", desc: "Heavy-duty 13 oz vinyl banner, weather-resistant with UV inks.", sizes: [{ label: "3×2 ft", mult: 1 }, { label: "5×3 ft", mult: 1.8 }, { label: "8×4 ft", mult: 3.2 }], finishing: [{ label: "Extra grommets", price: 120 }, { label: "Pole pockets", price: 200 }], base: 649 },
  { id: "digital-screen-ads", name: "Digital Screen Advertising", category: "Digital Screens", use: "Indoor", printed: "Printed", rating: 4.8, reviews: 96, icon: "📺", desc: "Your ad looped on LED screens in apartments, cafés and gyms.", sizes: [{ label: "1 location / month", mult: 1 }, { label: "5 locations / month", mult: 4.4 }, { label: "10 locations / month", mult: 8.2 }], finishing: [{ label: "Creative design service", price: 1500 }], base: 2999 },
  { id: "notice-board", name: "Society Notice Board Branding", category: "Notice Boards", use: "Indoor", printed: "Printed", rating: 4.5, reviews: 158, icon: "📌", desc: "A4/A3 branded inserts on society notice boards.", sizes: [{ label: "1 board / month", mult: 1 }, { label: "10 boards / month", mult: 8.5 }, { label: "25 boards / month", mult: 19 }], finishing: [{ label: "A3 upgrade", price: 90 }, { label: "Design service", price: 900 }], base: 349 },
  { id: "lift-branding", name: "Lift Branding Wrap", category: "Lift Branding", use: "Indoor", printed: "Printed", rating: 4.7, reviews: 141, icon: "🛗", desc: "Full wrap or panel branding inside residential lifts.", sizes: [{ label: "1 lift / month", mult: 1 }, { label: "5 lifts / month", mult: 4.3 }, { label: "10 lifts / month", mult: 7.8 }], finishing: [{ label: "Full cab wrap (4 panels)", price: 1200 }, { label: "Design service", price: 900 }], base: 1899 },
  { id: "canopy-tent", name: "Custom Canopy Tent 10×10", category: "Canopy & Tents", use: "Outdoor", printed: "Printed", rating: 4.6, reviews: 87, icon: "⛺", desc: "Printed canopy with steel frame — events, activations, melas.", sizes: [{ label: "10×10 ft", mult: 1 }, { label: "10×15 ft", mult: 1.4 }, { label: "10×20 ft", mult: 1.8 }], finishing: [{ label: "Back wall print", price: 3500 }, { label: "2 sidewalls", price: 4200 }, { label: "Spike-free weight plates", price: 1400 }], base: 18999 },
  { id: "feather-flag", name: "Feather Flag (Teardrop)", category: "Flags", use: "Outdoor", printed: "Printed", rating: 4.5, reviews: 233, icon: "🚩", desc: "Single/double-sided polyester feather flag with pole set.", sizes: [{ label: "8 ft", mult: 1 }, { label: "10 ft", mult: 1.25 }, { label: "13 ft", mult: 1.6 }], finishing: [{ label: "Double-sided print", price: 900 }, { label: "Cross base", price: 650 }, { label: "Water bag", price: 400 }], base: 1549 },
  { id: "yard-sign", name: "Coroplast Yard Sign", category: "Signage & Decals", use: "Outdoor", printed: "Printed", rating: 4.3, reviews: 176, icon: "🪧", desc: "Lightweight corrugated plastic sign with H-stake.", sizes: [{ label: "12×18 in", mult: 1 }, { label: "18×24 in", mult: 1.9 }, { label: "24×36 in", mult: 3.4 }], finishing: [{ label: "H-stake included", price: 0 }, { label: "UV lamination", price: 150 }], base: 249 },
  { id: "vinyl-decal", name: "Custom Vinyl Decal / Sticker Sheet", category: "Signage & Decals", use: "Indoor", printed: "Printed", rating: 4.4, reviews: 302, icon: "✂️", desc: "Die-cut adhesive decals for walls, windows and products.", sizes: [{ label: "A4 sheet", mult: 1 }, { label: "A3 sheet", mult: 1.8 }, { label: "2×3 ft", mult: 4.5 }], finishing: [{ label: "Matte lamination", price: 120 }, { label: "Transfer tape", price: 80 }], base: 199 },
  { id: "stall-space", name: "Expo Stall Space Booking", category: "Stall & Events", use: "Indoor", printed: "Non Printed", rating: 4.7, reviews: 54, icon: "🏪", desc: "Book branded stall presence at curated residential society events.", sizes: [{ label: "1 event", mult: 1 }, { label: "3 events", mult: 2.7 }, { label: "6 events", mult: 4.8 }], finishing: [{ label: "Table + cloth", price: 800 }, { label: "Promoter staff / day", price: 1500 }], base: 12499 },
  { id: "brochures", name: "Marketing Brochures / Flyers", category: "Marketing Materials", use: "Indoor", printed: "Printed", rating: 4.5, reviews: 421, icon: "📄", desc: "Offset-printed flyers and brochures on 130 GSM art paper.", sizes: [{ label: "100 pcs", mult: 1 }, { label: "500 pcs", mult: 3.4 }, { label: "1000 pcs", mult: 5.6 }], finishing: [{ label: "A4 size", price: 0 }, { label: "A3 size", price: 60 }, { label: "Matte finish", price: 40 }], base: 599 },
  { id: "gift-hamper", name: "Corporate Gift Hamper", category: "Gifting", use: "Indoor", printed: "Printed", rating: 4.8, reviews: 67, icon: "🎁", desc: "Custom-branded hampers for corporate gifting.", sizes: [{ label: "Basic (10 pcs)", mult: 1 }, { label: "Premium (10 pcs)", mult: 1.9 }, { label: "Luxury (10 pcs)", mult: 3.2 }], finishing: [{ label: "Custom logo print", price: 700 }, { label: "Gift wrap + card", price: 350 }], base: 4499 },
];

// Normalize a CMS product into the shape ProductsPage expects
function normalizeProduct(p) {
  return {
    id: p.id,
    name: p.name,
    category: p.category || "General",
    use: p.use || "Indoor",
    printed: p.printed || "Printed",
    rating: p.rating || 0,
    reviews: p.reviews || 0,
    icon: p.icon || "📦",
    desc: p.description || "",
    sizes: Array.isArray(p.sizes) && p.sizes.length > 0 ? p.sizes : [{ label: p.size_label || "Standard", mult: 1 }],
    finishing: Array.isArray(p.finishing) ? p.finishing : [],
    base: p.price || 0,
    image: p.image || "",
  };
}

const fmt = (n) => `₹${Math.round(n).toLocaleString("en-IN")}`;

// ---------- Filter section with counts ----------
function FilterGroup({ title, options, counts, selected, onPick }) {
  return (
    <div className="pf-group">
      <div className="pf-group-title">{title}</div>
      {options.map((o) => (
        <label key={o} className={`pf-option ${selected === o ? "pf-option-active" : ""}`}>
          <input type="radio" name={title} checked={selected === o} onChange={() => onPick(selected === o ? "" : o)} />
          <span className="pf-option-label">{o}</span>
          <span className="pf-option-count">({counts[o] || 0})</span>
        </label>
      ))}
    </div>
  );
}

// ---------- Product card ----------
function ProductCard({ p, onOpen, wish, onWish }) {
  return (
    <div className="pcard" onClick={() => onOpen(p)}>
      <div className="pcard-thumb">
        {p.image ? <img src={p.image} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : p.icon}
        <button className={`pcard-heart ${wish ? "pcard-heart-on" : ""}`}
          title={wish ? "Remove from wishlist" : "Save to wishlist"}
          onClick={(e) => { e.stopPropagation(); onWish(p); }}>
          <Heart size={15} fill={wish ? "#F2701D" : "none"} />
        </button>
      </div>
      <div className="pcard-body">
        <div className="pcard-name">{p.name}</div>
        <div className="pcard-rating">
          <Star size={12} fill="#F5A623" color="#F5A623" /> {p.rating}
          <span className="pcard-reviews">({p.reviews})</span>
        </div>
        <div className="pcard-size">{p.sizes[0].label}</div>
        <div className="pcard-price-row">
          <span className="pcard-price-label">Starts at:</span>
          <span className="pcard-price">{fmt(p.base)}</span>
        </div>
        <button className="pcard-cta" onClick={(e) => { e.stopPropagation(); onOpen(p); }}>
          Customize <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}

// ---------- Product detail ----------
function ProductView({ p, onBack, onAdd, wish, onWish }) {
  const [sizeIdx, setSizeIdx] = useState(0);
  const [qty, setQty] = useState(1);
  const [addons, setAddons] = useState({});
  const [faqOpen, setFaqOpen] = useState(-1);

  const size = p.sizes[sizeIdx];
  const unit = p.base * size.mult;
  const addonTotal = Object.values(addons).reduce((a, b) => a + b, 0);
  const total = unit * qty + addonTotal * qty;

  return (
    <div className="pv">
      <button className="pv-back" onClick={onBack}><ArrowLeft size={15} /> All Products</button>
      <div className="pv-crumb">Home / {p.category} / <strong>{p.name}</strong></div>

      <div className="pv-grid">
        <div className="pv-thumb-wrap">
          <div className="pv-thumb">
            {p.image ? <img src={p.image} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 18 }} /> : p.icon}
            <button className={`pcard-heart pv-heart ${wish ? "pcard-heart-on" : ""}`}
              title={wish ? "Remove from wishlist" : "Save to wishlist"}
              onClick={() => onWish(p)}>
              <Heart size={20} fill={wish ? "#F2701D" : "none"} />
            </button>
          </div>
          <div className="pv-thumb-badges">
            <span className="pv-badge"><ShieldCheck size={13} /> Premium Quality</span>
            <span className="pv-badge"><Palette size={13} /> Free Design Support</span>
          </div>
        </div>

        <div className="pv-info">
          <h1 className="pv-name">{p.name}</h1>
          <div className="pcard-rating pv-rating">
            <Star size={13} fill="#F5A623" color="#F5A623" /> {p.rating}
            <span className="pcard-reviews">({p.reviews} reviews)</span>
          </div>
          <p className="pv-desc">{p.desc}</p>

          <div className="pv-opt-title">Size / Plan</div>
          <div className="pv-sizes">
            {p.sizes.map((s, i) => (
              <button key={s.label} className={`pv-size ${i === sizeIdx ? "pv-size-active" : ""}`} onClick={() => setSizeIdx(i)}>
                {s.label}
              </button>
            ))}
          </div>

          {p.finishing.length > 0 && (
            <>
              <div className="pv-opt-title">Finishing & Add-ons</div>
              <div className="pv-addons">
                {p.finishing.map((f) => (
                  <label key={f.label} className={`pv-addon ${addons[f.label] ? "pv-addon-active" : ""}`}>
                    <input type="checkbox" checked={!!addons[f.label]}
                      onChange={() => setAddons((prev) => {
                        const next = { ...prev };
                        if (next[f.label]) delete next[f.label]; else next[f.label] = f.price;
                        return next;
                      })} />
                    <span>{f.label}</span>
                    <span className="pv-addon-price">{f.price === 0 ? "Free" : `+${fmt(f.price)}`}</span>
                  </label>
                ))}
              </div>
            </>
          )}

          <div className="pv-opt-title">Quantity</div>
          <div className="pv-qty-row">
            <div className="pv-qty">
              <button onClick={() => setQty((q) => Math.max(1, q - 1))}><Minus size={14} /></button>
              <span>{qty}</span>
              <button onClick={() => setQty((q) => q + 1)}><Plus size={14} /></button>
            </div>
            <div className="pv-price-box">
              <div className="pv-price">{fmt(total)}</div>
            </div>
          </div>

          <div className="pv-cta-row">
            <button className="pv-add" ref={(el) => { if (el) el.dataset.flyBtn = "1"; }} onClick={(e) => onAdd({ p, size, qty, addons, total, sourceEl: e.currentTarget })}>
              <ShoppingCart size={16} /> Add to Cart — {fmt(total)}
            </button>
          </div>

          <div className="pv-trust">
            <span><Truck size={14} /> Pan-India delivery in 5–7 days</span>
            <span><ShieldCheck size={14} /> Quality proof before print</span>
            <span><Palette size={14} /> Free design help</span>
          </div>
        </div>
      </div>

      <div className="pv-faq">
        {[
          { q: "How long does delivery take?", a: "Standard production is 3–5 working days, delivery 5–7 days depending on your city." },
          { q: "Can I use my own design?", a: "Yes — upload your artwork after checkout. Our team checks print quality free of charge." },
          { q: "Do you install at the location?", a: `For ${p.category.toLowerCase()} in serviceable catchments, our field team handles placement and installation.` },
        ].map((f, i) => (
          <div key={f.q} className="pv-faq-item">
            <button className="pv-faq-q" onClick={() => setFaqOpen(faqOpen === i ? -1 : i)}>
              {f.q} <ChevronDown size={15} style={{ transform: faqOpen === i ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
            </button>
            {faqOpen === i && <div className="pv-faq-a">{f.a}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Cart drawer ----------
function CartDrawer({ items, onClose, onRemove, onCheckout }) {
  const subtotal = items.reduce((s, i) => s + (i.unit_price || 0) * (i.qty || 1), 0);
  return (
    <div className="cart-overlay" onClick={onClose}>
      <div className="cart-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="cart-head">
          <h3><ShoppingCart size={17} /> Your Cart ({items.length})</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        {items.length === 0 ? (
          <div className="cart-empty">Cart is empty. Customize a product to get started.</div>
        ) : (
          <>
            <div className="cart-items">
              {items.map((i) => (
                <div key={i.key} className="cart-item">
                  <span className="cart-item-icon">{i.icon || "📦"}</span>
                  <div className="cart-item-info">
                    <div className="cart-item-name">{i.name}</div>
                    <div className="cart-item-meta">{i.size_label} × {i.qty}</div>
                  </div>
                  <div className="cart-item-right">
                    <div className="cart-item-price">{fmt((i.unit_price || 0) * (i.qty || 1))}</div>
                    <button className="cart-item-remove" onClick={() => onRemove(i.key)}><Trash2 size={13} /></button>
                  </div>
                </div>
              ))}
            </div>
            <div className="cart-foot">
              <div className="cart-subtotal"><span>Subtotal</span><strong>{fmt(subtotal)}</strong></div>
              <button className="cart-quote-btn" onClick={onCheckout}>
                <ShoppingCart size={15} /> Checkout — Pay Securely
              </button>
              <a className="cart-ghost-btn" href="/customize">
                <FileText size={14} /> Request a Quote Instead
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------- Page ----------
export default function ProductsPage() {
  const [openProduct, setOpenProduct] = useState(null);
  const [cat, setCat] = useState("");
  const [use, setUse] = useState("");
  const [print, setPrint] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("popular");
  const [products, setProducts] = useState(FALLBACK_PRODUCTS);
  const [user, setUser] = useState(() => getSessionUser());
  const [cart, setCart] = useState(() => {
    try { return JSON.parse(localStorage.getItem("btl_cart") || "[]"); } catch { return []; }
  });
  const [wishlist, setWishlist] = useState([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "" });
  const [authError, setAuthError] = useState("");
  const [toast, setToast] = useState("");

  // Fetch products from CMS API, fallback to hardcoded
  useEffect(() => {
    fetch("/api/products")
      .then((r) => r.json())
      .then((d) => {
        if (d.products && d.products.length > 0) {
          setProducts(d.products.map(normalizeProduct));
        }
      })
      .catch(() => {}); // keep fallback
  }, []);

  useEffect(() => {
    if (!getToken()) return;
    apiGetWishlist().then((d) => setWishlist(d.wishlist || [])).catch(() => {});
    import("../services/shopClient.js").then(({ getCart }) =>
      getCart().then((d) => { if ((d.cart || []).length > 0) setCart(d.cart); }).catch(() => {})
    );
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const persistLocalCart = (items) => {
    setCart(items);
    if (!user) localStorage.setItem("btl_cart", JSON.stringify(items));
  };

  async function handleAuthSubmit(e) {
    e.preventDefault();
    setAuthError("");
    try {
      const fn = authMode === "login" ? apiLogin : apiRegister;
      const data = authMode === "login"
        ? await fn(authForm.email, authForm.password)
        : await fn(authForm.name, authForm.email, authForm.password);
      setUser(data.user);
      setAuthOpen(false);
      setToast(`Welcome, ${data.user.name.split(" ")[0]}!`);
      if (authMode === "login" && data.user?.is_team) {
        window.location.replace("/admin");
        return;
      }
      if (cart.length > 0) {
        try { const resp = await mergeGuestCart(cart); if (resp.cart) setCart(resp.cart); } catch {}
      }
      apiGetWishlist().then((d) => setWishlist(d.wishlist || [])).catch(() => {});
    } catch (err) { setAuthError(err.message); }
  }

  async function handleLogout() {
    try { await apiLogout(); } catch {}
    setUser(null); setWishlist([]); persistLocalCart([]); setToast("Signed out");
  }

  async function handleWish(p) {
    if (!user) { setAuthOpen(true); setAuthMode("login"); setToast("Sign in to save your wishlist"); return; }
    try {
      const resp = await apiToggleWishlist({ product_id: p.id, name: p.name, base: p.base });
      setWishlist(resp.wishlist);
      setToast(resp.added ? `${p.name} saved to wishlist` : `${p.name} removed from wishlist`);
    } catch (err) { setToast(err.message); }
  }

  const counts = useMemo(() => {
    const c = { cat: {}, use: {}, print: {} };
    products.forEach((p) => {
      c.cat[p.category] = (c.cat[p.category] || 0) + 1;
      c.use[p.use] = (c.use[p.use] || 0) + 1;
      c.print[p.printed] = (c.print[p.printed] || 0) + 1;
    });
    return c;
  }, [products]);

  const CATEGORIES = useMemo(() => [...new Set(products.map((p) => p.category))], [products]);
  const USES = useMemo(() => [...new Set(products.map((p) => p.use))], [products]);
  const PRINTS = useMemo(() => [...new Set(products.map((p) => p.printed))], [products]);

  const filtered = useMemo(() => {
    let list = products.filter((p) =>
      (!cat || p.category === cat) && (!use || p.use === use) && (!print || p.printed === print) &&
      (!search.trim() || p.name.toLowerCase().includes(search.trim().toLowerCase()))
    );
    if (sort === "low") list = [...list].sort((a, b) => a.base - b.base);
    if (sort === "high") list = [...list].sort((a, b) => b.base - a.base);
    if (sort === "popular") list = [...list].sort((a, b) => b.reviews - a.reviews);
    return list;
  }, [products, cat, use, print, search, sort]);

  const flyToCart = useCallback((sourceEl) => {
    const cartTarget = window.__btlNavbarCartRef;
    if (!sourceEl || !cartTarget) return;
    const src = sourceEl.getBoundingClientRect();
    const dst = cartTarget.getBoundingClientRect();
    const ghost = document.createElement("div");
    ghost.className = "btl-fly-ghost";
    ghost.textContent = "🛒";
    ghost.style.left = `${src.left + src.width / 2 - 16}px`;
    ghost.style.top = `${src.top + src.height / 2 - 16}px`;
    document.body.appendChild(ghost);
    void ghost.offsetWidth;
    ghost.classList.add("btl-fly-end");
    ghost.style.left = `${dst.left + dst.width / 2 - 6}px`;
    ghost.style.top = `${dst.top + dst.height / 2 - 6}px`;
    ghost.style.opacity = "0";
    setTimeout(() => ghost.remove(), 600);
  }, []);

  useEffect(() => {
    const handler = () => setCartOpen(true);
    window.addEventListener("btl-open-cart", handler);
    return () => window.removeEventListener("btl-open-cart", handler);
  }, []);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("btl-cart-change", { detail: { count: cart.length } }));
  }, [cart.length]);

  const addToCart = async ({ p, size, qty, addons, total, sourceEl }) => {
    const addonNames = Object.keys(addons);
    const key = `${p.id}|${size.label}|${qty}|${addonNames.sort().join(",")}`;
    const item = { key, product_id: p.id, size_label: size.label, qty, addons: addonNames, unit_price: Math.round(total / qty), name: p.name, icon: p.icon };
    const next = [...cart.filter((i) => i.key !== key), item];
    persistLocalCart(next);
    if (user) { try { await apiAddToCart(item); } catch { setToast("Saved locally — will sync on next visit"); } }
    flyToCart(sourceEl);
    setToast(`${p.name} added to cart`);
    setCartOpen(true);
  };

  const removeFromCart = async (key) => {
    const next = cart.filter((i) => i.key !== key);
    persistLocalCart(next);
    if (user) { try { await apiRemoveFromCart(key); } catch {} }
  };

  const goToCheckout = () => {
    if (!user) { setCartOpen(false); setAuthOpen(true); setAuthMode("login"); setToast("Sign in to checkout"); return; }
    sessionStorage.setItem("btl_shop_checkout", JSON.stringify({ items: cart }));
    window.location.href = "/shop/checkout";
  };

  return (
    <div className="prod-root">
      <style>{PROD_CSS}</style>

      {authOpen && (
        <div className="auth-overlay" onClick={() => setAuthOpen(false)}>
          <form className="auth-modal" onClick={(e) => e.stopPropagation()} onSubmit={handleAuthSubmit}>
            <button type="button" className="auth-close" onClick={() => setAuthOpen(false)}><X size={16} /></button>
            <h3>{authMode === "login" ? "Sign in" : "Create account"}</h3>
            <p className="auth-sub">Your cart & wishlist are saved to your account.</p>
            {authMode === "register" && (
              <input className="auth-input" placeholder="Full name" required value={authForm.name}
                onChange={(e) => setAuthForm({ ...authForm, name: e.target.value })} />
            )}
            <input className="auth-input" type="email" placeholder="Email" required value={authForm.email}
              onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })} />
            <input className="auth-input" type="password" placeholder="Password (min 6 chars)" required minLength={6} value={authForm.password}
              onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })} />
            {authError && <div className="auth-error">{authError}</div>}
            <button className="auth-submit" type="submit">{authMode === "login" ? "Sign In" : "Create Account"}</button>
            <button type="button" className="auth-switch" onClick={() => { setAuthMode(authMode === "login" ? "register" : "login"); setAuthError(""); }}>
              {authMode === "login" ? "New here? Create an account" : "Already have an account? Sign in"}
            </button>
          </form>
        </div>
      )}

      <section className="prod-hero">
        <span className="prod-hero-badge">PRODUCTS & SERVICES</span>
        <h1>Everything print, display & field — <span className="prod-hero-accent">customized</span></h1>
        <p>Order custom-branded materials the same way you plan campaigns. Design proof before print, delivery across India.</p>
      </section>

      {openProduct ? (
        <ProductView p={openProduct} onBack={() => setOpenProduct(null)} onAdd={addToCart}
          wish={wishlist.some((w) => w.product_id === openProduct.id)} onWish={handleWish} />
      ) : (
        <>
          <div className="prod-cats">
            <button className={`prod-cat-chip ${cat === "" ? "prod-cat-active" : ""}`} onClick={() => setCat("")}>All Products</button>
            {CATEGORIES.map((c) => (
              <button key={c} className={`prod-cat-chip ${cat === c ? "prod-cat-active" : ""}`} onClick={() => setCat(c)}>{c}</button>
            ))}
          </div>

          <div className="prod-layout">
            <aside className="prod-filters">
              <div className="pf-head">Shopping Options</div>
              <FilterGroup title="Use" options={USES} counts={counts.use} selected={use} onPick={setUse} />
              <FilterGroup title="Print Type" options={PRINTS} counts={counts.print} selected={print} onPick={setPrint} />
              <div className="pf-group">
                <div className="pf-group-title">Category</div>
                {CATEGORIES.map((c) => (
                  <label key={c} className={`pf-option ${cat === c ? "pf-option-active" : ""}`}>
                    <input type="radio" name="fcat" checked={cat === c} onChange={() => setCat(cat === c ? "" : c)} />
                    <span className="pf-option-label">{c}</span>
                    <span className="pf-option-count">({counts.cat[c]})</span>
                  </label>
                ))}
              </div>
            </aside>

            <div className="prod-main">
              <div className="prod-toolbar">
                <div className="prod-search">
                  <Search size={15} color="#949494" />
                  <input placeholder="Search products…" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <div className="prod-sort">
                  <span>{filtered.length} products</span>
                  <select value={sort} onChange={(e) => setSort(e.target.value)}>
                    <option value="popular">Most Popular</option>
                    <option value="low">Price: Low → High</option>
                    <option value="high">Price: High → Low</option>
                  </select>
                </div>
              </div>

              {filtered.length === 0 ? (
                <div className="prod-empty">No products match those filters.</div>
              ) : (
                <div className="prod-grid">
                  {filtered.map((p) => (
                    <ProductCard key={p.id} p={p} onOpen={setOpenProduct}
                      wish={wishlist.some((w) => w.product_id === p.id)} onWish={handleWish} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {toast && <div className="prod-toast">{toast}</div>}
      {cartOpen && <CartDrawer items={cart} onClose={() => setCartOpen(false)} onRemove={removeFromCart} onCheckout={goToCheckout} />}
    </div>
  );
}

/* ---------------- CSS (BTLbro brand) ---------------- */
const PROD_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@500;700;800&family=Inter:wght@400;500;600;700&family=Zilla+Slab:wght@500;600;700&display=swap');

.auth-overlay { position: fixed; inset: 0; background: rgba(22,22,22,.4); z-index: 4000; display: flex; align-items: center; justify-content: center; padding: 20px; }
.auth-modal { position: relative; background: #fff; border-radius: 18px; padding: 28px; width: 380px; max-width: 100%; display: flex; flex-direction: column; gap: 11px; animation: toastIn .2s ease; }
.auth-modal h3 { margin: 0; font-family: 'Manrope', sans-serif; font-size: 20px; }
.auth-sub { margin: 0 0 4px; font-size: 12.5px; color: #949494; }
.auth-close { position: absolute; top: 14px; right: 14px; border: none; background: none; color: #949494; cursor: pointer; }
.auth-input { border: 1.5px solid #E7E2D8; border-radius: 10px; padding: 11px 14px; font-size: 14px; font-family: inherit; outline: none; width: 100%; box-sizing: border-box; }
.auth-input:focus { border-color: #F2701D; }
.auth-error { font-size: 12.5px; color: #dc2626; font-weight: 600; }
.auth-submit { background: #F2701D; color: #fff; border: none; border-radius: 999px; padding: 13px; font-weight: 700; font-size: 14px; cursor: pointer; }
.auth-submit:hover { background: #D8620F; }
.auth-switch { background: none; border: none; font-size: 12.5px; color: #656565; cursor: pointer; text-decoration: underline; }

.pcard-heart { position: absolute; top: 10px; right: 10px; width: 32px; height: 32px; border-radius: 50%; border: none; background: rgba(255,255,255,.92); display: flex; align-items: center; justify-content: center; color: #949494; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.1); transition: all .15s ease; }
.pcard-heart:hover { color: #F2701D; transform: scale(1.1); }
.pcard-heart-on { color: #F2701D; }
.pv-heart { position: absolute; top: 14px; right: 14px; width: 40px; height: 40px; }
.pcard-thumb { position: relative; }

.prod-root { --orange: #F2701D; --ink: #161616; --sec: #656565; --muted: #949494; --border: #E7E2D8; --bg-warm: #FAF9F7; font-family: 'Inter', sans-serif; color: #161616; background: #fff; padding: 40px 40px 90px; max-width: 1280px; margin: 0 auto; box-sizing: border-box; }
.prod-root * { box-sizing: border-box; }
.prod-root button { font-family: inherit; cursor: pointer; }
.prod-hero { text-align: center; margin-bottom: 30px; }
.prod-hero-badge { display: inline-block; font-family: 'IBM Plex Mono', monospace; font-size: 11.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: #F2701D; background: rgba(242,112,29,.08); padding: 6px 14px; border-radius: 20px; margin-bottom: 12px; }
.prod-hero h1 { font-family: 'Manrope', sans-serif; font-size: 36px; font-weight: 800; letter-spacing: -.03em; margin: 0 0 8px; }
.prod-hero-accent { color: #F2701D; }
.prod-hero p { color: #656565; font-size: 15px; max-width: 560px; margin: 0 auto; line-height: 1.6; }
.prod-cats { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; margin-bottom: 28px; }
.prod-cat-chip { padding: 9px 18px; border: 1.5px solid #E7E2D8; border-radius: 999px; font-size: 13px; font-weight: 600; color: #656565; background: #fff; transition: all .18s ease; }
.prod-cat-chip:hover { border-color: #F2701D; color: #F2701D; }
.prod-cat-active { background: #F2701D; border-color: #F2701D; color: #fff; }
.prod-layout { display: grid; grid-template-columns: 240px 1fr; gap: 28px; align-items: start; }
@media (max-width: 900px) { .prod-layout { grid-template-columns: 1fr; } .prod-filters { display: none; } }
.prod-filters { background: #FAF9F7; border: 1px solid #E7E2D8; border-radius: 14px; padding: 18px; position: sticky; top: 16px; }
.pf-head { font-family: 'Manrope', sans-serif; font-weight: 800; font-size: 15px; margin-bottom: 14px; }
.pf-group { margin-bottom: 18px; }
.pf-group-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: #949494; margin-bottom: 8px; }
.pf-option { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 8px; font-size: 13px; cursor: pointer; }
.pf-option:hover { background: #fff; }
.pf-option input { accent-color: #F2701D; margin: 0; }
.pf-option-label { flex: 1; color: #161616; }
.pf-option-active .pf-option-label { color: #F2701D; font-weight: 600; }
.pf-option-count { color: #949494; font-size: 12px; }
.prod-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 14px; margin-bottom: 18px; flex-wrap: wrap; }
.prod-search { display: flex; align-items: center; gap: 8px; flex: 1; max-width: 320px; border: 1.5px solid #E7E2D8; border-radius: 999px; padding: 9px 16px; background: #FAF9F7; }
.prod-search input { border: none; outline: none; background: none; font-family: inherit; font-size: 13.5px; flex: 1; }
.prod-sort { display: flex; align-items: center; gap: 10px; font-size: 13px; color: #949494; }
.prod-sort select { border: 1.5px solid #E7E2D8; border-radius: 8px; padding: 7px 10px; font-family: inherit; font-size: 13px; background: #fff; }
.prod-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 18px; }
.prod-empty { padding: 60px; text-align: center; color: #949494; border: 1px dashed #E7E2D8; border-radius: 14px; }
.pcard { border: 1px solid #E7E2D8; border-radius: 14px; overflow: hidden; background: #fff; cursor: pointer; transition: all .2s ease; display: flex; flex-direction: column; }
.pcard:hover { box-shadow: 0 10px 26px rgba(0,0,0,.08); transform: translateY(-3px); border-color: #F2C9A8; }
.pcard-thumb { height: 130px; display: flex; align-items: center; justify-content: center; font-size: 52px; background: linear-gradient(135deg, #FFF4EC 0%, #FDE9DA 60%, #F9DCC8 100%); overflow: hidden; }
.pcard-body { padding: 13px 15px 15px; display: flex; flex-direction: column; gap: 5px; flex: 1; }
.pcard-name { font-weight: 700; font-size: 14px; line-height: 1.3; }
.pcard-rating { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 600; color: #161616; }
.pcard-reviews { color: #949494; font-weight: 400; }
.pcard-size { font-size: 12px; color: #656565; }
.pcard-price-row { display: flex; align-items: baseline; gap: 7px; margin-top: 2px; }
.pcard-price-label { font-size: 11px; color: #949494; }
.pcard-price { font-family: 'Manrope', sans-serif; font-weight: 800; font-size: 16px; }
.pcard-cta { margin-top: auto; padding: 9px 0; border-radius: 999px; border: 1.5px solid #F2701D; color: #F2701D; background: none; font-weight: 700; font-size: 12.5px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; transition: all .15s ease; }
.pcard-cta:hover { background: #F2701D; color: #fff; }
.pv-back { display: inline-flex; align-items: center; gap: 6px; border: none; background: none; color: #656565; font-size: 13px; font-weight: 600; padding: 0; margin-bottom: 8px; }
.pv-back:hover { color: #F2701D; }
.pv-crumb { font-size: 12px; color: #949494; margin-bottom: 18px; }
.pv-grid { display: grid; grid-template-columns: 1fr 1.2fr; gap: 32px; align-items: start; }
@media (max-width: 860px) { .pv-grid { grid-template-columns: 1fr; } }
.pv-thumb-wrap { position: sticky; top: 16px; }
.pv-thumb { height: 340px; border-radius: 18px; display: flex; align-items: center; justify-content: center; font-size: 110px; background: linear-gradient(135deg, #FFF4EC 0%, #FDE9DA 60%, #F9DCC8 100%); border: 1px solid #E7E2D8; overflow: hidden; }
.pv-thumb-badges { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
.pv-badge { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; font-weight: 600; color: #656565; border: 1px solid #E7E2D8; border-radius: 999px; padding: 5px 11px; background: #FAF9F7; }
.pv-name { font-family: 'Manrope', sans-serif; font-size: 26px; font-weight: 800; letter-spacing: -.02em; margin: 0 0 6px; }
.pv-rating { margin-bottom: 10px; }
.pv-desc { color: #656565; font-size: 14px; line-height: 1.65; margin: 0 0 18px; }
.pv-opt-title { font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: #949494; margin: 16px 0 8px; }
.pv-sizes { display: flex; gap: 8px; flex-wrap: wrap; }
.pv-size { padding: 9px 16px; border: 1.5px solid #E7E2D8; border-radius: 10px; background: #fff; font-size: 13px; font-weight: 600; color: #656565; transition: all .15s ease; }
.pv-size:hover { border-color: #F2701D; }
.pv-size-active { background: #F2701D; border-color: #F2701D; color: #fff; }
.pv-addons { display: flex; flex-direction: column; gap: 7px; }
.pv-addon { display: flex; align-items: center; gap: 9px; border: 1.5px solid #E7E2D8; border-radius: 10px; padding: 9px 13px; font-size: 13px; cursor: pointer; transition: all .15s ease; }
.pv-addon input { accent-color: #F2701D; margin: 0; }
.pv-addon-active { border-color: #F2701D; background: #FFF8F3; }
.pv-addon-price { margin-left: auto; font-weight: 600; color: #F2701D; }
.pv-qty-row { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
.pv-qty { display: inline-flex; align-items: center; border: 1.5px solid #E7E2D8; border-radius: 999px; overflow: hidden; }
.pv-qty button { width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border: none; background: #FAF9F7; color: #161616; }
.pv-qty button:hover { background: #F0EBE3; }
.pv-qty span { width: 44px; text-align: center; font-weight: 700; }
.pv-price-box { display: flex; flex-direction: column; }
.pv-price { font-family: 'Manrope', sans-serif; font-weight: 800; font-size: 26px; }
.pv-cta-row { margin-top: 18px; }
.pv-add { width: 100%; padding: 14px; border-radius: 999px; border: none; background: #F2701D; color: #fff; font-weight: 700; font-size: 15px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; transition: background .15s ease; }
.pv-add:hover { background: #D8620F; }
.pv-trust { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 14px; font-size: 12px; color: #656565; }
.pv-trust span { display: inline-flex; align-items: center; gap: 5px; }
.pv-faq { margin-top: 40px; border-top: 1px solid #E7E2D8; }
.pv-faq-item { border-bottom: 1px solid #E7E2D8; }
.pv-faq-q { width: 100%; display: flex; justify-content: space-between; align-items: center; padding: 15px 4px; border: none; background: none; font-size: 14px; font-weight: 600; text-align: left; }
.pv-faq-a { padding: 0 4px 15px; color: #656565; font-size: 13.5px; line-height: 1.6; }
.cart-overlay { position: fixed; inset: 0; background: rgba(22,22,22,.35); z-index: 3000; display: flex; justify-content: flex-end; }
.cart-drawer { width: 380px; max-width: 92vw; background: #fff; height: 100%; display: flex; flex-direction: column; animation: cartIn .25s ease; }
@keyframes cartIn { from { transform: translateX(30px); opacity: 0; } to { transform: none; opacity: 1; } }
.cart-head { display: flex; justify-content: space-between; align-items: center; padding: 18px 20px; border-bottom: 1px solid #E7E2D8; }
.cart-head h3 { margin: 0; font-family: 'Manrope', sans-serif; font-size: 16px; display: flex; align-items: center; gap: 8px; }
.cart-head button { border: none; background: none; }
.cart-empty { padding: 48px 24px; text-align: center; color: #949494; font-size: 13.5px; }
.cart-items { flex: 1; overflow-y: auto; padding: 12px 20px; }
.cart-item { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid #F0EDE8; }
.cart-item-icon { font-size: 26px; }
.cart-item-info { flex: 1; }
.cart-item-name { font-weight: 600; font-size: 13.5px; }
.cart-item-meta { font-size: 11.5px; color: #949494; margin-top: 2px; }
.cart-item-right { text-align: right; }
.cart-item-price { font-weight: 700; font-size: 13.5px; }
.cart-item-remove { border: none; background: none; color: #949494; margin-top: 3px; }
.cart-item-remove:hover { color: #dc2626; }
.cart-foot { border-top: 1px solid #E7E2D8; padding: 16px 20px 20px; }
.cart-subtotal { display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 12px; }
.cart-quote-btn { display: flex; justify-content: center; align-items: center; gap: 8px; background: #F2701D; color: #fff; padding: 13px; border-radius: 999px; font-weight: 700; font-size: 14px; text-decoration: none; border: none; cursor: pointer; font-family: inherit; }
.cart-quote-btn:hover { background: #D8620F; }
.cart-ghost-btn { display: flex; justify-content: center; align-items: center; gap: 6px; background: none; border: none; color: #656565; font-weight: 600; font-size: 12.5px; text-decoration: none; cursor: pointer; padding: 4px 0; font-family: inherit; }
.cart-ghost-btn:hover { color: #F2701D; }
.cart-note { font-size: 11.5px; color: #949494; text-align: center; margin-top: 6px; }
.prod-toast { position: fixed; top: 80px; left: 50%; transform: translateX(-50%); z-index: 3500; background: #161616; color: #fff; font-size: 13px; font-weight: 600; padding: 10px 18px; border-radius: 999px; box-shadow: 0 8px 22px rgba(0,0,0,.2); animation: toastIn .2s ease; }
@keyframes toastIn { from { opacity: 0; transform: translate(-50%, -6px); } to { opacity: 1; transform: translate(-50%, 0); } }
@media (max-width: 640px) { .prod-root { padding: 28px 18px 90px; } .prod-hero h1 { font-size: 26px; } }
`;
