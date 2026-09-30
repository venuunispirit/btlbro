import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  MapPin,
  Target,
  CreditCard,
  CheckCircle,
  ArrowRight,
  ArrowLeft,
  Download,
  User,
  Phone,
  Mail,
  Building2,
  Cloud,
  RefreshCw,
} from "lucide-react";

const DRIVE_API = "/api/admin/google-drive";

// "cup branding" → "Cup Branding"
function prettyService(svc) {
  return String(svc || "").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Robust price parse — handles numbers, "10000", and "₹10,000" strings
function toNum(v) {
  const n = parseFloat(String(v ?? "").replace(/[₹,\s]/g, ""));
  return Number.isNaN(n) ? 0 : n;
}

// A location's catchment services with REAL sheet prices:
// [{ key: "notice board", label: "Notice Board", price: 3000 }, …]
// New multi-tab sheets store a `services` map; older sheets keep five flat
// promo columns — both are normalized here.
/**
 * Render a UPI intent as a data-URL QR. Returns "" until the image is ready so
 * the caller can show a placeholder instead of a broken <img>.
 */
function useQrDataUrl(uri) {
  const [dataUrl, setDataUrl] = useState("");
  useEffect(() => {
    let cancelled = false;
    if (!uri) {
      setDataUrl("");
      return undefined;
    }
    import("qrcode")
      .then((mod) => (mod.default || mod).toDataURL(uri, { width: 320, margin: 2 }))
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl("");
      });
    return () => { cancelled = true; };
  }, [uri]);
  return dataUrl;
}

function servicesOf(loc) {
  const out = [];
  if (loc && loc.services && typeof loc.services === "object") {
    Object.entries(loc.services).forEach(([k, v]) => {
      const key = String(k).toLowerCase().trim();
      if (key) out.push({ key, label: prettyService(key), price: toNum(v) });
    });
    return out;
  }
  const legacy = {
    "digital promotion": toNum(loc?.digital_promotion),
    "lift promotion": toNum(loc?.lift_promotion),
    "stall space": toNum(loc?.stall_space),
    "digital screen": toNum(loc?.digital_screen),
    "notice board": toNum(loc?.notice_board),
  };
  Object.entries(legacy).forEach(([k, v]) => out.push({ key: k, label: prettyService(k), price: v }));
  return out;
}

const QuickCheckout = () => {
  const params = new URLSearchParams(window.location.search);
  const locationCountParam = parseInt(params.get("count")) || 0;
  const categoriesParam = params.get("categories") || params.get("category") || "Apartments";
  const categoryList = categoriesParam.split(",");
  const category = categoryList.join(", ");

  // Checkout handoff data from the MarketingTool selection (sessionStorage —
  // temporary, auto-deleted when the tab closes; never persistent data)
  const [localCheckoutData] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem("btl_checkout_data") || "[]");
    } catch { return []; }
  });
  const [pincode] = useState(() => sessionStorage.getItem("btl_checkout_pincode") || "");
  // findDriveRecord retained for name-based fallback lookups (not pricing)

  // Admin pricing settings from the server DB
  const [settings, setSettings] = useState({ per_location_price: 0, agency_fee: 10, min_booking: 999 });
  const [razorpayConfig, setRazorpayConfig] = useState({ enabled: false, key_id: '' });
  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => {
        if (d.settings) {
          setSettings({
            per_location_price: typeof d.settings.per_location_price === 'number' ? d.settings.per_location_price : 0,
            agency_fee: typeof d.settings.agency_fee === 'number' ? d.settings.agency_fee : 10,
            // Booking amount is admin-controlled (Settings → Payment Gateway).
            // Server re-derives it when charging, so this only drives the quote.
            min_booking: typeof d.settings.payment?.min_booking === 'number' ? d.settings.payment.min_booking : 999,
          });
        }
      })
      .catch(() => {});
    fetch('/api/payments/config')
      .then((r) => r.json())
      .then((d) => { if (d) setRazorpayConfig(d); })
      .catch(() => {});
  }, []);

  // Drive-synced data fallback
  const [driveRecords, setDriveRecords] = useState([]);
  const [driveLoading, setDriveLoading] = useState(false);
  const [dataSource, setDataSource] = useState("local");

  // Promotion selections per location (in-memory only, not persisted).
  // Service ticks carried over from the MarketingTool table are applied here,
  // so checkout starts with exactly what the user picked (priced services are
  // pre-selected; anything unticked there starts unticked here).
  const [locPromoSelections, setLocPromoSelections] = useState(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem("btl_checkout_data") || "[]");
      const init = {};
      saved.forEach((loc) => {
        const id = loc.id != null ? loc.id : loc.name;
        if (id != null && loc.serviceSelections && typeof loc.serviceSelections === "object") {
          init[id] = { ...loc.serviceSelections };
        }
      });
      return init;
    } catch { return {}; }
  });

  // If user came from MarketingTool with selections, show ONLY those exact apartments.
  // Stale junk selections (stray sheet rows saved as "Record 18") are dropped.
  const cleanedLocalData = localCheckoutData.filter(
    (l) => String(l.fullName || l.name || '').trim() && !/^Record \d+$/i.test(String(l.name || ''))
  );
  const hasSelections = cleanedLocalData.length > 0;
  const checkoutData = hasSelections ? cleanedLocalData : driveRecords;
  const locationCount = locationCountParam || checkoutData.length;

  // Toggle a promotion for a specific location
  function togglePromo(locId, promoKey) {
    setLocPromoSelections(prev => {
      const current = prev[locId] || {};
      return { ...prev, [locId]: { ...current, [promoKey]: !current[promoKey] } };
    });
  }

  // Fetch Drive data from API as fresh source
  const fetchDriveData = useCallback(async () => {
    setDriveLoading(true);
    try {
      const filesRes = await fetch(`${DRIVE_API}/files`);
      const filesData = await filesRes.json();
      const allRecords = [];
      for (const file of (filesData.files || [])) {
        if (file.records_count > 0) {
          try {
            const dataRes = await fetch(`${DRIVE_API}/data/${file.id}?limit=1000`);
            const dataResult = await dataRes.json();
            for (const record of (dataResult.records || [])) {
              const d = record.data || record;
              // Skip junk rows from the sheet (empty name / stray rows)
              if (!String(d.name ?? '').trim()) continue;
              allRecords.push({
                id: record.id,
                name: d.name || "",
                fullName: d.name || "",
                type: d.type || file.file_type || "Unknown",
                lat: parseFloat(d.lat) || 0,
                lng: parseFloat(d.lng) || 0,
                address: d.address || "",
                zone: d.zone || "",
                city: d.city || "",
                promotions: {},
                // Dynamic catchment services from the sheet tab: { "notice board": 3000, … }
                services: d.services && typeof d.services === "object" ? d.services : null,
                // Legacy flat promo columns (older single-tab sheets)
                digital_promotion: toNum(d.digital_promotion),
                lift_promotion: toNum(d.lift_promotion),
                stall_space: toNum(d.stall_space),
                digital_screen: toNum(d.digital_screen),
                notice_board: toNum(d.notice_board),
              });
            }
          } catch (e) { /* skip file */ }
        }
      }
      setDriveRecords(allRecords);

      // Switch to Drive mode when no local data
      if (localCheckoutData.length === 0 && allRecords.length > 0) {
        setDataSource("drive");
        // Do NOT auto-select — let user pick only what they need
      }
    } catch (err) { /* API not available */ }
    setDriveLoading(false);
  }, [localCheckoutData.length]);

  useEffect(() => {
    fetchDriveData();
  }, [fetchDriveData]);

  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    business: "",
  });
  const [paymentMethod, setPaymentMethod] = useState("upi");
  const [duration, setDuration] = useState(1);
  const [isProcessing, setIsProcessing] = useState(false);
  // Live collection request once /api/checkout/pay has answered.
  const [session, setSession] = useState(null); // { leadId, amount, reference, intentUri, payu, status }
  const [checkoutError, setCheckoutError] = useState("");
  const pollTimer = useRef(null);
  const qrDataUrl = useQrDataUrl(session?.intentUri || "");

  // Load Razorpay checkout script (lightweight, no-op if unused)
  useEffect(() => {
    if (!document.getElementById('razorpay-script')) {
      const script = document.createElement('script');
      script.id = 'razorpay-script';
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.async = true;
      document.body.appendChild(script);
    }
  }, []);

  // When using Drive data with real sheet prices, no extra per-location cost
  // Drive mode: only when user explicitly clicked "Use Latest Drive Data"
  // When coming from MarketingTool: show only selected apartments with real prices
  const dataSourceIsDrive = dataSource === 'drive' && !hasSelections;

  // Find matching Drive record — by id first (exact), then by name
  function findDriveRecord(loc) {
    return findDriveRecordSync(loc, driveRecords);
  }

  // Find matching Drive record: exact id match first, then name match
  function findDriveRecordSync(loc, records) {
    if (!loc || !records || !records.length) return null;
    if (loc.id != null) {
      const byId = records.find((r) => r.id === loc.id);
      if (byId) return byId;
    }
    const n = String(loc.name || loc.fullName || '').toLowerCase().trim();
    if (!n) return null;
    return records.find((r) => {
      const rn = (r.name || '').toLowerCase().trim();
      return rn === n || n.includes(rn) || rn.includes(n);
    });
  }

  // Base per-location fee: only what the admin explicitly set — no hidden default
  const perLocationSetting = settings.per_location_price;
  // Selections priced from the sheet don't pay a separate base location fee
  const selectionHasSheetPrices = checkoutData.some((loc) => servicesOf(loc).some((s) => s.price > 0));
  const perLocation = dataSourceIsDrive || selectionHasSheetPrices ? 0 : perLocationSetting;
  const locationCost = perLocation * locationCount * duration;

  let promoCost = 0;
  const promoBreakdown = {};
  const locationPrices = []; // per-location breakdown

  // Build union of ALL service keys across every selected location so every
  // location shows the same service columns — missing / zero-priced ones → "-"
  const allServiceKeys = [];
  const seenServiceKeys = new Set();
  checkoutData.forEach((loc) => {
    servicesOf(loc).forEach((svc) => {
      if (!seenServiceKeys.has(svc.key)) {
        seenServiceKeys.add(svc.key);
        allServiceKeys.push({ key: svc.key, label: svc.label });
      }
    });
  });

  checkoutData.forEach((loc) => {
    const locId = loc.id || loc.name;
    const selections = locPromoSelections[locId] || {};
    const locPromos = [];

    // Build a price map for this location's own services
    const locServiceMap = {};
    servicesOf(loc).forEach((svc) => { locServiceMap[svc.key] = svc.price; });

    // Iterate over UNION of all service keys so every location shows all columns
    allServiceKeys.forEach(({ key, label }) => {
      const price = locServiceMap[key] ?? 0;
      if (price <= 0) {
        // Service exists but has no price (or not in this location) → show "-"
        locPromos.push({ key, label, price: 0, totalPrice: 0, selected: false, unavailable: true });
        return;
      }
      const totalPrice = price * duration;
      const selected = selections[key] === true; // unchecked by default, user must explicitly select
      locPromos.push({ key, label, price, totalPrice, selected });
      if (selected) {
        promoCost += totalPrice;
        if (!promoBreakdown[key]) promoBreakdown[key] = { count: 0, price, total: 0, label };
        promoBreakdown[key].count += 1;
        promoBreakdown[key].total += totalPrice;
      }
    });
    locationPrices.push({ name: loc.name || loc.fullName, promos: locPromos, hasSheetPrices: locPromos.length > 0 });
  });

  const agencyFeePercent = settings.agency_fee;
  const setupFee = Math.round((locationCost + promoCost) * agencyFeePercent / 100);

  const subtotal = locationCost + promoCost + setupFee;
  const gst = Math.round(subtotal * 0.18);
  const total = subtotal + gst;
  // Flat booking/token amount to confirm the campaign. Admin-controlled via
  // Settings → Payment Gateway → Booking Amount; falls back to ₹999 if
  // settings haven't loaded. The server re-derives this when charging.
  const advancePayment = settings.min_booking > 0 ? settings.min_booking : 999;

  function handleChange(e) {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  }

  function handleProceed(e) {
    e.preventDefault();
    if (!formData.name || !formData.email || !formData.phone) {
      alert("Please fill all fields");
      return;
    }
    setStep(2);
  }

  function handlePay() {
    setIsProcessing(true);

    const payAmount = advancePayment;   // booking only — the balance is collected later

    // If Razorpay is enabled, open the real Razorpay checkout
    if (razorpayConfig.enabled && razorpayConfig.key_id) {
      fetch('/api/payments/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: payAmount, currency: 'INR' }),
      })
        .then(r => r.json())
        .then(orderData => {
          if (orderData.error) throw new Error(orderData.error);

          const rzp = new window.Razorpay({
            key: razorpayConfig.key_id,
            amount: orderData.amount,
            currency: orderData.currency,
            name: 'BTLbro',
            description: `Campaign Booking — ₹${payAmount}`,
            order_id: orderData.order_id,
            handler: function (response) {
              // Payment successful — verify and create lead
              fetch('/api/payments/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(response),
              })
                .then(r => r.json())
                .then(() => finishWithRazorpay(response.razorpay_payment_id))
                .catch(() => finishWithRazorpay(response.razorpay_payment_id));
            },
            prefill: { name: formData.name, email: formData.email, contact: formData.phone },
            theme: { color: '#F2701D' },
          });
          rzp.open();
          setIsProcessing(false);
        })
        .catch(() => {
          setIsProcessing(false);
          setCheckoutError("We couldn't start the payment. Please try again.");
        });
      return;
    }

    // UPI rail: one call records the lead AND builds a fixed-amount request.
    // The server recomputes the amount from admin settings, so the figure we
    // showed the customer can never disagree with the one actually charged.
    setCheckoutError("");
    fetch('/api/checkout/pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildLeadPayload()),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) throw new Error(d?.error || 'Payment could not be started');
        setSession({
          leadId: d.lead_id,
          amount: d.amount,
          reference: d.reference,
          intentUri: d.intent_uri,
          payu: d.payu,
          status: 'awaiting',
        });
        if (d.payment_error) {
          setCheckoutError(d.payment_error);
        }
        setIsProcessing(false);
        if (d.intent_uri) startPolling(d.reference);
        else setStep(3);
      })
      .catch((err) => {
        setIsProcessing(false);
        setCheckoutError(err.message || 'Payment could not be started. Please try again.');
      });
  }

  // Watch a reference until the gateway (or a manager) confirms it. Polling
  // stops on success, on failure, and after a hard ceiling so a dead rail
  // can't leave the customer on a spinner forever.
  function startPolling(reference) {
    if (pollTimer.current) clearInterval(pollTimer.current);
    let attempts = 0;
    pollTimer.current = setInterval(() => {
      attempts += 1;
      fetch(`/api/checkout/status/${encodeURIComponent(reference)}`)
        .then((r) => r.json())
        .then((d) => {
          if (d.status && d.status !== 'awaiting' && d.status !== 'processing') {
            if (pollTimer.current) clearInterval(pollTimer.current);
            setSession((s) => ({ ...s, status: d.status }));
            if (d.status === 'paid') setStep(3);
          }
        })
        .catch(() => {});
      if (attempts > 90) {
        if (pollTimer.current) clearInterval(pollTimer.current);
      }
    }, 5000);
  }

  useEffect(() => () => {
    if (pollTimer.current) clearInterval(pollTimer.current);
  }, []);

  function buildLeadPayload() {
    return {
      businessName: formData.business,
      contactName: formData.name,
      email: formData.email,
      phone: formData.phone,
      category,
      locations: locationCount.toString(),
      radius: "5",
      pincode: pincode || "N/A",
      zone: "",
      duration: `${duration} month${duration > 1 ? 's' : ''}`,
      startDate: "",
      message: "",
      budget: "",
      selectedLocations: checkoutData.map((loc) => {
        const locId = loc.id || loc.name;
        const selections = locPromoSelections[locId] || {};
        const selectedPromos = {};
        servicesOf(loc).forEach((svc) => {
          if (svc.price > 0 && selections[svc.key] !== false) {
            selectedPromos[svc.label] = svc.price;
          }
        });
        const prices = {};
        servicesOf(loc).forEach((svc) => { prices[svc.label] = svc.price; });
        return { name: loc.fullName || loc.name, type: loc.type, lat: loc.lat, lng: loc.lng, promotions: selectedPromos, prices, source: loc.source === 'from google' ? 'from google' : 'inhouse' };
      }),
      invoice: { locationCost, promoCost, agencyFee: setupFee, agencyFeePercent, gst, total, perLocation, promoBreakdown },
      // Which services were picked on which location. The server prices these
      // against the synced sheet, so no money figure from the browser is
      // trusted — only the selection itself.
      selections: checkoutData.map((loc) => {
        const locId = loc.id || loc.name;
        const sel = locPromoSelections[locId] || {};
        return {
          name: loc.fullName || loc.name,
          type: loc.type,
          services: servicesOf(loc).filter((svc) => sel[svc.key] === true).map((svc) => svc.key),
        };
      }),
      duration_months: duration,
      paymentMethod,
    };
  }

  // Razorpay path: the lead is still created, tagged with the gateway's id.
  function finishWithRazorpay(paymentId) {
    const lead = { ...buildLeadPayload(), amountPaid: advancePayment, razorpay_payment_id: paymentId };
    fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lead),
    }).catch(() => {});
    setIsProcessing(false);
    setStep(3);
  }

  return (
    <div style={styles.page}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerInner}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <a href="/" style={styles.logo}>
              <div style={styles.logoIcon}>B</div>
              <span style={styles.logoText}>BTL Bro</span>
            </a>
          </div>
          <div style={styles.steps}>
            {["Details", "Payment", "Done"].map((s, i) => (
              <div key={s} style={{ ...styles.step, ...(step >= i + 1 ? { opacity: 1 } : {}) }}>
                <div style={{ ...styles.stepDot, ...(step >= i + 1 ? styles.stepDotActive : {}) }}>{i + 1}</div>
                <span style={{ ...styles.stepLabel, ...(step === i + 1 ? { color: "#161616", fontWeight: 600 } : {}) }}>{s}</span>
              </div>
            ))}
          </div>
        </div>
      </header>

      <div style={styles.twoCol}>
        {/* ===== LEFT COLUMN: Form ===== */}
        <div style={styles.leftCol}>
          {/* ===== STEP 1: DETAILS ===== */}
          {step === 1 && (
            <div style={styles.card}>
              <button onClick={() => { window.location.href = '/'; }} style={styles.backLink}>
                <ArrowLeft size={16} /> Back to Search
              </button>
              <div style={styles.cardHeader}>
                <Target size={28} color="#F2701D" />
                <div>
                  <h1 style={styles.title}>Quick Checkout</h1>
                  <p style={styles.subtitle}>{locationCount} {category} locations {dataSourceIsDrive ? 'available' : 'selected'} {pincode ? `• Pincode: ${pincode}` : ''}</p>
                </div>
              </div>



              {/* Selected Locations list — read only */}
              {checkoutData.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={styles.sectionTitle}>Selected Locations</div>
                  <div style={{ border: "1px solid #E7E2D8", borderRadius: 10, overflow: "hidden" }}>
                    {checkoutData.map((loc, idx) => {
                      const locInfo = locationPrices[idx] || { promos: [] };
                      const selectedPromos = locInfo.promos.filter(p => !p.unavailable);
                      return (
                        <div key={loc.id || idx} style={{ padding: "12px 16px", borderBottom: idx < checkoutData.length - 1 ? "1px solid #F0EDE8" : "none" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: selectedPromos.length > 0 ? 8 : 0 }}>
                            <div style={{ width: 26, height: 26, borderRadius: 8, background: "#FFF4EC", color: "#F2701D", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{idx + 1}</div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: "#161616" }}>{loc.name || loc.fullName}</div>
                              <div style={{ fontSize: 11, color: "#949494", textTransform: "capitalize" }}>
                                {loc.type}{loc.sheetDistance > 0 ? ` • ${loc.sheetDistance} km` : loc.distance > 0 ? ` • ${loc.distance.toFixed(1)} km` : ''}
                              </div>
                            </div>
                          </div>
                          {selectedPromos.length > 0 && (
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", paddingLeft: 38 }}>
                              {selectedPromos.map((p) => (
                                <span key={p.key} style={{
                                  padding: "4px 10px",
                                  borderRadius: 6,
                                  // No price on file yet is normal — the quote
                                  // is confirmed after the order, not before.
                                  // Only a priced service gets the accent chip.
                                  background: p.price > 0 ? "#FFF4EC" : "#F5F3EE",
                                  border: `1px solid ${p.price > 0 ? "#F2701D" : "#E2DDD2"}`,
                                  color: p.price > 0 ? "#F2701D" : "#8A8377",
                                  fontSize: 11,
                                  fontWeight: 600,
                                  fontFamily: "'Inter', sans-serif",
                                }}>
                                  {p.label}{p.price > 0 ? `: ₹${p.price.toLocaleString()}` : ""}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Duration */}
              <div style={{ marginBottom: 20 }}>
                <div style={styles.sectionTitle}>Campaign Duration</div>
                <div style={{ display: "flex", gap: 8 }}>
                  {[1, 2, 3, 6, 12].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setDuration(m)}
                      style={{
                        flex: 1,
                        padding: "10px 8px",
                        borderRadius: 8,
                        border: duration === m ? "2px solid #F2701D" : "1.5px solid #E7E2D8",
                        background: duration === m ? "#FFF4EC" : "#FAF9F7",
                        color: duration === m ? "#F2701D" : "#656565",
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: "pointer",
                        fontFamily: "'Inter', sans-serif",
                        transition: "all 0.15s ease",
                      }}
                    >
                      {m} {m === 1 ? 'Month' : 'Months'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Contact Form */}
              <form onSubmit={handleProceed}>
                <div style={styles.sectionTitle}>Your Details</div>
                <div style={styles.formGrid}>
                  <div style={styles.field}>
                    <label style={styles.label}>Full Name *</label>
                    <div style={styles.inputWrap}>
                      <User size={16} color="#949494" />
                      <input name="name" value={formData.name} onChange={handleChange} style={styles.input} placeholder="John Doe" required />
                    </div>
                  </div>
                  <div style={styles.field}>
                    <label style={styles.label}>Business Name</label>
                    <div style={styles.inputWrap}>
                      <Building2 size={16} color="#949494" />
                      <input name="business" value={formData.business} onChange={handleChange} style={styles.input} placeholder="Your business name" />
                    </div>
                  </div>
                  <div style={styles.field}>
                    <label style={styles.label}>Email *</label>
                    <div style={styles.inputWrap}>
                      <Mail size={16} color="#949494" />
                      <input name="email" type="email" value={formData.email} onChange={handleChange} style={styles.input} placeholder="you@email.com" required />
                    </div>
                  </div>
                  <div style={styles.field}>
                    <label style={styles.label}>Phone *</label>
                    <div style={styles.inputWrap}>
                      <Phone size={16} color="#949494" />
                      <input name="phone" type="tel" value={formData.phone} onChange={handleChange} style={styles.input} placeholder="+91 98765 43210" required />
                    </div>
                  </div>
                </div>
                {formData.name && formData.email && formData.phone ? (
                  <button type="submit" style={styles.primaryBtn}>
                    Proceed to Payment <ArrowRight size={16} />
                  </button>
                ) : (
                  <div>
                    <button type="submit" disabled style={{ ...styles.primaryBtn, background: "#D8D2C6", cursor: "not-allowed" }}>
                      Proceed to Payment <ArrowRight size={16} />
                    </button>
                    <p style={{ fontSize: 12, color: "#949494", marginTop: 8, textAlign: "center" }}>
                      Please fill all required fields (Name, Email, Phone)
                    </p>
                  </div>
                )}
              </form>
            </div>
          )}

          {/* ===== STEP 2: PAYMENT ===== */}
          {step === 2 && (
            <div style={styles.card}>
              <div style={styles.cardHeader}>
                <CreditCard size={28} color="#F2701D" />
                <div>
                  <h1 style={styles.title}>Payment</h1>
                  <p style={styles.subtitle}>Pay ₹{advancePayment.toLocaleString()} booking fee to confirm your campaign</p>
                </div>
              </div>

              {/* Payment amount — booking only.
                  There is deliberately no "pay in full" option. The booking fee
                  confirms the slot; the rest of the campaign is requested later
                  as the work progresses, so the balance is never collected
                  before anything has been delivered. */}
              <div style={{ marginBottom: 20 }}>
                <div style={styles.sectionTitle}>Payment Due Now</div>
                <div style={{
                  display: "flex", alignItems: "center", gap: 14, padding: "16px 18px",
                  border: "2px solid #F2701D",
                  background: "#FFF4EC",
                  borderRadius: 12,
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: "#161616" }}>Booking Fee — ₹{advancePayment.toLocaleString()}</div>
                    <div style={{ fontSize: 12, color: "#949494", marginTop: 2 }}>
                      Confirms your slot now. The balance of ₹{Math.max(0, total - advancePayment).toLocaleString()} is requested later, as the campaign progresses.
                    </div>
                  </div>
                  <span style={{ fontWeight: 800, fontSize: 20, color: "#F2701D" }}>₹{advancePayment.toLocaleString()}</span>
                </div>
              </div>

              {/* Payment Methods */}
              <div style={styles.sectionTitle}>Select Payment Method</div>
              <div style={{ display: "grid", gap: 10, marginBottom: 20 }}>
                {[
                  { id: "upi", label: "UPI (Google Pay / PhonePe / Paytm)", icon: "💳" },
                  { id: "card", label: "Credit / Debit Card", icon: "💳" },
                  { id: "netbanking", label: "Net Banking", icon: "🏦" },
                ].map((m) => (
                  <label
                    key={m.id}
                    style={{
                      ...styles.paymentOption,
                      borderColor: paymentMethod === m.id ? "#F2701D" : "#E7E2D8",
                      background: paymentMethod === m.id ? "#FFF4EC" : "#fff",
                    }}
                  >
                    <input
                      type="radio"
                      name="payment"
                      value={m.id}
                      checked={paymentMethod === m.id}
                      onChange={(e) => setPaymentMethod(e.target.value)}
                      style={{ accentColor: "#F2701D" }}
                    />
                    <span style={{ fontSize: 18 }}>{m.icon}</span>
                    <span style={{ fontSize: 14, fontWeight: 500, color: "#161616" }}>{m.label}</span>
                  </label>
                ))}
              </div>

              {paymentMethod === "upi" && (
                <div style={styles.field}>
                  <label style={styles.label}>UPI ID</label>
                  <input style={styles.input} placeholder="yourname@upi" />
                </div>
              )}

              {paymentMethod === "card" && (
                <div style={{ display: "grid", gap: 12 }}>
                  <div style={styles.field}>
                    <label style={styles.label}>Card Number</label>
                    <input style={styles.input} placeholder="1234 5678 9012 3456" />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div style={styles.field}>
                      <label style={styles.label}>Expiry</label>
                      <input style={styles.input} placeholder="MM/YY" />
                    </div>
                    <div style={styles.field}>
                      <label style={styles.label}>CVV</label>
                      <input style={styles.input} type="password" placeholder="***" />
                    </div>
                  </div>
                </div>
              )}

              {paymentMethod === "netbanking" && (
                <div style={styles.field}>
                  <label style={styles.label}>Select Bank</label>
                  <select style={styles.input}>
                    <option>HDFC Bank</option>
                    <option>ICICI Bank</option>
                    <option>SBI</option>
                    <option>Axis Bank</option>
                  </select>
                </div>
              )}

              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "#f0fdf4", borderRadius: 8, marginTop: 16, marginBottom: 20 }}>
                <CheckCircle size={16} color="#16a34a" />
                <span style={{ fontSize: 12, color: "#16a34a" }}>256-bit SSL secured payment</span>
              </div>

              <div style={{ display: "flex", gap: 12 }}>
                <button onClick={() => setStep(1)} style={styles.secondaryBtn}>
                  <ArrowLeft size={16} /> Back
                </button>
                <button onClick={handlePay} disabled={isProcessing} style={{ ...styles.primaryBtn, opacity: isProcessing ? 0.7 : 1, marginTop: 0 }}>
                  {isProcessing ? "Processing..." : <>Pay ₹{advancePayment.toLocaleString()} Now <ArrowRight size={16} /></>}
                </button>
              </div>

              {checkoutError && (
                <div style={{ marginTop: 16, padding: "12px 14px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10, fontSize: 13, color: "#B91C1C" }}>
                  {checkoutError}
                </div>
              )}

              {/* Fixed-amount request. The amount is baked into the QR, so the
                  payer cannot change what they send. */}
              {session && (
                <div style={{ marginTop: 20, padding: 18, border: "1px solid #E7E2D8", borderRadius: 14, background: "#FAF9F7", textAlign: "center" }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: "#161616", marginBottom: 4 }}>
                    Scan &amp; pay ₹{(session.amount || 0).toLocaleString()}
                  </p>
                  <p style={{ fontSize: 11, color: "#949494", marginBottom: 14 }}>
                    {session.status === "paid"
                      ? "Payment received"
                      : session.status === "awaiting"
                        ? "Waiting for payment — this page updates automatically"
                        : `Payment ${session.status}`}
                  </p>

                  {qrDataUrl ? (
                    <img src={qrDataUrl} alt={`UPI QR for ₹${session.amount}`} style={{ width: 240, height: 240, background: "#fff", borderRadius: 10, border: "1px solid #E7E2D8" }} />
                  ) : (
                    <div style={{ width: 240, height: 240, margin: "0 auto", borderRadius: 10, background: "#fff", border: "1px solid #E7E2D8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#949494" }}>
                      Preparing QR…
                    </div>
                  )}

                  {session.status === "awaiting" && (
                    <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 14, flexWrap: "wrap" }}>
                      <a href={session.intentUri} style={{ ...styles.secondaryBtn, textDecoration: "none" }}>
                        Open UPI app
                      </a>
                      <button
                        onClick={() => {
                          navigator.clipboard?.writeText(session.intentUri);
                        }}
                        style={styles.secondaryBtn}
                      >
                        Copy link
                      </button>
                    </div>
                  )}
                  <p style={{ fontSize: 10, color: "#B0AAA0", marginTop: 12, wordBreak: "break-all" }}>
                    Ref {session.reference}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ===== STEP 3: SUCCESS ===== */}
          {step === 3 && (
            <div style={{ ...styles.card, textAlign: "center" }}>
              <div style={{ width: 80, height: 80, borderRadius: "50%", background: "#dcfce7", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
                <CheckCircle size={40} color="#16a34a" />
              </div>
              <h1 style={{ fontSize: 24, fontWeight: 700, color: "#161616", marginBottom: 8 }}>
                {session?.status === "paid" ? "Payment received" : "Enquiry Submitted!"}
              </h1>
              <p style={{ fontSize: 15, color: "#656565", marginBottom: 24 }}>
                {session?.status === "paid" ? (
                  <>
                    We&apos;ve received ₹{(session.amount || 0).toLocaleString()} for your {category} campaign
                    across {locationCount} location{locationCount > 1 ? "s" : ""}. Our team will reach out shortly.
                  </>
                ) : (
                  <>
                    Your {category} campaign enquiry with {locationCount} locations has been received. Our team
                    will reach out shortly.
                  </>
                )}
              </p>
              {session?.reference && (
                <p style={{ fontSize: 11, color: "#949494", marginBottom: 20, wordBreak: "break-all" }}>
                  Ref {session.reference}
                </p>
              )}
              <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
                <a href="/" style={{ ...styles.primaryBtn, textDecoration: "none", width: "auto", marginTop: 0 }}>Back to Home</a>
              </div>
            </div>
          )}
        </div>

        {/* ===== RIGHT COLUMN: Selected Locations ===== */}
        {step < 3 && (
          <div style={styles.rightCol}>
            <div style={styles.rightCard}>
              <div style={styles.rightHeader}>
                <CreditCard size={18} color="#F2701D" />
                <span style={styles.rightTitle}>Payment Summary</span>
              </div>
              <div style={{ padding: 18 }}>
                <div style={{ textAlign: "center", padding: "20px 0", borderBottom: "1px solid #E7E2D8", marginBottom: 16 }}>
                  <p style={{ fontSize: 12, color: "#949494", marginBottom: 4 }}>Booking Fee</p>
                  <p style={{ fontSize: 36, fontWeight: 700, color: "#F2701D" }}>₹{advancePayment.toLocaleString()}</p>
                  <p style={{ fontSize: 11, color: "#949494", marginTop: 4 }}>Total campaign value: ₹{total.toLocaleString()} &middot; balance requested later</p>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span style={{ color: "#656565" }}>Category</span>
                    <span style={{ fontWeight: 600, color: "#161616" }}>{category}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span style={{ color: "#656565" }}>Locations</span>
                    <span style={{ fontWeight: 600, color: "#161616" }}>{locationCount}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span style={{ color: "#656565" }}>Duration</span>
                    <span style={{ fontWeight: 600, color: "#161616" }}>{duration} {duration === 1 ? 'Month' : 'Months'}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span style={{ color: "#656565" }}>Pincode</span>
                    <span style={{ fontWeight: 600, color: "#161616" }}>{pincode || 'N/A'}</span>
                  </div>
                </div>
                <div style={{ borderTop: "1px solid #E7E2D8", paddingTop: 12, display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                  {locationCost > 0 && (
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                      <span style={{ color: "#656565" }}>Location Cost ({locationCount} × ₹{perLocation} × {duration}mo)</span>
                      <span style={{ fontWeight: 500, color: "#161616" }}>₹{locationCost.toLocaleString()}</span>
                    </div>
                  )}
                  {promoCost > 0 && (
                    <>
                      {Object.entries(promoBreakdown).map(([key, val]) => {
                        const count = typeof val === 'object' ? val.count || 0 : val;
                        const label = (typeof val === 'object' ? val.label : null) || key;
                        // Total for SELECTED promos of this type — computed during pricing above
                        const typeTotal = val.total || 0;
                        return (
                          <div key={key} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, paddingLeft: 8 }}>
                            <span style={{ color: "#656565" }}>{label} ({count})</span>
                            <span style={{ fontWeight: 500, color: "#161616" }}>₹{typeTotal.toLocaleString()}</span>
                          </div>
                        );
                      })}
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                        <span style={{ color: "#656565", fontWeight: 600 }}>Promotions Total</span>
                        <span style={{ fontWeight: 600, color: "#161616" }}>₹{promoCost.toLocaleString()}</span>
                      </div>
                    </>
                  )}
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span style={{ color: "#656565" }}>Agency Fee ({agencyFeePercent}%)</span>
                    <span style={{ fontWeight: 500, color: "#161616" }}>₹{setupFee.toLocaleString()}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span style={{ color: "#656565" }}>GST (18%)</span>
                    <span style={{ fontWeight: 500, color: "#161616" }}>₹{gst.toLocaleString()}</span>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "12px 0", borderTop: "2px solid #E7E2D8" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontWeight: 700, fontSize: 15, color: "#161616" }}>Pay Now (Booking)</span>
                    <span style={{ fontWeight: 700, fontSize: 20, color: "#F2701D" }}>₹{advancePayment.toLocaleString()}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 12, color: "#949494" }}>Balance (requested later)</span>
                    <span style={{ fontSize: 12, color: "#949494" }}>₹{Math.max(0, total - advancePayment).toLocaleString()}</span>
                  </div>
                </div>
                <div style={{ marginTop: 16, padding: "10px 14px", background: "#f0fdf4", borderRadius: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  <CheckCircle size={14} color="#16a34a" />
                  <span style={{ fontSize: 11, color: "#16a34a", fontWeight: 500 }}>Secure checkout • Instant confirmation</span>
                </div>
              </div>
            </div>


          </div>
        )}
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Inter', sans-serif; background: #f5f5f5; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .animate-spin { animation: spin 1s linear infinite; }
        @media (max-width: 900px) {
          .checkout-two-col { flex-direction: column !important; }
          .checkout-right-col { display: none !important; }
        }
      `}</style>
    </div>
  );
};

const styles = {
  page: { minHeight: "100vh", background: "#f5f5f5", fontFamily: "'Inter', sans-serif" },
  header: { background: "#fff", borderBottom: "1px solid #E7E2D8", position: "sticky", top: 0, zIndex: 50 },
  headerInner: { maxWidth: 1100, margin: "0 auto", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" },
  logo: { display: "flex", alignItems: "center", gap: 10, textDecoration: "none" },
  logoIcon: { width: 32, height: 32, borderRadius: 8, background: "#F2701D", color: "#fff", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" },
  logoText: { fontSize: 16, fontWeight: 700, color: "#161616" },
  steps: { display: "flex", gap: 16 },
  step: { display: "flex", alignItems: "center", gap: 6, opacity: 0.4 },
  stepDot: { width: 22, height: 22, borderRadius: "50%", background: "#E7E2D8", color: "#fff", fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" },
  stepDotActive: { background: "#F2701D" },
  stepLabel: { fontSize: 12, fontWeight: 500, color: "#949494" },
  twoCol: { maxWidth: 1100, margin: "32px auto", padding: "0 24px", display: "flex", gap: 24, alignItems: "flex-start" },
  leftCol: { flex: 1, minWidth: 0 },
  rightCol: { width: 320, flexShrink: 0, position: "sticky", top: 80 },
  card: { background: "#fff", borderRadius: 16, padding: 32, boxShadow: "0 2px 12px rgba(0,0,0,0.06)", border: "1px solid #E7E2D8" },
  rightCard: { background: "#fff", borderRadius: 16, boxShadow: "0 2px 12px rgba(0,0,0,0.06)", border: "1px solid #E7E2D8", overflow: "hidden" },
  rightHeader: { display: "flex", alignItems: "center", gap: 8, padding: "16px 18px", background: "#FAF9F7", borderBottom: "1px solid #E7E2D8" },
  rightTitle: { fontWeight: 700, fontSize: 14, color: "#161616", flex: 1 },
  rightCount: { background: "#F2701D", color: "#fff", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 10 },
  rightList: { maxHeight: 500, overflowY: "auto" },
  locationCard: { padding: "12px 18px", borderBottom: "1px solid #F0EDE8", transition: "background 0.15s" },
  locationCardTop: { display: "flex", alignItems: "center", gap: 10 },
  locationNum: { width: 26, height: 26, borderRadius: 8, background: "#FFF4EC", color: "#F2701D", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  locationInfo: { display: "flex", flexDirection: "column", gap: 1 },
  locationName: { fontSize: 13, fontWeight: 600, color: "#161616" },
  locationType: { fontSize: 11, color: "#949494", textTransform: "capitalize" },
  locationPromos: { display: "flex", gap: 4, flexWrap: "wrap", marginTop: 8, paddingLeft: 36 },
  promoTag: { padding: "2px 8px", background: "#FFF4EC", border: "1px solid #F2701D", borderRadius: 4, fontSize: 10, fontWeight: 600, color: "#F2701D" },
  backLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 13,
    fontWeight: 500,
    color: "#949494",
    textDecoration: "none",
    marginBottom: 16,
    transition: "color 0.15s",
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: 0,
    fontFamily: "'Inter', sans-serif",
  },
  cardHeader: { display: "flex", alignItems: "center", gap: 14, marginBottom: 24 },
  title: { fontSize: 22, fontWeight: 700, color: "#161616" },
  subtitle: { fontSize: 14, color: "#949494", marginTop: 2 },
  summaryBox: { padding: 16, background: "#FAF9F7", borderRadius: 10, border: "1px solid #E7E2D8" },
  summaryRow: { display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 14 },
  summaryLabel: { color: "#656565" },
  summaryValue: { fontWeight: 600, color: "#161616" },
  sectionTitle: { fontSize: 13, fontWeight: 600, color: "#4A4A4A", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 12, marginTop: 8 },
  formGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 20 },
  field: { display: "grid", gap: 4 },
  label: { fontSize: 13, fontWeight: 600, color: "#4A4A4A" },
  inputWrap: { display: "flex", alignItems: "center", gap: 8, padding: "0 14px", border: "1.5px solid #E7E2D8", borderRadius: 8, background: "#FAF9F7" },
  input: { padding: "11px 0", border: "none", background: "none", fontSize: 14, outline: "none", fontFamily: "'Inter', sans-serif", color: "#161616", width: "100%" },
  amountBox: { padding: "20px 24px", background: "#FFF4EC", borderRadius: 12, display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 },
  paymentOption: { display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", border: "2px solid #E7E2D8", borderRadius: 10, cursor: "pointer", transition: "all 0.15s" },
  primaryBtn: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "14px 28px", background: "#F2701D", color: "#fff", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "'Inter', sans-serif", width: "100%", marginTop: 8 },
  secondaryBtn: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "14px 20px", background: "#fff", color: "#4A4A4A", border: "1.5px solid #E7E2D8", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "'Inter', sans-serif", flex: 1 },
};

export default QuickCheckout;
