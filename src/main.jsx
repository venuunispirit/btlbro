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

  const handleNavigate = useCallback((p) => {
    navigate(p);
  }, []);

  if (path === "/admin") {
    return <AdminPanel />;
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
      {path === "/dashboard" && <Dashboard onNavigate={handleNavigate} />}
      {(!path || path === "/") && <App activeTab={activeTab} setActiveTab={setActiveTab} />}
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Router />
  </React.StrictMode>
);
