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
  ChevronRight,
  Lock,
  X,
} from "lucide-react";

const DRIVE_API = "/api/admin/google-drive";

// Campaigns are billed for a single month. The duration picker was removed, so
// this is fixed rather than user-chosen. The server clamps duration_months to
// 1..24 (defaulting to 1) in priceCart, so sending 1 keeps both sides in step.
const CAMPAIGN_MONTHS = 1;

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
  const [isProcessing, setIsProcessing] = useState(false);
  const [formErrors, setFormErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [detailIndex, setDetailIndex] = useState(null);
  // Live collection request once /api/checkout/pay has answered.
  const [session, setSession] = useState(null); // { leadId, amount, reference, intentUri, payu, status }
  const [checkoutError, setCheckoutError] = useState("");
  const pollTimer = useRef(null);
  const eventSourceRef = useRef(null);
  const settledRef = useRef(false);
  const [statusCheckDead, setStatusCheckDead] = useState(false);
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
  const locationCost = perLocation * locationCount * CAMPAIGN_MONTHS;

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
      const totalPrice = price * CAMPAIGN_MONTHS;
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

  function validateField(name, value) {
    const v = String(value || "").trim();
    if (name === "name") {
      return v ? "" : "Please enter your full name";
    }
    if (name === "email") {
      if (!v) return "Please enter your email address";
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? "" : "Please enter a valid email address";
    }
    if (name === "phone") {
      if (!v) return "Please enter your phone number";
      const digits = String(v).replace(/\D/g, "");
      return digits.length >= 10 ? "" : "Please enter a valid phone number";
    }
    return "";
  }

  // Gate the CTA until the contact fields are actually filled in — prevents
  // a dead click, lets inline errors lead the correction instead.
  const allValid = ["name", "email", "phone"].every((f) => !validateField(f, formData[f]));

  function handleBlur(e) {
    const { name, value } = e.target;
    setTouched((t) => ({ ...t, [name]: true }));
    setFormErrors((prev) => ({ ...prev, [name]: validateField(name, value) }));
  }

  // Validation-triggered step advance: errors only ever surface after a field
  // is touched or a submit is attempted. No alert(), no permanently-visible
  // hint — inline messages appear under the offending fields.
  function handleSubmit(e) {
    e.preventDefault();
    const next = { name: "", email: "", phone: "" };
    for (const f in next) next[f] = validateField(f, formData[f]);
    setFormErrors(next);
    setSubmitted(true);
    setTouched({ name: true, email: true, phone: true });
    if (Object.values(next).some(Boolean)) return;
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
        if (d.intent_uri) startWatching(d.reference);
        else setStep(3);
      })
      .catch((err) => {
        setIsProcessing(false);
        setCheckoutError(err.message || 'Payment could not be started. Please try again.');
      });
  }

  // Tear down whichever channel (stream or poll) is currently watching a
  // reference. Safe to call repeatedly.
  function stopWatching() {
    if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null; }
    if (eventSourceRef.current) {
      try { eventSourceRef.current.close(); } catch { /* already closed */ }
      eventSourceRef.current = null;
    }
  }

  // Fold a status payload into the session and act on terminal states. The
  // server also sends the (possibly retargeted) amount + intent_uri, so a
  // booking-amount change renders a fresh QR here without a page reload.
  function applyPaymentStatus(d) {
    if (!d || !d.status) return;
    setSession((s) => {
      if (!s) return s;
      const nextAmount = typeof d.amount === 'number' && d.amount > 0 ? d.amount : s.amount;
      const nextUri = d.intent_uri || s.intentUri;
      if (s.status === d.status && s.amount === nextAmount && s.intentUri === nextUri) return s;
      return { ...s, status: d.status, amount: nextAmount, intentUri: nextUri };
    });
    if (d.status === 'paid') {
      settledRef.current = true;
      stopWatching();
      setStep(3);                       // the success step — realtime redirect
    } else if (d.status === 'failed' || d.status === 'cancelled') {
      settledRef.current = true;
      stopWatching();
    }
  }

  // Poll the status endpoint. A backstop for browsers/proxies where the SSE
  // stream cannot be opened; keeps checking for ~30 min, then surfaces a
  // manual button instead of dying silently on the customer.
  function startFallbackPolling(reference) {
    if (pollTimer.current) return;
    let attempts = 0;
    const tick = () => {
      attempts += 1;
      fetch(`/api/checkout/status/${encodeURIComponent(reference)}`)
        .then((r) => r.json())
        .then((d) => applyPaymentStatus(d))
        .catch(() => {});
      if (attempts >= 360) {
        stopWatching();
        setStatusCheckDead(true);
      }
    };
    tick();
    pollTimer.current = setInterval(tick, 5000);
  }

  // Watch a reference until the gateway (or a manager) confirms it. Preferred
  // channel is the server push (SSE) so the page advances the instant the
  // payment settles; polling is only the fallback.
  function startWatching(reference) {
    stopWatching();
    settledRef.current = false;
    setStatusCheckDead(false);

    if (typeof window !== 'undefined' && 'EventSource' in window) {
      let es = null;
      try {
        es = new EventSource(`/api/checkout/status/stream/${encodeURIComponent(reference)}`);
      } catch {
        es = null;
      }
      if (es) {
        eventSourceRef.current = es;
        let gotMessage = false;
        // If the stream never delivers its snapshot (blocked proxy, buffered
        // response), fall back to polling rather than wait forever.
        const fallbackTimer = setTimeout(() => {
          if (!gotMessage && !settledRef.current) {
            if (eventSourceRef.current) {
              try { eventSourceRef.current.close(); } catch { /* noop */ }
              eventSourceRef.current = null;
            }
            startFallbackPolling(reference);
          }
        }, 8000);
        es.onmessage = (ev) => {
          gotMessage = true;
          clearTimeout(fallbackTimer);
          try { applyPaymentStatus(JSON.parse(ev.data)); } catch { /* ignore malformed frame */ }
        };
        es.onerror = () => {
          clearTimeout(fallbackTimer);
          if (settledRef.current) return;         // expected close after a terminal status
          if (eventSourceRef.current) {
            try { eventSourceRef.current.close(); } catch { /* noop */ }
            eventSourceRef.current = null;
          }
          startFallbackPolling(reference);
        };
        return;
      }
    }
    startFallbackPolling(reference);
  }

  useEffect(() => () => {
    stopWatching();
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
      duration: `${CAMPAIGN_MONTHS} month${CAMPAIGN_MONTHS > 1 ? 's' : ''}`,
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
      duration_months: CAMPAIGN_MONTHS,
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
    <div className="checkout-page" style={styles.page}>
      {/* Header — logo only. The stepper sits in its own bar below so the
          header row stays uncluttered and the progress stays visible. */}
      <header className="btl-page-header" style={styles.header}>
        <div className="btl-header-inner" style={styles.headerInner}>
          <a href="/" style={styles.logo}>
            <div style={styles.logoIcon}>B</div>
            <span style={styles.logoText}>BTL Bro</span>
          </a>
        </div>
      </header>

      {/* One container holds the progress indicator AND the two-column body, so
          the steps share the cards' background, gutters and max width instead of
          sitting in their own full-width strip. The wrapper adds no background,
          border or vertical padding of its own - only a bottom margin. */}
      <main className="checkout-page-container">
        <div className="checkout-progress-wrapper">
          <div className="checkout-progress"
            role="progressbar" aria-valuemin={1} aria-valuemax={3} aria-valuenow={step}
            aria-label={`Step ${step} of 3`}>
            <div className="progress-steps">
              <span className={`step-connector connector-1${step >= 2 ? " completed" : ""}`} aria-hidden="true" />
              <span className={`step-connector connector-2${step >= 3 ? " completed" : ""}`} aria-hidden="true" />
              {["Details", "Payment", "Done"].map((s, i) => {
                const n = i + 1;
                const state = n < step ? "completed" : n === step ? "active" : "inactive";
                return (
                  <div key={s} className={`progress-step ${state}`}>
                    <div className={`step-circle ${state}`}>{n}</div>
                    <span className="step-label">{s}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

      {/* The container (max-width + gutters) lives on <main> above, so this row
          must not re-declare them or the cards would nest two gutters. */}
      <div className="checkout-layout btl-two-col" style={styles.twoCol}>
        {/* ===== LEFT COLUMN: Form ===== */}
        <div style={styles.leftCol}>
          {/* ===== STEP 1: DETAILS ===== */}
          {step === 1 && (
            <div className="checkout-card" style={styles.card}>
              <button onClick={() => { window.location.href = '/'; }} style={styles.backLink} className="co-back">
                <ArrowLeft size={16} /> Back to Search
              </button>
              <div style={styles.cardHeader} className="co-intro">
                <Target size={28} color="#F2701D" className="co-intro-icon" />
                <div style={{ minWidth: 0 }}>
                  <h1 style={styles.title} className="co-title">Quick Checkout</h1>
                  <p style={styles.subtitle} className="co-sub">{locationCount} {category} location{locationCount === 1 ? "" : "s"} {dataSourceIsDrive ? 'available' : 'selected'} {pincode ? `· Pincode: ${pincode}` : ''}</p>
                </div>
              </div>



              {/* Selected Locations list — read only */}
              {checkoutData.length > 0 && (
                <div className="co-locs-section" style={{ marginBottom: 20 }}>
                  <div style={styles.sectionTitle} className="co-section-title">Selected Locations</div>
                  <div className="co-loc-list" style={{ border: "1px solid #E7E2D8", borderRadius: 10, overflow: "hidden" }}>
                    {checkoutData.map((loc, idx) => {
                      const locInfo = locationPrices[idx] || { promos: [] };
                      const selectedPromos = locInfo.promos.filter(p => p.selected);
                      return (
                        <div key={loc.id || idx} className="co-loc-row"
                          role="button" tabIndex={0}
                          onClick={() => setDetailIndex(idx)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDetailIndex(idx); }
                          }}
                          style={{ padding: "12px 16px", borderBottom: idx < checkoutData.length - 1 ? "1px solid #F0EDE8" : "none" }}>
                          <div className="co-loc-main" style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: selectedPromos.length > 0 ? 8 : 0 }}>
                            <div style={{ width: 26, height: 26, borderRadius: 8, background: "#FFF4EC", color: "#F2701D", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{idx + 1}</div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div className="co-loc-name" style={{ fontSize: 13, fontWeight: 600, color: "#161616" }}>{loc.name || loc.fullName}</div>
                              <div className="co-loc-meta" style={{ fontSize: 11, color: "#949494", textTransform: "capitalize" }}>
                                {loc.type}{loc.sheetDistance > 0 ? ` • ${loc.sheetDistance} km` : loc.distance > 0 ? ` • ${loc.distance.toFixed(1)} km` : ''}
                              </div>
                            </div>
                            <ChevronRight size={18} color="#C9C2B4" className="co-loc-chevron mobile-only" />
                          </div>
                          {selectedPromos.length > 0 && (
                            <div className="co-loc-promos" style={{ display: "flex", gap: 6, flexWrap: "wrap", paddingLeft: 38 }}>
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

              {/* Contact Form */}
              <form onSubmit={handleSubmit} noValidate>
                <div style={styles.sectionTitle} className="co-section-title">Your Details</div>
                <div className="btl-form-grid checkout-form-grid" style={styles.formGrid}>
                  <div className="co-field" style={styles.field}>
                    <label style={styles.label} className="co-label">Full Name *</label>
                    <div style={styles.inputWrap} className="co-input-wrap">
                      <User size={16} color="#949494" />
                      <input name="name" value={formData.name} onChange={handleChange} onBlur={handleBlur} autoComplete="name" style={styles.input} className="co-input" placeholder="John Doe" required />
                    </div>
                    {(touched.name || submitted) && formErrors.name && <p className="co-error">{formErrors.name}</p>}
                  </div>
                  <div className="co-field" style={styles.field}>
                    <label style={styles.label} className="co-label">Business Name</label>
                    <div style={styles.inputWrap} className="co-input-wrap">
                      <Building2 size={16} color="#949494" />
                      <input name="business" value={formData.business} onChange={handleChange} autoComplete="organization" style={styles.input} className="co-input" placeholder="Your business name" />
                    </div>
                  </div>
                  <div className="co-field" style={styles.field}>
                    <label style={styles.label} className="co-label">Email *</label>
                    <div style={styles.inputWrap} className="co-input-wrap">
                      <Mail size={16} color="#949494" />
                      <input name="email" type="email" value={formData.email} onChange={handleChange} onBlur={handleBlur} autoComplete="email" style={styles.input} className="co-input" placeholder="you@email.com" required />
                    </div>
                    {(touched.email || submitted) && formErrors.email && <p className="co-error">{formErrors.email}</p>}
                  </div>
                  <div className="co-field" style={styles.field}>
                    <label style={styles.label} className="co-label">Phone *</label>
                    <div style={styles.inputWrap} className="co-input-wrap">
                      <Phone size={16} color="#949494" />
                      <input name="phone" type="tel" value={formData.phone} onChange={handleChange} onBlur={handleBlur} autoComplete="tel" style={styles.input} className="co-input" placeholder="+91 98765 43210" required />
                    </div>
                    {(touched.phone || submitted) && formErrors.phone && <p className="co-error">{formErrors.phone}</p>}
                  </div>
                </div>

                {/* Booking fee summary — condensed card above the CTA, shown on
                    mobile only. The desktop right rail already renders the full
                    payment summary, so this never duplicates on wide screens.
                    Tapping it pops the full Payment Summary dialog. */}
                <button type="button" className="co-fee-card co-fee-btn mobile-only" onClick={() => setSummaryOpen(true)}>
                  <div style={{ minWidth: 0, textAlign: "left" }}>
                    <div className="co-fee-label">Booking Fee</div>
                    <div className="co-fee-sub">For {locationCount} location{locationCount === 1 ? "" : "s"}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span className="co-fee-amount">₹{advancePayment.toLocaleString()}</span>
                    <ChevronRight size={16} color="#C9C2B4" />
                  </div>
                </button>

                <button type="submit" className="co-cta" style={styles.primaryBtn} disabled={!allValid}>
                  Proceed to Payment
                  <span className="co-cta-amount mobile-only">· ₹{advancePayment.toLocaleString()}</span>
                  <ArrowRight size={16} />
                </button>

                <div className="co-trust mobile-only">
                  <Lock size={12} />
                  <span>Secure checkout · Instant confirmation</span>
                </div>
              </form>
            </div>
          )}

          {/* ===== STEP 2: PAYMENT ===== */}
          {step === 2 && (
            <div className="checkout-card" style={styles.card}>
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
                <div className="co-field" style={styles.field}>
                  <label className="co-label" style={styles.label}>UPI ID</label>
                  <div style={styles.inputWrap} className="co-input-wrap">
                    <input style={styles.input} className="co-input" placeholder="yourname@upi" inputMode="email" autoComplete="off" />
                  </div>
                </div>
              )}

              {paymentMethod === "card" && (
                <div style={{ display: "grid", gap: 12 }}>
                  <div className="co-field" style={styles.field}>
                    <label className="co-label" style={styles.label}>Card Number</label>
                    <div style={styles.inputWrap} className="co-input-wrap">
                      <input style={styles.input} className="co-input" placeholder="1234 5678 9012 3456" inputMode="numeric" autoComplete="cc-number" />
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div className="co-field" style={styles.field}>
                      <label className="co-label" style={styles.label}>Expiry</label>
                      <div style={styles.inputWrap} className="co-input-wrap">
                        <input style={styles.input} className="co-input" placeholder="MM/YY" inputMode="numeric" autoComplete="cc-exp" />
                      </div>
                    </div>
                    <div className="co-field" style={styles.field}>
                      <label className="co-label" style={styles.label}>CVV</label>
                      <div style={styles.inputWrap} className="co-input-wrap">
                        <input style={styles.input} className="co-input" type="password" placeholder="***" inputMode="numeric" autoComplete="cc-csc" />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {paymentMethod === "netbanking" && (
                <div className="co-field" style={styles.field}>
                  <label className="co-label" style={styles.label}>Select Bank</label>
                  <div style={styles.inputWrap} className="co-input-wrap">
                    <select style={styles.input} className="co-input">
                      <option>HDFC Bank</option>
                      <option>ICICI Bank</option>
                      <option>SBI</option>
                      <option>Axis Bank</option>
                    </select>
                  </div>
                </div>
              )}

              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "#f0fdf4", borderRadius: 8, marginTop: 16, marginBottom: 20 }}>
                <CheckCircle size={16} color="#16a34a" />
                <span style={{ fontSize: 12, color: "#16a34a" }}>256-bit SSL secured payment</span>
              </div>

              <div className="payment-actions" style={{ display: "flex", gap: 12 }}>
                <button onClick={() => setStep(1)} className="back-button" style={styles.secondaryBtn}>
                  <ArrowLeft size={16} /> Back
                </button>
                <button onClick={handlePay} disabled={isProcessing} className="pay-button" style={{ ...styles.primaryBtn, opacity: isProcessing ? 0.7 : 1, marginTop: 0 }}>
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
                        ? statusCheckDead
                          ? "Haven't been able to check for a moment — tap below if you have already paid."
                          : "Waiting for payment — this page updates automatically"
                        : `Payment ${session.status}`}
                  </p>

                  {qrDataUrl ? (
                    <img className="btl-qr" src={qrDataUrl} alt={`UPI QR for ₹${session.amount}`} style={{ background: "#fff", borderRadius: 10, border: "1px solid #E7E2D8" }} />
                  ) : (
                    <div className="btl-qr" style={{ margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#949494" }}>
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
                      {statusCheckDead && (
                        <button
                          onClick={() => startWatching(session.reference)}
                          style={{ ...styles.primaryBtn, width: "auto", marginTop: 0, textDecoration: "none" }}
                        >
                          Check payment status
                        </button>
                      )}
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
          <div className="btl-side-col" style={styles.rightCol}>
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
                    <span style={{ color: "#656565" }}>Pincode</span>
                    <span style={{ fontWeight: 600, color: "#161616" }}>{pincode || 'N/A'}</span>
                  </div>
                </div>
                <div style={{ borderTop: "1px solid #E7E2D8", paddingTop: 12, display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                  {locationCost > 0 && (
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                      <span style={{ color: "#656565" }}>Location Cost ({locationCount} × ₹{perLocation})</span>
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
      </main>

      {/* ===== Popups: Payment Summary (fee card tap) / Service Details (location tap) ===== */}
      {(summaryOpen || detailIndex !== null) && (
        <div className="co-modal-overlay" onClick={() => { setSummaryOpen(false); setDetailIndex(null); }}>
          <div className="co-modal" role="dialog" aria-modal="true" aria-label={summaryOpen ? "Payment Summary" : "Selected Services"}
            onClick={(e) => e.stopPropagation()}>
            <div className="co-modal-head">
              {summaryOpen ? <CreditCard size={20} color="#F2701D" /> : <MapPin size={20} color="#F2701D" />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3>{summaryOpen ? "Payment Summary" : "Selected Services"}</h3>
                <p>{summaryOpen ? "Your booking at a glance" : (() => {
                  const l = checkoutData[detailIndex];
                  return l ? (l.name || l.fullName || "Location") : "";
                })()}</p>
              </div>
              <button type="button" className="co-modal-close" aria-label="Close"
                onClick={() => { setSummaryOpen(false); setDetailIndex(null); }}>
                <X size={20} />
              </button>
            </div>

            {summaryOpen ? (
              <div className="co-summary-body">
                <div className="co-summary-hero">
                  <p>Booking Fee</p>
                  <p className="co-summary-big">₹{advancePayment.toLocaleString()}</p>
                  <p>Total campaign value: ₹{total.toLocaleString()} &middot; balance requested later</p>
                </div>
                <div className="co-summary-rows">
                  <div className="co-summary-row"><span className="k">Category</span><span className="v">{category}</span></div>
                  <div className="co-summary-row"><span className="k">Locations</span><span className="v">{locationCount}</span></div>
                  <div className="co-summary-row"><span className="k">Pincode</span><span className="v">{pincode || 'N/A'}</span></div>
                </div>
                <div className="co-summary-rows">
                  {locationCost > 0 && (
                    <div className="co-summary-row"><span className="k">Location Cost ({locationCount} &times; ₹{perLocation})</span><span className="v">₹{locationCost.toLocaleString()}</span></div>
                  )}
                  {Object.entries(promoBreakdown || {}).map(([key, val]) => {
                    const count = typeof val === 'object' ? val.count || 0 : val;
                    const label = (typeof val === 'object' ? val.label : null) || key;
                    const typeTotal = val.total || 0;
                    return (
                      <div key={key} className="co-summary-row"><span className="k">{label} ({count})</span><span className="v">₹{typeTotal.toLocaleString()}</span></div>
                    );
                  })}
                  {promoCost > 0 && (
                    <div className="co-summary-row strong"><span className="k">Promotions Total</span><span className="v">₹{promoCost.toLocaleString()}</span></div>
                  )}
                  <div className="co-summary-row"><span className="k">Agency Fee ({agencyFeePercent}%)</span><span className="v">₹{setupFee.toLocaleString()}</span></div>
                  <div className="co-summary-row"><span className="k">GST (18%)</span><span className="v">₹{gst.toLocaleString()}</span></div>
                </div>
                <div className="co-summary-totals">
                  <div className="co-summary-row big"><span className="k">Pay Now (Booking)</span><span className="v">₹{advancePayment.toLocaleString()}</span></div>
                  <div className="co-summary-row small"><span className="k">Balance (requested later)</span><span className="v">₹{Math.max(0, total - advancePayment).toLocaleString()}</span></div>
                </div>
              </div>
            ) : detailIndex !== null && checkoutData[detailIndex] ? (
              (() => {
                const l = checkoutData[detailIndex];
                const locInfo = locationPrices[detailIndex] || { promos: [], hasSheetPrices: false };
                const servs = locInfo.promos.filter((p) => p.selected);
                const meta =
                  `${l.type || ""
                  }${l.sheetDistance > 0 ? ` · ${l.sheetDistance} km` : l.distance > 0 ? ` · ${l.distance.toFixed(1)} km` : ""}`;
                return (
                  <div className="co-summary-body">
                    <div className="co-detail-meta">
                      <div className="co-detail-name">{l.name || l.fullName}</div>
                      {meta && <div className="co-detail-sub">{meta}</div>}
                    </div>
                    {servs.length > 0 ? (
                      <div className="co-summary-rows">
                        {servs.map((p) => (
                          <div key={p.key} className="co-summary-row">
                            <span className="k">{p.label}</span>
                            <span className="v">₹{p.price.toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p style={{ fontSize: 13, color: "#8A8377", lineHeight: 1.5 }}>
                        No services selected for this location yet. You can choose services in the checkout grid or add them from the campaign builder.
                      </p>
                    )}
                  </div>
                );
              })()
            ) : null}
          </div>
        </div>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Inter', sans-serif; background: #f5f5f5; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .animate-spin { animation: spin 1s linear infinite; }
        /* Layout is handled by the shared hooks in styles/responsive.css.
           This block only covers what is unique to this page. */

        /* Pieces that exist for the mobile layout only. Hidden on desktop so
           the right-hand payment rail keeps owning the summary there. */
        .mobile-only { display: none; }

        /* ---- Popups (Payment Summary / Service Details) --------------------
           Bottom sheet on phones, centred card on desktop. Location rows are
           tappable at every size, so the sheet must exist on large screens too. */
        .co-modal-overlay {
          position: fixed;
          inset: 0;
          z-index: 90;
          background: rgba(22, 22, 22, 0.45);
          display: flex;
          align-items: flex-end;
          justify-content: center;
        }
        .co-modal {
          width: 100%;
          max-width: 480px;
          background: #fff;
          border-radius: 20px 20px 0 0;
          max-height: 85vh;
          overflow-y: auto;
          padding: 20px 20px 26px;
        }
        .co-modal-head { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 18px; }
        .co-modal-head h3 { font-size: 18px; font-weight: 700; color: #161616; }
        .co-modal-head p { font-size: 13px; color: #8A8377; margin-top: 2px; }
        .co-modal-close {
          border: 0;
          background: #F5F3EE;
          color: #161616;
          width: 44px;
          height: 44px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          flex-shrink: 0;
        }
        .co-summary-hero { text-align: center; padding: 14px 0 18px; border-bottom: 1px solid #E7E2D8; margin-bottom: 16px; }
        .co-summary-hero > p { font-size: 12px; color: #949494; margin-bottom: 4px; }
        .co-summary-hero .co-summary-big { font-size: 36px; font-weight: 700; color: #F2701D; line-height: 1.1; margin: 2px 0 4px; }
        .co-summary-body { display: flex; flex-direction: column; }
        .co-summary-rows { display: flex; flex-direction: column; gap: 9px; margin-bottom: 16px; }
        .co-summary-row { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; }
        .co-summary-row .k { color: #656565; }
        .co-summary-row .v { font-weight: 600; color: #161616; text-align: right; }
        .co-summary-row.strong .k, .co-summary-row.strong .v { font-weight: 700; }
        .co-summary-row.big .k { font-size: 15px; font-weight: 700; color: #161616; }
        .co-summary-row.big .v { font-size: 20px; font-weight: 800; color: #F2701D; }
        .co-summary-row.small .k, .co-summary-row.small .v { font-size: 12px; color: #949494; }
        .co-summary-totals { border-top: 2px solid #E7E2D8; padding-top: 14px; display: flex; flex-direction: column; gap: 6px; }
        .co-detail-meta { border-bottom: 1px solid #E7E2D8; padding-bottom: 14px; margin-bottom: 16px; }
        .co-detail-name { font-size: 16px; font-weight: 600; color: #161616; }
        .co-detail-sub { font-size: 13px; color: #8A8377; margin-top: 3px; text-transform: capitalize; }

        /* Location rows are tappable at every size (open the service popup). */
        .co-loc-row { cursor: pointer; }
        .co-loc-row:focus-visible { outline: 2px solid #F2701D; outline-offset: 2px; }

        @media (min-width: 769px) {
          .co-modal-overlay { align-items: center; padding: 24px; }
          .co-modal { border-radius: 16px; max-width: 440px; max-height: 80vh; }
        }

        @media (max-width: 768px) {
          body { background: #f8f7f4 !important; }
          .checkout-page { background: #f8f7f4 !important; }

          /* Header — slimmer row with the logo sitting on a warm definition line. */
          .checkout-page .btl-header-inner {
            max-width: 480px;
            padding: 14px 16px;
          }

          /* Everything below lives inside a comfortable 480px column. */
          .checkout-page .checkout-page-container {
            max-width: 480px;
            padding: 20px 16px 32px;
          }

          /* Open the big white card so the page breathes. The location and fee
             cards below carry their own surfaces now. */
          .checkout-page .checkout-card {
            background: transparent !important;
            border: none !important;
            box-shadow: none !important;
            padding: 0 !important;
          }

          /* The rail's full payment summary is exactly what the fee card +
             trust line now supply in-flow on a phone, so it is hidden instead
             of repeating. */
          .checkout-page .btl-side-col { display: none !important; }

          /* Step progress stays visible on phones — it is the only marker of the
             3-step journey, so hiding it left the flow with no orientation.
             Kept compact with a tighter bottom margin instead. */
          .checkout-page .checkout-progress-wrapper { display: block !important; margin-bottom: 18px !important; }

          /* Back link — quiet helper text. */
          .checkout-page .co-back { font-size: 13px !important; gap: 5px !important; margin-bottom: 14px !important; }

          /* Intro — 26px title straight from the mockup. */
          .checkout-page .co-intro { gap: 10px !important; margin-bottom: 22px !important; }
          .checkout-page .co-intro-icon { display: none !important; }
          .checkout-page .co-title { font-size: 26px !important; line-height: 1.15 !important; }
          .checkout-page .co-sub { font-size: 14px !important; color: #8A8377 !important; margin-top: 4px !important; }

          /* Section labels — tiny capitals, muted. */
          .checkout-page .co-section-title { font-size: 12px !important; font-weight: 600 !important; letter-spacing: 0.08em !important; color: #8A8377 !important; margin: 0 0 14px !important; }

          /* Selected locations — each row becomes its own soft card. */
          .checkout-page .co-loc-list { border: none !important; border-radius: 0 !important; overflow: visible !important; background: transparent !important; }
          .checkout-page .co-loc-row {
            padding: 14px 16px !important;
            border: 1px solid #E7E2D8 !important;
            border-bottom: 1px solid #E7E2D8 !important;
            border-radius: 14px !important;
            background: #fff !important;
            margin-bottom: 10px !important;
          }
          .checkout-page .co-loc-name { font-size: 15px !important; font-weight: 600 !important; color: #161616 !important; overflow-wrap: anywhere; }
          .checkout-page .co-loc-meta { font-size: 13px !important; color: #8A8377 !important; margin-top: 2px !important; }
          .checkout-page .co-loc-chevron { flex-shrink: 0; }
          .checkout-page .co-loc-promos { padding-left: 0 !important; margin-top: 8px !important; }

          /* Form — one comfortable column of 54px touch targets. */
          .checkout-page .checkout-form-grid { grid-template-columns: minmax(0, 1fr) !important; gap: 16px !important; }
          .checkout-page .co-field { gap: 5px !important; }
          .checkout-page .co-label { font-size: 14px !important; font-weight: 500 !important; color: #161616 !important; margin-bottom: 2px !important; }
          .checkout-page .co-input-wrap {
            min-height: 54px !important;
            padding: 0 14px !important;
            border: 1px solid #E7E2D8 !important;
            border-radius: 12px !important;
            background: #fff !important;
          }
          .checkout-page .co-input-wrap:focus-within {
            border-color: #F2701D !important;
            box-shadow: 0 0 0 3px rgba(242, 112, 29, 0.12) !important;
          }
          /* 16px on the inputs stops iOS Safari from zooming into the field. */
          .checkout-page .co-input { font-size: 16px !important; color: #161616 !important; }
          .checkout-page .co-input::placeholder { color: #B9B3A6 !important; }
          .checkout-page .co-error { font-size: 12px !important; color: #C0392B; margin-top: 5px !important; }

          .checkout-page .mobile-only { display: flex; }

          /* Booking fee summary card, pinned right above the CTA. */
          .checkout-page .co-fee-card {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            background: #FFF8F2;
            border: 1px solid #F1E5DA;
            border-radius: 14px;
            padding: 14px 16px;
            margin-top: 18px;
          }
          .checkout-page .co-fee-card.co-fee-btn {
            width: 100%;
            border: 1px solid #F1E5DA;
            font: inherit;
            cursor: pointer;
            color: inherit;
          }
          .checkout-page .co-fee-label { font-size: 14px; font-weight: 500; color: #161616; }
          .checkout-page .co-fee-sub { font-size: 12px; color: #8A8377; margin-top: 2px; }
          .checkout-page .co-fee-amount { font-size: 24px; font-weight: 700; color: #F2701D; line-height: 1; }

          /* Primary CTA — a full-width, 56px bar. */
          .checkout-page .co-cta {
            min-height: 56px !important;
            padding: 0 20px !important;
            border-radius: 14px !important;
            font-size: 16px !important;
            font-weight: 600 !important;
            margin-top: 14px !important;
          }
          .checkout-page .co-cta:disabled { background: #DED8CF !important; color: #fff !important; cursor: not-allowed; }
          .checkout-page .co-cta:active { transform: translateY(1px); }
          .checkout-page .co-cta-amount { font-weight: 600 !important; opacity: 0.95; }

          /* Trust line under the CTA. */
          .checkout-page .co-trust {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            font-size: 12px;
            color: #8A8377;
            margin-top: 10px;
          }

          /* Payment actions — Back + Pay Now as one aligned action group. */
          .checkout-page .payment-actions {
            display: flex !important;
            align-items: stretch;
            gap: 12px;
            width: 100% !important;
            margin-top: 16px;
          }
          .checkout-page .back-button {
            flex: 0 0 84px !important;
            min-height: 54px;
            border: 1px solid #E7E2D8 !important;
            background: #fff !important;
            color: #4A4A4A !important;
            border-radius: 12px !important;
            display: flex !important;
            align-items: center;
            justify-content: center;
            gap: 8px;
            font-size: 16px !important;
            font-weight: 500 !important;
            padding: 0 16px !important;
            box-sizing: border-box;
          }
          .checkout-page .pay-button {
            flex: 1 !important;
            min-height: 54px;
            border: none !important;
            background: #F2701D !important;
            color: #fff !important;
            border-radius: 12px !important;
            display: flex !important;
            align-items: center;
            justify-content: center;
            gap: 8px;
            font-size: 16px !important;
            font-weight: 600 !important;
            padding: 0 18px !important;
            box-sizing: border-box;
            white-space: nowrap;
          }
          .checkout-page .back-button:active,
          .checkout-page .pay-button:active { transform: translateY(1px); }
        }
        /* .checkout-progress / .progress-step / .step-circle / .step-connector
           styling lives in styles/responsive.css alongside the other page
           layout hooks. */
        @media (prefers-reduced-motion: reduce) {
          .animate-spin { animation: none !important; }
        }
      `}</style>
    </div>
  );
};

const styles = {
  page: { minHeight: "100vh", background: "#f5f5f5", fontFamily: "'Inter', sans-serif" },
  header: { background: "#fff", borderBottom: "1px solid #E7E2D8", position: "sticky", top: 0, zIndex: 50 },
  headerInner: { maxWidth: 1100, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 },
  /* Progress bar styling lives in styles/responsive.css (.checkout-progress). */
  logo: { display: "flex", alignItems: "center", gap: 10, textDecoration: "none" },
  logoIcon: { width: 32, height: 32, borderRadius: 8, background: "#F2701D", color: "#fff", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" },
  logoText: { fontSize: 16, fontWeight: 700, color: "#161616" },
  /* max-width / margin / padding come from .checkout-page-container on <main>,
     so this row only lays its own two columns out. */
  twoCol: { display: "flex", gap: 24, alignItems: "flex-start" },
  leftCol: { flex: 1, minWidth: 0 },
  /* top comes from .btl-side-col in responsive.css — do not set it inline. */
  rightCol: { width: 320, flexShrink: 0 },
  card: { background: "#fff", borderRadius: 16, padding: 32, boxShadow: "0 2px 12px rgba(0,0,0,0.06)", border: "1px solid #E7E2D8", maxWidth: "100%", boxSizing: "border-box" },
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
  formGrid: { display: "grid", gap: 14, marginBottom: 20 },
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
