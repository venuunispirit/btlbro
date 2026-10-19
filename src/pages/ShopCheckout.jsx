import React, { useState } from "react";
import { ArrowLeft, ShieldCheck, Truck, FileText, CreditCard, MapPin, User } from "lucide-react";
import { getUser, checkout, verifyPayment } from "../services/shopClient.js";

/* ============================================================
   BTLbro — Shop Checkout
   Steps: 1) Sign in (required)  2) Address & notes  3) Payment
   Payment: Razorpay (UPI/cards/netbanking) when keys are set on the
   server; otherwise "Pay on Confirmation" fallback. A "Request Quote
   Instead" path hands the cart to the /customize form.
   Cart comes from sessionStorage `btl_shop_checkout` (written by ProductsPage).
   ============================================================ */

const fmt = (n) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;

function loadCheckoutData() {
  try { return JSON.parse(sessionStorage.getItem("btl_shop_checkout") || "null"); } catch { return null; }
}

export default function ShopCheckout() {
  const [data] = useState(loadCheckoutData);
  const [step, setStep] = useState(1);
  const [auth, setAuth] = useState({ name: "", email: "", password: "" });
  const [authError, setAuthError] = useState("");
  const [address, setAddress] = useState({ line1: "", city: "", pincode: "", phone: "", notes: "" });
  const [placing, setPlacing] = useState(false);
  const [done, setDone] = useState(null); // {mode:'paid'|'confirmation'|'quote', ...}

  // ---------- No cart data → empty state ----------
  if (!data || !data.items || data.items.length === 0) {
    return (
      <div style={styles.page}>
        <Header step={0} />
        <div style={styles.empty}>
          <p>Your cart is empty.</p>
          <a href="/products" style={styles.primaryBtn}>Browse Products</a>
        </div>
      </div>
    );
  }

  const user = getUser();
  const subtotal = data.items.reduce((s, i) => s + i.unit_price * i.qty, 0);
  const gst = Math.round(subtotal * 0.18);
  const total = subtotal + gst;

  // ---------- Step 1: sign in / register ----------
  async function handleAuth(e) {
    e.preventDefault();
    setAuthError("");
    setPlacing(true);
    try {
      const { login, register, mergeGuestCart } = await import("../services/shopClient.js");
      let session;
      try {
        session = await login(auth.email, auth.password);
      } catch {
        session = await register(auth.name || auth.email.split("@")[0], auth.email, auth.password);
      }
      // Merge the guest cart that came here from ProductsPage
      await mergeGuestCart(data.items.map((i) => ({
        key: i.key, product_id: i.product_id, size_label: i.size_label,
        qty: i.qty, addons: i.addons, unit_price: i.unit_price, name: i.name,
      })));
      setStep(2);
    } catch (err) {
      setAuthError(err.message);
    }
    setPlacing(false);
  }

  // ---------- Step 2 → 3 ----------
  function handleAddress(e) {
    e.preventDefault();
    if (!address.line1 || !address.city || !/^[1-9][0-9]{5}$/.test(address.pincode) || !/^[0-9]{10}$/.test(address.phone)) {
      alert("Please fill address, city, a valid 6-digit PIN code and 10-digit phone.");
      return;
    }
    setStep(3);
  }

  // ---------- Step 3: pay ----------
  async function loadRazorpay() {
    if (window.Razorpay) return true;
    return new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = "https://checkout.razorpay.com/v1/checkout.js";
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      document.body.appendChild(s);
    });
  }

  async function handlePay(mode) {
    setPlacing(true);
    try {
      const session = getUser();
      const payload = {
        items: data.items,
        address,
        notes: data.quoteNote || "",
      };

      if (mode === "quote") {
        // Hand off to the customize form with the cart summary
        const summary = data.items
          .map((i) => `${i.name} (${i.size_label} × ${i.qty}${i.addons?.length ? `, add-ons: ${i.addons.join(", ")}` : ""}) — ${fmt(i.unit_price * i.qty)}`)
          .join("\n");
        sessionStorage.setItem("btl_quote_prefill", `Product order request:\n${summary}\n\nTotal (incl. 18% GST): ${fmt(total)}\nDelivery: ${address.line1}, ${address.city} - ${address.pincode}`);
        sessionStorage.removeItem("btl_shop_checkout");
        window.location.href = "/customize";
        return;
      }

      const result = await checkout(payload);

      if (result.gateway === "razorpay") {
        const ok = await loadRazorpay();
        if (!ok || !result.razorpay_order_id) {
          // Razorpay script failed or order id not ready — fall back gracefully
          setDone({ mode: "confirmation", orderId: result.order_id, total });
          setPlacing(false);
          return;
        }
        const rzp = new window.Razorpay({
          key: result.key_id,
          amount: result.amount,
          currency: result.currency,
          name: "BTLbro",
          description: `Order #${result.order_id}`,
          prefill: { name: session?.name, email: session?.email, contact: address.phone },
          theme: { color: "#F2701D" },
          handler: async (resp) => {
            try {
              await verifyPayment({ ...resp, btl_order_id: result.order_id });
              sessionStorage.removeItem("btl_shop_checkout");
              setDone({ mode: "paid", orderId: result.order_id, total, paymentId: resp.razorpay_payment_id });
            } catch {
              setDone({ mode: "confirmation", orderId: result.order_id, total });
            }
            setPlacing(false);
          },
          modal: { ondismiss: () => setPlacing(false) },
        });
        rzp.open();
        return;
      }

      // pay_on_confirmation fallback
      sessionStorage.removeItem("btl_shop_checkout");
      setDone({ mode: "confirmation", orderId: result.order_id, total });
      setPlacing(false);
    } catch (err) {
      alert(err.message || "Checkout failed");
      setPlacing(false);
    }
  }

  return (
    <div style={styles.page}>
      <Header step={done ? 3 : step} />

      {done ? (
        <div style={styles.card}>
          <div style={{ fontSize: 44, marginBottom: 8 }}>
            {done.mode === "paid" ? "✅" : "📦"}
          </div>
          <h2 style={styles.doneTitle}>
            {done.mode === "paid" ? "Payment successful!" : "Order placed!"}
          </h2>
          <p style={styles.doneText}>
            {done.mode === "paid"
              ? <>Order <strong>#{done.orderId}</strong> is confirmed and paid ({fmt(done.total)}). Receipt sent to your email.</>
              : <>Order <strong>#{done.orderId}</strong> ({fmt(done.total)}) is saved. Our team will call you within 24 hours to confirm and collect payment.</>}
          </p>
          <a href="/products" style={styles.primaryBtn}>Continue Shopping</a>
        </div>
      ) : (
        <div className="btl-container btl-two-col" style={styles.twoCol}>
          {/* LEFT: step content */}
          <div style={styles.left}>
            {step === 1 && (
              <form style={styles.card} onSubmit={handleAuth}>
                <h3 style={styles.cardTitle}><User size={16} /> Account</h3>
                <p style={styles.hint}>Sign in or create a free account — your cart and wishlist are saved to it.</p>
                {!auth.email && (
                  <input style={styles.input} placeholder="Full name" value={auth.name}
                    onChange={(e) => setAuth({ ...auth, name: e.target.value })} />
                )}
                <input style={styles.input} type="email" placeholder="Email" required value={auth.email}
                  onChange={(e) => setAuth({ ...auth, email: e.target.value })} />
                <input style={styles.input} type="password" placeholder="Password (min 6 chars)" required minLength={6}
                  value={auth.password} onChange={(e) => setAuth({ ...auth, password: e.target.value })} />
                {authError && <div style={styles.error}>{authError}</div>}
                <button style={styles.primaryBtn} disabled={placing} type="submit">
                  {placing ? "Please wait…" : "Continue →"}
                </button>
              </form>
            )}

            {step === 2 && (
              <form style={styles.card} onSubmit={handleAddress}>
                <h3 style={styles.cardTitle}><MapPin size={16} /> Delivery Address</h3>
                <input style={styles.input} placeholder="Address line" required value={address.line1}
                  onChange={(e) => setAddress({ ...address, line1: e.target.value })} />
                <div className="btl-form-grid">
                  <input style={styles.input} placeholder="City" required value={address.city}
                    onChange={(e) => setAddress({ ...address, city: e.target.value })} />
                  <input style={styles.input} placeholder="PIN code" required value={address.pincode}
                    onChange={(e) => setAddress({ ...address, pincode: e.target.value })} />
                </div>
                <input style={styles.input} placeholder="Phone (10 digits)" required value={address.phone}
                  onChange={(e) => setAddress({ ...address, phone: e.target.value })} />
                <button style={styles.primaryBtn} type="submit">Continue to Payment →</button>
              </form>
            )}

            {step === 3 && (
              <div style={styles.card}>
                <h3 style={styles.cardTitle}><CreditCard size={16} /> Payment</h3>
                <button style={styles.primaryBtn} disabled={placing} onClick={() => handlePay("pay")}>
                  {placing ? "Opening…" : `Pay ${fmt(total)} — UPI / Card / NetBanking`}
                </button>
                <button style={styles.secondaryBtn} disabled={placing} onClick={() => handlePay("confirmation")}>
                  📞 Pay on Confirmation (talk to us first)
                </button>
                <button style={styles.ghostBtn} disabled={placing} onClick={() => handlePay("quote")}>
                  <FileText size={14} /> Request a Formal Quote Instead
                </button>
                <p style={styles.hint}>
                  Payments secured by Razorpay. "Pay on Confirmation" saves your order — we call you within 24h.
                </p>
              </div>
            )}
          </div>

          {/* RIGHT: order summary */}
          <div style={styles.right}>
            <div style={styles.summary}>
              <h3 style={styles.cardTitle}>Order Summary</h3>
              {data.items.map((i) => (
                <div key={i.key} style={styles.summaryItem}>
                  <span>{i.icon || "🛒"} {i.name} <em style={styles.summaryMeta}>({i.size_label} × {i.qty})</em></span>
                  <strong>{fmt(i.unit_price * i.qty)}</strong>
                </div>
              ))}
              <div style={styles.summaryLine}><span>Subtotal</span><span>{fmt(subtotal)}</span></div>
              <div style={styles.summaryLine}><span>GST (18%)</span><span>{fmt(gst)}</span></div>
              <div style={{ ...styles.summaryLine, borderTop: "1px solid #E7E2D8", paddingTop: 8, fontSize: 15 }}>
                <span><strong>Total</strong></span><span><strong>{fmt(total)}</strong></span>
              </div>
              <div style={styles.trustRow}><Truck size={13} /> Delivery 5–7 days</div>
              <div style={styles.trustRow}><ShieldCheck size={13} /> Design proof before print</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Header({ step }) {
  const steps = ["Account", "Address", "Payment"];
  return (
    <header className="btl-page-header" style={styles.header}>
      <div className="btl-header-inner" style={styles.headerInner}>
        <a href="/products" style={styles.back}><ArrowLeft size={15} /> Products</a>
        <div className="btl-stepper" style={styles.steps}>
          {steps.map((s, i) => (
            <div key={s} className="btl-step" style={{ display: "flex", alignItems: "center", gap: 6, opacity: step >= i + 1 ? 1 : 0.4 }}>
              <span style={{ ...styles.stepDot, background: step > i + 1 || (step > i && i === 2) ? "#16a34a" : step >= i + 1 ? "#F2701D" : "#E7E2D8", color: step >= i + 1 ? "#fff" : "#656565" }}>
                {step > i + 1 ? "✓" : i + 1}
              </span>
              <span className="btl-step-label" style={{ fontSize: 12.5, fontWeight: 600 }}>{s}</span>
            </div>
          ))}
        </div>
        <div className="btl-step-spacer" />
      </div>
    </header>
  );
}

const styles = {
  page: { minHeight: "100vh", background: "#FAF9F7", fontFamily: "'Inter', sans-serif", color: "#161616" },
  header: { background: "#fff", borderBottom: "1px solid #E7E2D8", padding: "14px 0" },
  headerInner: { maxWidth: 1080, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 },
  back: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13.5, fontWeight: 600, color: "#656565", textDecoration: "none", width: 80, flexShrink: 0 },
  steps: { display: "flex", gap: 18, minWidth: 0 },
  stepDot: { width: 24, height: 24, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11.5, fontWeight: 700, flexShrink: 0 },
  twoCol: { maxWidth: 1080, margin: "32px auto", display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 24, alignItems: "start" },
  left: { display: "flex", flexDirection: "column", gap: 16 },
  card: { background: "#fff", border: "1px solid #E7E2D8", borderRadius: 16, padding: 24, display: "flex", flexDirection: "column", gap: 12 },
  cardTitle: { margin: 0, fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 },
  hint: { fontSize: 12.5, color: "#949494", margin: 0, lineHeight: 1.5 },
  error: { fontSize: 12.5, color: "#dc2626", fontWeight: 600 },
  row: { display: "flex", gap: 10 },
  input: { border: "1.5px solid #E7E2D8", borderRadius: 10, padding: "11px 14px", fontSize: 14, fontFamily: "inherit", outline: "none", width: "100%", boxSizing: "border-box" },
  primaryBtn: { background: "#F2701D", color: "#fff", border: "none", borderRadius: 999, padding: "13px 20px", fontWeight: 700, fontSize: 14, cursor: "pointer", textAlign: "center", textDecoration: "none", display: "inline-block" },
  secondaryBtn: { background: "#FAF9F7", color: "#161616", border: "1.5px solid #E7E2D8", borderRadius: 999, padding: "12px 20px", fontWeight: 600, fontSize: 13.5, cursor: "pointer" },
  ghostBtn: { background: "none", border: "none", color: "#F2701D", fontWeight: 700, fontSize: 13.5, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 0" },
  right: { position: "sticky", top: 20 },
  summary: { background: "#fff", border: "1px solid #E7E2D8", borderRadius: 16, padding: 22, display: "flex", flexDirection: "column", gap: 10 },
  summaryItem: { display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13 },
  summaryMeta: { color: "#949494", fontStyle: "normal", fontSize: 11.5 },
  summaryLine: { display: "flex", justifyContent: "space-between", fontSize: 13.5, color: "#656565" },
  trustRow: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#656565" },
  empty: { maxWidth: 480, margin: "80px auto", textAlign: "center", display: "flex", flexDirection: "column", gap: 16 },
  doneTitle: { margin: "0 0 6px", fontFamily: "'Manrope', sans-serif", fontSize: 22 },
  doneText: { color: "#656565", fontSize: 14, lineHeight: 1.6, margin: "0 0 16px" },
};
