import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { getUser as getSessionUser, getCart, mergeGuestCart, addToCart as apiAddToCart, removeFromCart as apiRemoveFromCart } from "../services/shopClient.js";
import CartDrawer from "./CartDrawer.jsx";

/* ============================================================
   BTLbro — global cart
   Lives above the router so the navbar cart button opens the
   drawer on every tab (Marketing Tool / Website / Products).
   Guest carts persist in localStorage `btl_cart`; signed-in
   carts are mirrored to /api/shop/cart.
   ============================================================ */

const CartContext = createContext(null);

function readGuestCart() {
  try {
    const parsed = JSON.parse(localStorage.getItem("btl_cart") || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

export function CartProvider({ children }) {
  const [items, setItems] = useState(readGuestCart);
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState(() => getSessionUser());

  useEffect(() => {
    const onAuth = (e) => setUser(e.detail?.user ?? null);
    window.addEventListener("btl-auth-change", onAuth);
    return () => window.removeEventListener("btl-auth-change", onAuth);
  }, []);

  // On sign-in, fold any guest cart into the account cart.
  useEffect(() => {
    if (!user) return;
    const guest = readGuestCart();
    if (guest.length === 0) {
      getCart().then((d) => setItems(d.cart || [])).catch(() => {});
      return;
    }
    mergeGuestCart(guest)
      .then((r) => { if (r.cart) setItems(r.cart); })
      .catch(() => {
        getCart().then((d) => setItems([...guest, ...(d.cart || [])])).catch(() => {});
      });
  }, [user?.id]);

  useEffect(() => {
    if (!user) localStorage.setItem("btl_cart", JSON.stringify(items));
    window.dispatchEvent(new CustomEvent("btl-cart-change", { detail: { count: items.length } }));
  }, [items, user]);

  useEffect(() => {
    const openDrawer = () => setOpen(true);
    window.addEventListener("btl-open-cart", openDrawer);
    return () => window.removeEventListener("btl-open-cart", openDrawer);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open]);

  const addItem = useCallback(async (item) => {
    setItems((prev) => {
      const next = [...prev.filter((i) => i.key !== item.key), item];
      if (!getSessionUser()) localStorage.setItem("btl_cart", JSON.stringify(next));
      return next;
    });
    if (user) { try { await apiAddToCart(item); } catch { /* stays local until next sync */ } }
  }, [user]);

  const removeItem = useCallback(async (key) => {
    setItems((prev) => {
      const next = prev.filter((i) => i.key !== key);
      if (!getSessionUser()) localStorage.setItem("btl_cart", JSON.stringify(next));
      return next;
    });
    if (user) { try { await apiRemoveFromCart(key); } catch {} }
  }, [user]);

  const clearCart = useCallback(() => {
    setItems([]);
    if (!getSessionUser()) localStorage.removeItem("btl_cart");
  }, []);

  const value = {
    items,
    count: items.length,
    open,
    setOpen,
    openCart: () => setOpen(true),
    addItem,
    removeItem,
    clearCart,
    user,
    checkout: () => {
      // Guests must sign in first — the navbar auth modal handles that, and
      // it is the only modal mounted on every tab.
      if (!getSessionUser()) {
        setOpen(false);
        window.dispatchEvent(new CustomEvent("btl-request-auth"));
        return;
      }
      setOpen(false);
      sessionStorage.setItem("btl_shop_checkout", JSON.stringify({ items }));
      window.location.href = "/shop/checkout";
    },
  };

  return (
    <CartContext.Provider value={value}>
      {children}
      {open && (
        <CartDrawer
          items={items}
          onClose={() => setOpen(false)}
          onRemove={removeItem}
          onCheckout={value.checkout}
        />
      )}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside <CartProvider>");
  return ctx;
}
