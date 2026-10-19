import React, { useState, useEffect, useRef } from "react";
import {
  MapPin,
  FileText,
  CheckCircle,
  ArrowLeft,
  User,
  ChevronDown,
} from "lucide-react";

const REQUIRED = ["businessName", "contactName", "email", "phone", "pincode", "locations", "category"];

const CAMPAIGN_CATEGORIES = ["Apartments", "Cafés", "Restaurants", "Schools", "Hospitals", "Malls & Retail", "Offices", "Parks & Leisure"];

const CATEGORY_ICONS = {
  "Apartments": "🏢",
  "Cafés": "☕",
  "Restaurants": "🍽️",
  "Schools": "🎓",
  "Hospitals": "🏥",
  "Malls & Retail": "🛍️",
  "Offices": "💼",
  "Parks & Leisure": "🌳",
};

// Match a raw catchment type against the campaign Category list.
// "cafe"/"cafes"/"market cafe" all resolve to "Cafés"; anything with no
// counterpart returns "" so campaignLabelFor can title-case it instead.
function matchCampaignCategory(type) {
  const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");
  const tn = norm(type);
  if (!tn) return "";
  for (const c of CAMPAIGN_CATEGORIES) {
    const cn = norm(c);
    if (!cn) continue;
    if (cn === tn || (tn.length >= 3 && (tn.includes(cn) || cn.includes(tn)))) return c;
  }
  return "";
}

// A catchment type that doesn't map onto one of the eight campaign categories
// still deserves a readable label — the marketing tool's "Cinema Screens"
// chip, say — instead of being dropped from the multi-select.
function campaignLabelFor(type) {
  const match = matchCampaignCategory(type);
  if (match) return match;
  const t = String(type || "").trim();
  if (!t) return "";
  return t.replace(/\b\w/g, (c) => c.toUpperCase());
}

// The categories the user already chose in the marketing tool: the catchment
// type of every location they sent over at checkout, plus the Target chip(s)
// they tapped. Both survive the trip as raw sheet types ("cafe", "apartment
// services"), so each runs through the same matcher the old single-select used.
function marketingToolCategories(locs) {
  const picks = [];
  const add = (type) => {
    const label = campaignLabelFor(type);
    if (label && !picks.includes(label)) picks.push(label);
  };
  locs.forEach((l) => add(l.type));
  try {
    const chips = JSON.parse(sessionStorage.getItem("mt_selectedCategories") || "[]");
    if (Array.isArray(chips)) chips.forEach(add);
  } catch {
    /* no marketing-tool session */
  }
  return picks;
}

// The locations the user picked in the campaign builder (marketing tool →
// checkout handoff). Their catchment types pre-tick the matching categories
// in the Category multi-select.
function selectedCheckoutLocations() {
  try {
    const saved = JSON.parse(sessionStorage.getItem("btl_checkout_data") || "[]");
    if (!Array.isArray(saved)) return [];
    return saved
      .map((l) => ({ fullName: l.fullName || l.name || "", type: l.type || "" }))
      .filter((l) => l.fullName.trim());
  } catch {
    return [];
  }
}

function defaultFormData(locs) {
  const first = locs[0] || null;
  const fromTool = marketingToolCategories(locs);
  return {
    businessName: "",
    contactName: "",
    email: "",
    phone: "",
    pincode: "",
    zone: "",
    category: fromTool.length > 0 ? fromTool : ["Apartments"],
    locations: locs.length > 0 ? String(locs.length) : "",
    selectedLocation: first ? first.fullName : "",
    radius: "5",
    budget: "",
    startDate: "",
    duration: "1 month",
    message: "",
  };
}

const CustomerForm = () => {
  const [selectedLocations] = useState(selectedCheckoutLocations);
  const [submitted, setSubmitted] = useState(false);
  // Single-open accordion: when the form was prefilled from the campaign
  // builder the Campaign Details section opens on arrival so the categories
  // carried over from the marketing tool are visible immediately. Otherwise
  // Business Info opens first.
  const [openSection, setOpenSection] = useState(() => (selectedLocations.length > 0 ? "details" : "business"));
  const [formData, setFormData] = useState(() => defaultFormData(selectedLocations));
  const [formErrors, setFormErrors] = useState({});
  const [touched, setTouched] = useState({});

  // Options = the eight campaign categories plus anything the marketing tool
  // handed over that doesn't map onto one of them (its Target chips are a
  // wider vocabulary than this form's list).
  const marketingPicks = marketingToolCategories(selectedLocations);
  const categoryOptions = [
    ...CAMPAIGN_CATEGORIES,
    ...marketingPicks.filter((p) => !CAMPAIGN_CATEGORIES.includes(p)),
  ];

  function validateField(name, value) {
    if (name === "category") {
      return Array.isArray(value) && value.length > 0 ? "" : "Please select at least one category";
    }
    const v = String(value || "").trim();
    if (name === "businessName") return v ? "" : "Please enter your business name";
    if (name === "contactName") return v ? "" : "Please enter the contact person's name";
    if (name === "email") {
      if (!v) return "Please enter your email";
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? "" : "Please enter a valid email address";
    }
    if (name === "phone") {
      if (!v) return "Please enter your phone number";
      return v.replace(/\D/g, "").length >= 10 ? "" : "Please enter a valid phone number";
    }
    if (name === "pincode") {
      if (!v) return "Please enter your pincode";
      return /^\d{6}$/.test(v) ? "" : "Please enter a valid 6-digit pincode";
    }
    if (name === "locations") {
      if (!v) return "Please enter the number of locations";
      return Number(v) >= 1 ? "" : "Please enter at least 1 location";
    }
    return "";
  }

  function toggleSection(section) {
    setOpenSection((cur) => (cur === section ? null : section));
  }

  function handleChange(e) {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
    if (touched[name]) setFormErrors({ ...formErrors, [name]: validateField(name, value) });
  }

  function handleBlur(e) {
    const { name, value } = e.target;
    setTouched({ ...touched, [name]: true });
    setFormErrors({ ...formErrors, [name]: validateField(name, value) });
  }

  // Categories toggle independently — a campaign can target several
  // catchments at once, so picking one never clears the others.
  function toggleCategory(cat) {
    const current = Array.isArray(formData.category) ? formData.category : [];
    const next = current.includes(cat)
      ? current.filter((c) => c !== cat)
      : [...current, cat];
    setFormData({ ...formData, category: next });
    if (touched.category) setFormErrors({ ...formErrors, category: validateField("category", next) });
  }

  const allValid = REQUIRED.every((f) => !validateField(f, formData[f]));

  // Auto-advance: as soon as every required field in the open section is
  // filled, collapse it and open the next one. Only fires on the
  // incomplete→complete transition, so re-opening a finished section doesn't
  // yank the user forward again.
  const businessComplete = ["businessName", "contactName", "email", "phone"].every((f) => !validateField(f, formData[f]));
  const detailsComplete = ["pincode", "locations", "category"].every((f) => !validateField(f, formData[f]));
  const prevComplete = useRef({ business: false, details: false });

  useEffect(() => {
    if (openSection === "business" && businessComplete && !prevComplete.current.business) {
      setOpenSection("details");
    } else if (openSection === "details" && detailsComplete && !prevComplete.current.details) {
      setOpenSection("notes");
    }
    prevComplete.current = { business: businessComplete, details: detailsComplete };
  }, [formData, openSection, businessComplete, detailsComplete]);

  function handleSubmit(e) {
    e.preventDefault();
    const nextTouched = {};
    const nextErrors = {};
    for (const f of REQUIRED) {
      nextTouched[f] = true;
      nextErrors[f] = validateField(f, formData[f]);
    }
    setTouched(nextTouched);
    setFormErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) {
      // Jump to the section that still has problems so the inline errors
      // are actually visible before the user decides what to fix.
      if (nextErrors.businessName || nextErrors.contactName || nextErrors.email || nextErrors.phone) {
        setOpenSection("business");
      } else if (nextErrors.pincode || nextErrors.locations || nextErrors.category) {
        setOpenSection("details");
      }
      return;
    }
    // Save submission to admin
    const newOrder = {
      ...formData,
      // The lead column is a single string, so the multi-select is stored
      // comma-joined ("Apartments, Cafés").
      category: Array.isArray(formData.category) ? formData.category.join(", ") : formData.category,
      status: "pending",
      read: false,
      submittedAt: new Date().toISOString(),
    };
    // Save to the server DB as a lead
    fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newOrder, source: 'customize' }),
    }).catch(() => { /* server offline — request could not be saved */ });
    setSubmitted(true);
  }

  return (
    <div className="campaign-page" style={styles.page}>
      {/* Header */}
      <header className="btl-page-header" style={styles.header}>
        <div className="btl-header-inner" style={styles.headerInner}>
          <a href="/" style={styles.logo}>
            <div style={styles.logoIcon}>B</div>
            <span style={styles.logoText}>BTL Bro</span>
          </a>
        </div>
      </header>

      {/* ===== FORM ===== */}
      {!submitted ? (
        <form onSubmit={handleSubmit} noValidate className="campaign-content">
          <button type="button" onClick={() => window.history.back()} className="campaign-back">
            <ArrowLeft size={16} /> Back
          </button>

          <div className="campaign-header">
            <h1 className="campaign-title">Customize Your Campaign</h1>
            <p className="campaign-subtitle">Tell us about your promotion needs</p>
          </div>

          {/* Business Info */}
          <button type="button" className="campaign-section-toggle" onClick={() => toggleSection("business")} aria-expanded={openSection === "business"}>
            <User size={14} color="#F2701D" />
            <span>Business Information</span>
            <span className="campaign-chev-spacer"></span>
            <ChevronDown size={16} className={"campaign-chev" + (openSection === "business" ? " open" : "")} />
          </button>
          <div className={"campaign-collapse" + (openSection === "business" ? " open" : "")}>
            <div className="campaign-collapse-inner">
              <div className="btl-form-grid campaign-grid">
                <div className="campaign-field">
                  <label className="campaign-label">Business Name *</label>
                  <input name="businessName" value={formData.businessName} onChange={handleChange} onBlur={handleBlur} className="campaign-input" placeholder="e.g., Green Valley Residences" required />
                  {touched.businessName && formErrors.businessName && <p className="campaign-error">{formErrors.businessName}</p>}
                </div>
                <div className="campaign-field">
                  <label className="campaign-label">Contact Person *</label>
                  <input name="contactName" value={formData.contactName} onChange={handleChange} onBlur={handleBlur} className="campaign-input" placeholder="Full name" required />
                  {touched.contactName && formErrors.contactName && <p className="campaign-error">{formErrors.contactName}</p>}
                </div>
                <div className="campaign-field">
                  <label className="campaign-label">Email *</label>
                  <input name="email" type="email" value={formData.email} onChange={handleChange} onBlur={handleBlur} className="campaign-input" placeholder="you@company.com" required />
                  {touched.email && formErrors.email && <p className="campaign-error">{formErrors.email}</p>}
                </div>
                <div className="campaign-field">
                  <label className="campaign-label">Phone *</label>
                  <input name="phone" type="tel" value={formData.phone} onChange={handleChange} onBlur={handleBlur} className="campaign-input" placeholder="+91 98765 43210" required />
                  {touched.phone && formErrors.phone && <p className="campaign-error">{formErrors.phone}</p>}
                </div>
              </div>
            </div>
          </div>

          {/* Campaign Details */}
          <button type="button" className="campaign-section-toggle" onClick={() => toggleSection("details")} aria-expanded={openSection === "details"}>
            <MapPin size={14} color="#F2701D" />
            <span>Campaign Details</span>
            <span className="campaign-chev-spacer"></span>
            <ChevronDown size={16} className={"campaign-chev" + (openSection === "details" ? " open" : "")} />
          </button>
          <div className={"campaign-collapse" + (openSection === "details" ? " open" : "")}>
            <div className="campaign-collapse-inner">
              <div className="btl-form-grid campaign-grid">
              <div className="campaign-field">
                <label className="campaign-label">Pincode / Area *</label>
                <input name="pincode" value={formData.pincode} onChange={handleChange} onBlur={handleBlur} className="campaign-input" placeholder="e.g., 560034" required />
                {touched.pincode && formErrors.pincode && <p className="campaign-error">{formErrors.pincode}</p>}
              </div>
              <div className="campaign-field">
                <label className="campaign-label">Zone Name</label>
                <input name="zone" value={formData.zone} onChange={handleChange} className="campaign-input" placeholder="e.g., Koramangala" />
              </div>
              <div className="campaign-field">
                <label className="campaign-label">Category *</label>
                <p className="campaign-hint">
                  Select as many as apply — anything you picked in the Marketing Tool comes pre-selected.
                </p>
                <div className="campaign-chips" role="group" aria-label="Campaign categories">
                  {categoryOptions.map((cat) => {
                    const active = Array.isArray(formData.category) && formData.category.includes(cat);
                    return (
                      <button
                        type="button"
                        key={cat}
                        className={"campaign-chip" + (active ? " active" : "")}
                        aria-pressed={active}
                        onClick={() => toggleCategory(cat)}
                      >
                        <span className="campaign-chip-mark" aria-hidden="true">{active ? "✓" : "+"}</span>
                        {CATEGORY_ICONS[cat] ? `${CATEGORY_ICONS[cat]} ` : ""}
                        {cat}
                      </button>
                    );
                  })}
                </div>
                {touched.category && formErrors.category && <p className="campaign-error">{formErrors.category}</p>}
              </div>
              <div className="campaign-field">
                <label className="campaign-label">Number of Locations *</label>
                <input name="locations" type="number" min="1" value={formData.locations} onChange={handleChange} onBlur={handleBlur} className="campaign-input" placeholder="e.g., 10" required />
                {touched.locations && formErrors.locations && <p className="campaign-error">{formErrors.locations}</p>}
              </div>
              <div className="campaign-field">
                <label className="campaign-label">Radius (km)</label>
                <select name="radius" value={formData.radius} onChange={handleChange} className="campaign-input campaign-select">
                  <option value="1">1 km</option>
                  <option value="2">2 km</option>
                  <option value="5">5 km</option>
                  <option value="10">10 km</option>
                </select>
              </div>
              <div className="campaign-field">
                <label className="campaign-label">Duration</label>
                <select name="duration" value={formData.duration} onChange={handleChange} className="campaign-input campaign-select">
                  <option value="1 week">1 Week</option>
                  <option value="2 weeks">2 Weeks</option>
                  <option value="1 month">1 Month</option>
                  <option value="2 months">2 Months</option>
                  <option value="3 months">3 Months</option>
                  <option value="6 months">6 Months</option>
                  <option value="12 months">12 Months</option>
                </select>
              </div>
              <div className="campaign-field">
                <label className="campaign-label">Preferred Start Date</label>
                <input name="startDate" type="date" value={formData.startDate} onChange={handleChange} className="campaign-input" />
              </div>
              <div className="campaign-field">
                <label className="campaign-label">Budget (₹)</label>
                <input name="budget" type="number" value={formData.budget} onChange={handleChange} className="campaign-input" placeholder="Optional" />
              </div>
              </div>
            </div>
          </div>

          {/* Additional Notes - Full Width */}
          <button type="button" className="campaign-section-toggle" onClick={() => toggleSection("notes")} aria-expanded={openSection === "notes"}>
            <FileText size={14} color="#F2701D" />
            <span>Additional Notes</span>
            <span className="campaign-chev-spacer"></span>
            <ChevronDown size={16} className={"campaign-chev" + (openSection === "notes" ? " open" : "")} />
          </button>
          <div className={"campaign-collapse" + (openSection === "notes" ? " open" : "")}>
            <div className="campaign-collapse-inner">
              <div className="campaign-field">
                <label className="campaign-label">Notes</label>
                <textarea
                  name="message"
                  value={formData.message}
                  onChange={handleChange}
                  className="campaign-input campaign-textarea"
                  placeholder="Any special requirements or notes for your campaign..."
                  rows={4}
                />
              </div>
            </div>
          </div>

          <button type="submit" className="campaign-cta" disabled={!allValid}>
            Submit <ArrowLeft size={16} style={{ transform: "rotate(180deg)" }} />
          </button>
        </form>
      ) : (
        /* ===== SUCCESS CONFIRMATION ===== */
        <div className="success-content">
          <div className="success-icon">
            <CheckCircle size={32} />
          </div>

          <h1 className="success-title">Request Submitted</h1>
          <p className="success-description">
            Your campaign request has been submitted successfully. Our team will review your requirements and contact you shortly.
          </p>

          <div className="section-label">Request Summary</div>
          <div className="request-summary">
            <div className="summary-row">
              <span className="summary-label">Business</span>
              <span className="summary-value">{formData.businessName}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Category</span>
              <span className="summary-value">
                {Array.isArray(formData.category) ? formData.category.join(", ") : formData.category}
              </span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Locations</span>
              <span className="summary-value">{formData.locations}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Pincode</span>
              <span className="summary-value">{formData.pincode}</span>
            </div>
          </div>

          <div className="section-label">What Happens Next?</div>
          <div className="next-steps">
            <div className="next-step">
              <span className="next-step-number">1</span>
              <span>Our team reviews your request</span>
            </div>
            <div className="next-step">
              <span className="next-step-number">2</span>
              <span>We contact you with campaign options</span>
            </div>
            <div className="next-step">
              <span className="next-step-number">3</span>
              <span>You confirm and proceed</span>
            </div>
          </div>

          <div className="success-actions">
            <button className="back-home-btn" onClick={() => window.location.href = "/"}>
              Back to Home
            </button>
            <button className="submit-another-btn" onClick={() => { setSubmitted(false); setFormData(defaultFormData(selectedLocations)); }}>
              Submit Another Request
            </button>
          </div>

          <div className="support-link">
            Need help? <span className="support-highlight">Contact support</span>
          </div>
        </div>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Inter', sans-serif; background: #f8f7f4; }

        /* No enclosing card — the warm page background IS the surface, so the
           form reads as a clean continuation of the checkout flow. */
        .campaign-page { background: #f8f7f4; min-height: 100vh; }
        .campaign-content {
          width: 100%;
          max-width: 480px;
          margin: 0 auto;
          padding: 24px 16px 40px;
        }

        /* Lightweight text back action — no button box. */
        .campaign-back {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 14px;
          font-weight: 500;
          color: #8A8377;
          background: none;
          border: none;
          cursor: pointer;
          padding: 0;
          margin-bottom: 18px;
          font-family: inherit;
        }

        .campaign-title { font-size: 26px; line-height: 1.15; font-weight: 700; color: #161616; }
        .campaign-subtitle { margin-top: 5px; font-size: 14px; color: #8A8377; }

        .campaign-section-toggle {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          margin: 28px 0 14px;
          padding: 0;
          border: none;
          background: none;
          cursor: pointer;
          font-family: inherit;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.08em;
          color: #4A4A4A;
          text-transform: uppercase;
          text-align: left;
        }
        .campaign-chev-spacer { flex: 1; }
        .campaign-chev { transition: transform 0.2s ease; color: #8A8377; }
        .campaign-chev.open { transform: rotate(180deg); }

        /* Smooth open/close: rows animate from 0fr to 1fr so the section
           height eases instead of popping in/out. The inner is un-focusable +
           removed from the a11y tree while collapsed (visibility flips after
           the height animation finishes). */
        .campaign-collapse {
          display: grid;
          grid-template-rows: 0fr;
          transition: grid-template-rows 0.3s ease;
        }
        .campaign-collapse.open {
          grid-template-rows: 1fr;
        }
        .campaign-collapse-inner {
          overflow: hidden;
          min-height: 0;
        }
        .campaign-collapse:not(.open) .campaign-collapse-inner {
          visibility: hidden;
          transition: visibility 0s linear 0.3s;
        }
        .campaign-collapse.open .campaign-collapse-inner {
          visibility: visible;
          transition: visibility 0s linear 0s;
        }

        .campaign-field { display: flex; flex-direction: column; gap: 7px; }
        .campaign-field input,
        .campaign-field select { min-width: 0; }
        .campaign-label { font-size: 14px; font-weight: 500; color: #161616; }

        /* Inputs stay white so they stand off the warm background. Same 54px
           touch targets, radius and focus ring as the checkout fields. */
        .campaign-input {
          width: 100%;
          min-height: 54px;
          padding: 0 14px;
          background: #fff;
          border: 1px solid #E7E2D8;
          border-radius: 12px;
          font-size: 16px;
          color: #161616;
          font-family: inherit;
          box-sizing: border-box;
          outline: none;
        }
        .campaign-input:focus {
          border-color: #F2701D;
          box-shadow: 0 0 0 3px rgba(242, 112, 29, 0.12);
        }
        .campaign-input::placeholder { color: #B9B3A6; }
        .campaign-input.campaign-textarea {
          min-height: 108px;
          padding: 12px 14px;
          resize: vertical;
          line-height: 1.5;
        }

        /* Category is a multi-select — chips toggle independently so one
           campaign can target several catchments at once. Warm-neutral rest
           state, orange when ticked, matching the admin pill language. */
        .campaign-hint {
          font-size: 12px;
          line-height: 1.45;
          color: #8A8377;
        }
        .campaign-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .campaign-chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          min-height: 40px;
          padding: 8px 13px;
          box-sizing: border-box;
          border: 1.5px solid #E7E2D8;
          border-radius: 999px;
          background: #fff;
          color: #4A4A4A;
          font-family: inherit;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
        }
        .campaign-chip:hover { border-color: #D8CFC0; }
        .campaign-chip.active {
          border-color: #F2701D;
          background: #FFF4EC;
          color: #C2410C;
        }
        .campaign-chip:focus-visible {
          outline: none;
          border-color: #F2701D;
          box-shadow: 0 0 0 3px rgba(242, 112, 29, 0.12);
        }
        .campaign-chip-mark {
          font-size: 12px;
          line-height: 1;
          opacity: 0.7;
        }

        /* Inline field errors — shown right under the offending input. */
        .campaign-error {
          font-size: 12px;
          color: #C0392B;
          margin-top: 5px;
        }

        /* Full-width primary action, consistent with checkout. */
        .campaign-cta {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          width: 100%;
          min-height: 56px;
          border: none;
          border-radius: 12px;
          background: #F2701D;
          color: #fff;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          margin-top: 24px;
        }
        .campaign-cta:disabled { background: #DED8CF !important; color: #fff !important; cursor: not-allowed; }
        .campaign-cta:active:not(:disabled) { transform: translateY(1px); }

        /* Field rhythm matches the checkout form (16px) on phones. */
        @media (max-width: 768px) {
          .campaign-grid { gap: 16px !important; }
        }
        /* Desktop: same no-card principle, wider column and more air above. */
        @media (min-width: 769px) {
          .campaign-content { max-width: 720px; padding-top: 40px; }
        }

        /* ---- Success confirmation ------------------------------------------
           Premium, minimal booking-style confirmation. No big card wrapping the
           whole screen — the warm page background carries the layout. */
        .success-content {
          width: 100%;
          max-width: 440px;
          margin: 0 auto;
          padding: 40px 18px 36px;
          box-sizing: border-box;
        }

        .success-icon {
          width: 72px;
          height: 72px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto;
          background: #E8F8EE;
          color: #16a34a;
          animation: successPop 0.25s ease-out;
        }
        .success-icon svg { width: 32px; height: 32px; }
        @keyframes successPop {
          from { opacity: 0; transform: scale(0.88); }
          to { opacity: 1; transform: scale(1); }
        }

        .success-title {
          margin-top: 22px;
          margin-bottom: 0;
          font-size: 26px;
          line-height: 1.2;
          font-weight: 700;
          color: #161616;
          text-align: center;
        }

        .success-description {
          max-width: 340px;
          margin: 10px auto 0;
          font-size: 15px;
          line-height: 1.6;
          color: #8A8377;
          text-align: center;
        }

        .section-label {
          margin-top: 28px;
          margin-bottom: 10px;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.08em;
          color: #4A4A4A;
          text-transform: uppercase;
        }

        .request-summary {
          background: #fff;
          border: 1px solid #E7E2D8;
          border-radius: 16px;
          padding: 8px 18px;
        }
        .summary-row {
          min-height: 46px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          min-width: 0;
          border-bottom: 1px solid #F1EAE2;
        }
        .summary-row:last-child { border-bottom: none; }
        .summary-label {
          font-size: 13px;
          color: #8A8377;
          flex-shrink: 0;
        }
        .summary-value {
          font-size: 14px;
          font-weight: 600;
          color: #161616;
          text-align: right;
          word-break: break-word;
        }

        .next-steps {
          margin-top: 18px;
          padding: 16px;
          background: #FFF8F2;
          border: 1px solid #F1E5DA;
          border-radius: 14px;
        }
        .next-step {
          display: flex;
          align-items: center;
          gap: 12px;
          min-height: 42px;
          font-size: 14px;
          color: #4A4A4A;
        }
        .next-step-number {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          background: #FFEFE0;
          color: #F2701D;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          font-size: 13px;
          font-weight: 600;
        }

        .success-actions {
          display: flex;
          align-items: stretch;
          gap: 10px;
          width: 100%;
          margin-top: 22px;
        }
        .back-home-btn,
        .submit-another-btn {
          flex: 1;
          min-height: 54px;
          display: flex;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 0 12px;
          box-sizing: border-box;
          border-radius: 12px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
        }
        .back-home-btn {
          border: none;
          background: #F2701D;
          color: #fff;
        }
        .back-home-btn:active { transform: translateY(1px); }
        .submit-another-btn {
          border: 1px solid #E7E2D8;
          background: #fff;
          color: #4A4A4A;
          font-size: 13px;
        }

        .support-link {
          margin-top: 18px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          font-size: 13px;
          color: #8A8377;
        }
        .support-highlight { color: #F2701D; font-weight: 600; cursor: pointer; }

        @media (max-width: 350px) {
          .success-actions { gap: 8px; }
          .back-home-btn,
          .submit-another-btn {
            font-size: 12px;
            padding-left: 8px;
            padding-right: 8px;
          }
        }
        @media (min-width: 769px) {
          .success-content { max-width: 520px; padding-top: 56px; }
        }
      `}</style>
    </div>
  );
};

const styles = {
  page: {
    minHeight: "100vh",
    background: "#f8f7f4",
    fontFamily: "'Inter', sans-serif",
  },
  header: {
    background: "#fff",
    borderBottom: "1px solid #E7E2D8",
    position: "sticky",
    top: 0,
    zIndex: 50,
  },
  headerInner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  logo: { display: "flex", alignItems: "center", gap: 10, textDecoration: "none" },
  logoIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    background: "#F2701D",
    color: "#fff",
    fontSize: 14,
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  logoText: { fontSize: 16, fontWeight: 700, color: "#161616" },
};

export default CustomerForm;