import React, { useState } from "react";
import {
  MapPin,
  Target,
  FileText,
  CheckCircle,
  ArrowLeft,
  User,
  Phone,
  Mail,
  Building2,
} from "lucide-react";

const CustomerForm = () => {
  const [submitted, setSubmitted] = useState(false);
  const [formData, setFormData] = useState({
    businessName: "",
    contactName: "",
    email: "",
    phone: "",
    pincode: "",
    zone: "",
    category: "Apartments",
    locations: "",
    radius: "5",
    budget: "",
    startDate: "",
    duration: "1 month",
    message: "",
  });

  function handleChange(e) {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!formData.businessName || !formData.contactName || !formData.email || !formData.phone || !formData.pincode || !formData.locations) {
      alert("Please fill all required fields");
      return;
    }
    // Save submission to admin
    const newOrder = {
      ...formData,
      status: "pending",
      read: false,
      submittedAt: new Date().toISOString(),
    };
    // Save to the server DB (only place it is stored)
    fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newOrder),
    }).catch(() => { /* server offline — request could not be saved */ });
    setSubmitted(true);
  }

  return (
    <div style={styles.page}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerInner}>
          <div style={styles.logo}>
            <div style={styles.logoIcon}>B</div>
            <span style={styles.logoText}>BTL Bro</span>
          </div>
        </div>
      </header>

      <div style={styles.container}>
        {/* ===== FORM ===== */}
        {!submitted ? (
          <form onSubmit={handleSubmit} style={styles.formCard}>
            <button type="button" onClick={() => window.history.back()} style={styles.backLink}>
              <ArrowLeft size={16} /> Back
            </button>
            <div style={styles.formHeader}>
              <Target size={28} color="#F2701D" />
              <div>
                <h1 style={styles.formTitle}>Customize Your Campaign</h1>
                <p style={styles.formSubtitle}>Tell us about your promotion needs</p>
              </div>
            </div>

            {/* Business Info */}
            <div style={styles.sectionLabel}>
              <User size={16} color="#F2701D" />
              <span>Business Information</span>
            </div>
            <div style={styles.formGrid}>
              <div style={styles.field}>
                <label style={styles.label}>Business Name *</label>
                <input name="businessName" value={formData.businessName} onChange={handleChange} style={styles.input} placeholder="e.g., Green Valley Residences" required />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Contact Person *</label>
                <input name="contactName" value={formData.contactName} onChange={handleChange} style={styles.input} placeholder="Full name" required />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Email *</label>
                <input name="email" type="email" value={formData.email} onChange={handleChange} style={styles.input} placeholder="you@company.com" required />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Phone *</label>
                <input name="phone" type="tel" value={formData.phone} onChange={handleChange} style={styles.input} placeholder="+91 98765 43210" required />
              </div>
            </div>

            {/* Campaign Details */}
            <div style={styles.sectionLabel}>
              <MapPin size={16} color="#F2701D" />
              <span>Campaign Details</span>
            </div>
            <div style={styles.formGrid}>
              <div style={styles.field}>
                <label style={styles.label}>Pincode / Area *</label>
                <input name="pincode" value={formData.pincode} onChange={handleChange} style={styles.input} placeholder="e.g., 560034" required />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Zone Name</label>
                <input name="zone" value={formData.zone} onChange={handleChange} style={styles.input} placeholder="e.g., Koramangala" />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Category *</label>
                <select name="category" value={formData.category} onChange={handleChange} style={styles.input}>
                  <option value="Apartments">🏢 Apartments</option>
                  <option value="Cafés">☕ Cafés</option>
                  <option value="Restaurants">🍽️ Restaurants</option>
                  <option value="Schools">🎓 Schools</option>
                  <option value="Hospitals">🏥 Hospitals</option>
                  <option value="Malls & Retail">🛍️ Malls & Retail</option>
                  <option value="Offices">💼 Offices</option>
                  <option value="Parks & Leisure">🌳 Parks & Leisure</option>
                </select>
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Number of Locations *</label>
                <input name="locations" type="number" min="1" value={formData.locations} onChange={handleChange} style={styles.input} placeholder="e.g., 10" required />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Radius (km)</label>
                <select name="radius" value={formData.radius} onChange={handleChange} style={styles.input}>
                  <option value="1">1 km</option>
                  <option value="2">2 km</option>
                  <option value="5">5 km</option>
                  <option value="10">10 km</option>
                </select>
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Duration</label>
                <select name="duration" value={formData.duration} onChange={handleChange} style={styles.input}>
                  <option value="1 week">1 Week</option>
                  <option value="2 weeks">2 Weeks</option>
                  <option value="1 month">1 Month</option>
                  <option value="2 months">2 Months</option>
                  <option value="3 months">3 Months</option>
                  <option value="6 months">6 Months</option>
                  <option value="12 months">12 Months</option>
                </select>
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Preferred Start Date</label>
                <input name="startDate" type="date" value={formData.startDate} onChange={handleChange} style={styles.input} />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Budget (₹)</label>
                <input name="budget" type="number" value={formData.budget} onChange={handleChange} style={styles.input} placeholder="Optional" />
              </div>
            </div>

            {/* Additional Notes - Full Width */}
            <div style={styles.sectionLabel}>
              <FileText size={16} color="#F2701D" />
              <span>Additional Notes</span>
            </div>
            <div style={styles.field}>
              <textarea
                name="message"
                value={formData.message}
                onChange={handleChange}
                style={styles.textarea}
                placeholder="Any special requirements or notes for your campaign..."
                rows={4}
              />
            </div>

            <button type="submit" style={styles.primaryBtn}>
              Submit <ArrowLeft size={16} style={{ transform: "rotate(180deg)" }} />
            </button>
          </form>
        ) : (
          /* ===== THANK YOU ===== */
          <div style={{ ...styles.formCard, textAlign: "center", padding: "60px 32px" }}>
            <div style={{ width: 90, height: 90, borderRadius: "50%", background: "#dcfce7", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px" }}>
              <CheckCircle size={44} color="#16a34a" />
            </div>
            <h1 style={{ fontSize: 26, fontWeight: 700, color: "#161616", marginBottom: 12 }}>Thank You! 🎉</h1>
            <p style={{ fontSize: 16, color: "#656565", marginBottom: 8, lineHeight: 1.6 }}>
              Your campaign request has been submitted successfully.
            </p>
            <p style={{ fontSize: 15, color: "#656565", marginBottom: 32, lineHeight: 1.6 }}>
              Our team will review your requirements and contact you shortly to discuss the details.
            </p>

            <div style={{ padding: "20px 24px", background: "#FAF9F7", borderRadius: 12, textAlign: "left", marginBottom: 32, maxWidth: 400, margin: "0 auto 32px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, fontSize: 13 }}>
                <div>
                  <p style={{ color: "#949494", marginBottom: 2 }}>Business</p>
                  <p style={{ fontWeight: 600, color: "#161616" }}>{formData.businessName}</p>
                </div>
                <div>
                  <p style={{ color: "#949494", marginBottom: 2 }}>Category</p>
                  <p style={{ fontWeight: 600, color: "#161616" }}>{formData.category}</p>
                </div>
                <div>
                  <p style={{ color: "#949494", marginBottom: 2 }}>Locations</p>
                  <p style={{ fontWeight: 600, color: "#161616" }}>{formData.locations}</p>
                </div>
                <div>
                  <p style={{ color: "#949494", marginBottom: 2 }}>Pincode</p>
                  <p style={{ fontWeight: 600, color: "#161616" }}>{formData.pincode}</p>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <button onClick={() => window.location.href = "/"} style={styles.primaryBtn}>
                Back to Home
              </button>
              <button onClick={() => { setSubmitted(false); setFormData({ businessName: "", contactName: "", email: "", phone: "", pincode: "", zone: "", category: "Apartments", locations: "", radius: "5", budget: "", startDate: "", duration: "1 month", message: "" }); }} style={styles.secondaryBtn}>
                Submit Another Request
              </button>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Inter', sans-serif; background: #f5f5f5; }
      `}</style>
    </div>
  );
};

const styles = {
  page: {
    minHeight: "100vh",
    background: "#f5f5f5",
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
    maxWidth: 720,
    margin: "0 auto",
    padding: "14px 24px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  logo: { display: "flex", alignItems: "center", gap: 10 },
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
  container: {
    maxWidth: 720,
    margin: "32px auto",
    padding: "0 24px",
  },
  formCard: {
    background: "#fff",
    borderRadius: 16,
    padding: 32,
    boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
    border: "1px solid #E7E2D8",
  },
  backLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 13,
    fontWeight: 500,
    color: "#949494",
    textDecoration: "none",
    marginBottom: 16,
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: 0,
    fontFamily: "'Inter', sans-serif",
  },
  formHeader: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    marginBottom: 28,
  },
  formTitle: { fontSize: 22, fontWeight: 700, color: "#161616" },
  formSubtitle: { fontSize: 14, color: "#949494", marginTop: 2 },
  sectionLabel: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    fontWeight: 600,
    color: "#4A4A4A",
    marginBottom: 12,
    marginTop: 16,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  formGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 14,
    marginBottom: 8,
  },
  field: { display: "grid", gap: 4, marginBottom: 8 },
  label: { fontSize: 13, fontWeight: 600, color: "#4A4A4A" },
  input: {
    padding: "11px 14px",
    border: "1.5px solid #E7E2D8",
    borderRadius: 8,
    fontSize: 14,
    outline: "none",
    fontFamily: "'Inter', sans-serif",
    color: "#161616",
    background: "#FAF9F7",
  },
  textarea: {
    padding: "12px 14px",
    border: "1.5px solid #E7E2D8",
    borderRadius: 8,
    fontSize: 14,
    outline: "none",
    fontFamily: "'Inter', sans-serif",
    color: "#161616",
    background: "#FAF9F7",
    width: "100%",
    resize: "vertical",
    minHeight: 100,
  },
  primaryBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: "14px 28px",
    background: "#F2701D",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
    width: "100%",
    marginTop: 20,
  },
  secondaryBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: "14px 20px",
    background: "#fff",
    color: "#4A4A4A",
    border: "1.5px solid #E7E2D8",
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
    width: "100%",
    marginTop: 8,
  },
};

export default CustomerForm;
