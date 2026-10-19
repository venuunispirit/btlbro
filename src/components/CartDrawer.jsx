import React from "react";
import { ShoppingCart, X, Trash2, FileText } from "lucide-react";

/* ============================================================
   BTLbro — Cart drawer
   Rendered once by CartProvider at the app root, so the navbar
   cart button works on every tab (Marketing Tool / Website /
   Products). Owns its CSS so it does not depend on the page
   that happens to be mounted.
   ============================================================ */

const fmt = (n) => `₹${Math.round(n || 0).toLocaleString("en-IN")}`;

export default function CartDrawer({ items, onClose, onRemove, onCheckout }) {
  const subtotal = items.reduce((s, i) => s + (i.unit_price || 0) * (i.qty || 1), 0);
  return (
    <>
      <style>{CART_CSS}</style>
      <div className="cart-overlay" onClick={onClose}>
        <div className="cart-drawer" onClick={(e) => e.stopPropagation()}>
          <div className="cart-head">
            <h3><ShoppingCart size={17} /> Your Cart ({items.length})</h3>
            <button onClick={onClose} aria-label="Close cart"><X size={18} /></button>
          </div>
          {items.length === 0 ? (
            <div className="cart-empty">
              <div className="cart-empty-icon"><ShoppingCart size={26} /></div>
              Cart is empty. Customize a product to get started.
            </div>
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
                      <button className="cart-item-remove" onClick={() => onRemove(i.key)} aria-label={`Remove ${i.name}`}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="cart-foot">
                <div className="cart-subtotal"><span>Subtotal</span><strong>{fmt(subtotal)}</strong></div>
                <button className="cart-quote-btn" onClick={onCheckout}>
                  <ShoppingCart size={15} /> Checkout — Pay Securely
                </button>
                <button type="button" className="cart-ghost-btn" onClick={() => { onClose(); window.location.href = "/customize"; }}>
                  <FileText size={14} /> Request a Quote Instead
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

const CART_CSS = `
.cart-overlay { position: fixed; inset: 0; background: rgba(22,22,22,.35); z-index: 3000; display: flex; justify-content: flex-end; font-family: 'Inter', sans-serif; }
.cart-drawer { width: 380px; max-width: 92vw; background: #fff; height: 100%; display: flex; flex-direction: column; animation: cartIn .25s ease; }
@keyframes cartIn { from { transform: translateX(30px); opacity: 0; } to { transform: none; opacity: 1; } }
.cart-head { display: flex; justify-content: space-between; align-items: center; padding: 18px 20px; border-bottom: 1px solid #E7E2D8; }
.cart-head h3 { margin: 0; font-family: 'Manrope', sans-serif; font-size: 16px; display: flex; align-items: center; gap: 8px; color: #161616; }
.cart-head button { border: none; background: none; color: #949494; cursor: pointer; display: flex; }
.cart-head button:hover { color: #161616; }
.cart-empty { padding: 48px 24px; text-align: center; color: #949494; font-size: 13.5px; line-height: 1.6; }
.cart-empty-icon { color: #E7E2D8; margin-bottom: 10px; }
.cart-items { flex: 1; overflow-y: auto; padding: 12px 20px; }
.cart-item { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid #F0EDE8; }
.cart-item-icon { font-size: 26px; }
.cart-item-info { flex: 1; min-width: 0; }
.cart-item-name { font-weight: 600; font-size: 13.5px; color: #161616; }
.cart-item-meta { font-size: 11.5px; color: #949494; margin-top: 2px; }
.cart-item-right { text-align: right; flex-shrink: 0; }
.cart-item-price { font-weight: 700; font-size: 13.5px; color: #161616; }
.cart-item-remove { border: none; background: none; color: #949494; margin-top: 3px; cursor: pointer; }
.cart-item-remove:hover { color: #dc2626; }
.cart-foot { border-top: 1px solid #E7E2D8; padding: 16px 20px 20px; }
.cart-subtotal { display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 12px; }
.cart-quote-btn { display: flex; justify-content: center; align-items: center; gap: 8px; background: #F2701D; color: #fff; padding: 13px; border-radius: 999px; font-weight: 700; font-size: 14px; text-decoration: none; border: none; cursor: pointer; font-family: inherit; width: 100%; }
.cart-quote-btn:hover { background: #D8620F; }
.cart-ghost-btn { display: flex; justify-content: center; align-items: center; gap: 6px; background: none; border: none; color: #656565; font-weight: 600; font-size: 12.5px; text-decoration: none; cursor: pointer; padding: 8px 0 0; font-family: inherit; width: 100%; }
.cart-ghost-btn:hover { color: #F2701D; }
`;
