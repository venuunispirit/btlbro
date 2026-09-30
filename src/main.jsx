import React, { useState, useCallback, useEffect } from "react";
import ReactDOM from "react-dom/client";
import Navbar from "./components/Navbar.jsx";
import App from "./pages/Landing.jsx";
import AdminPanel from "./pages/admin/AdminPanel.jsx";
import CustomerForm from "./pages/CustomerForm.jsx";
import QuickCheckout from "./pages/QuickCheckout.jsx";
import ProductsPage from "./pages/ProductsPage.jsx";
import ShopCheckout from "./pages/ShopCheckout.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import ReceeScreen from "./pages/ReceeScreen.jsx";
import VendorPortal from "./pages/VendorPortal.jsx";
import { getUser } from "./services/shopClient.js";

function useGlobalCart() {
  const [cartCount, setCartCount] = useState(() => {
    try { return JSON.parse(localStorage.getItem("btl_cart") || "[]").length; } catch { return 0; }
  });
  useEffect(() => {
    const handler = (e) => { setCartCount(e.detail?.count ?? 0); };
    window.addEventListener("btl-cart-change", handler);
    return () => window.removeEventListener("btl-cart-change", handler);
  }, []);
  return cartCount;
}

function useLocation() {
  const [loc, setLoc] = useState({ path: window.location.pathname, search: window.location.search });
  useEffect(() => {
    const onPop = () => setLoc({ path: window.location.pathname, search: window.location.search });
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return loc;
}

function navigate(path) {
  if (window.location.pathname === path) return;
  window.history.pushState(null, "", path);
  window.dispatchEvent(new Event("popstate"));
}

function Router() {
  const { path, search } = useLocation();
  const urlTab = new URLSearchParams(search).get("tab");
  const [activeTab, setActiveTab] = useState(urlTab || "marketing");
  const cartCount = useGlobalCart();

  useEffect(() => {
    if (urlTab) setActiveTab(urlTab);
  }, [urlTab]);

  const handleCartClick = useCallback(() => {
    window.dispatchEvent(new CustomEvent("btl-open-cart"));
  }, []);

  // Login redirects by account: recee team → /recee, other staff → /dashboard
  const handleNavigate = useCallback((p) => {
    navigate(p);
  }, []);
  if (path === "/login") {
    return <LoginPage onNavigate={handleNavigate} />;
  }
  // Vendors have their own identity (/api/vendors/*), so this route renders
  // before the staff gate and never inspects getUser() — a vendor is neither
  // a team member nor a customer.
  if (path === "/vendor") {
    return <VendorPortal />;
  }
  if (path === "/recee") {
    return <ReceeScreen onNavigate={handleNavigate} />;
  }
  if (path === "/dashboard" || path === "/admin") {
    const user = getUser();
    if (user && user.is_team) {
      if (user.role === "recee") {
        return <ReceeScreen onNavigate={handleNavigate} />;
      }
      return <AdminPanel />;
    }
    return <Dashboard onNavigate={handleNavigate} />;
  }

  const hideNavbar = path === "/customize" || path === "/checkout" || path === "/shop/checkout";
  const page = path === "/products" ? "products" : "landing";

  return (
    <>
      {!hideNavbar && (
        <Navbar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          page={page}
          cartCount={cartCount}
          onCartClick={handleCartClick}
          onNavigate={handleNavigate}
        />
      )}
      {path === "/customize" && <CustomerForm />}
      {path === "/checkout" && <QuickCheckout />}
      {path === "/products" && <ProductsPage />}
      {path === "/shop/checkout" && <ShopCheckout />}
      {(!path || path === "/") && <App activeTab={activeTab} setActiveTab={setActiveTab} />}
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Router />
  </React.StrictMode>
);
