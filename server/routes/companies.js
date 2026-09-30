// Customer accounts (companies) — the CRM spine.
//
// A company is a customer business. Leads are the individual campaigns it
// submits; WhatsApp threads, calls and notes roll up into one timeline so a
// single drill-down answers "what is going on with this account".
//
// SCOPE: this is the RELATIONSHIP view. Money is deliberately NOT part of the
// timeline — reconciliation, outstanding balances and vendor payouts belong to
// the separate Accounts tab, which owns the ledger. The `payments` rollup below
// is still returned because the Accounts tab needs to know which movements
// belong to which company, but nothing here presents it as company data.
//
// The timeline is SYNTHESISED from every source rather than read from
// `lead.activities[]`. That array is lossy by design — chat text is truncated
// to 50 chars, and notes/assignments were never written to it at all. Trusting
// it alone would show a company a history that silently omits half the story.

import express from 'express';
import { dbHelpers } from '../db.js';
import { requireStaff } from '../middleware/staffAuth.js';

const router = express.Router();

// Accounts hold money and customer conversations, so they follow the same
// explicit allowlist as the payments ledger rather than the level-based
// requireManager (which would wave through bd_executive / ops_executive).
const ACCOUNT_ROLES = new Set(['manager', 'bdm', 'ops_manager', 'super_admin']);

// Roles allowed to see an account at all. Sales roles see the accounts they
// are working; ops and admins see everything.
const SALES_ROLES = new Set(['bd_executive', 'bdm']);

function scopeCompanies(req, companies) {
  const role = req.staff?.role || '';
  if (role === 'super_admin' || role === 'manager' || role === 'ops_manager') return companies;
  if (role === 'bd_executive' || role === 'bdm') {
    const leads = dbHelpers.getLeads();
    const mine = new Set(
      leads
        .filter((l) => {
          const cid = Number(l.company_id);
          if (!cid) return false;
          if (role === 'bd_executive') return Number(l.bd_exec_id) === Number(req.staff.id);
          return Number(l.bdm_id) === Number(req.staff.id) || !l.bdm_id;
        })
        .map((l) => Number(l.company_id))
    );
    return companies.filter((c) => mine.has(Number(c.id)));
  }
  return [];
}

function canSeeCompany(req, companyId) {
  if (!companyId) return false;
  return scopeCompanies(req, dbHelpers.getCompanies()).some((c) => Number(c.id) === Number(companyId));
}

// ------------------------------------------------------------- aggregation --

function leadsForCompany(companyId) {
  return dbHelpers.getLeads().filter((l) => Number(l.company_id) === Number(companyId));
}

// Payments reach a company two ways: explicitly linked, or via the lead that
// owns them. The manual "send/receive" movements in the Payments tab have no
// FK at all, so they are matched on the counterparty name against the
// company's dedupe key — best effort, and flagged as such in the payload.
function paymentsForCompany(company) {
  const linked = dbHelpers.getPayments().filter((p) => Number(p.company_id) === Number(company.id));
  const leadRefs = new Set(leadsForCompany(company.id).map((l) => l.payment_reference).filter(Boolean));
  const viaLead = dbHelpers.getPayments().filter(
    (p) => !p.company_id && p.reference && leadRefs.has(p.reference)
  );
  const seen = new Set([...linked, ...viaLead].map((p) => p.id));
  const byName = dbHelpers.getPayments().filter((p) => {
    if (seen.has(p.id) || p.company_id) return false;
    const key = dbHelpers.companyKey(p.counterparty_name);
    return !!key && key === company.name_key;
  });
  return {
    payments: [...linked, ...viaLead, ...byName],
    inferred: byName.map((p) => p.id),
  };
}

function conversationsForCompany(companyId) {
  const leadIds = new Set(leadsForCompany(companyId).map((l) => l.id));
  return dbHelpers.getConversations().filter((c) => leadIds.has(Number(c.lead_id)));
}

// Build one chronological history from every store. Each event carries a
// `source` so the UI can label where it came from, and `kind` for the icon.
function buildTimeline(company, { conversations }) {
  const events = [];
  const push = (e) => { if (e.at) events.push(e); };

  push({
    at: company.created_at, kind: 'company', source: 'companies',
    title: 'Account created', detail: company.name,
  });

  for (const lead of leadsForCompany(company.id)) {
    push({
      at: lead.created_at, kind: 'lead', source: 'leads', lead_id: lead.id,
      title: `Lead created (${lead.source || 'unknown'})`,
      detail: [lead.contactName, lead.category, lead.pincode && `PIN ${lead.pincode}`].filter(Boolean).join(' · '),
    });
    if (lead.assigned_at) {
      push({
        at: lead.assigned_at, kind: 'assignment', source: 'leads', lead_id: lead.id,
        title: 'Assigned to a BD Executive',
        detail: lead.assigned_by_name || (lead.assigned_by ? `by staff #${lead.assigned_by}` : ''),
      });
    }
    if (lead.ops_assigned_at) {
      push({
        at: lead.ops_assigned_at, kind: 'assignment', source: 'leads', lead_id: lead.id,
        title: 'Assigned to Operations',
        detail: lead.ops_assigned_by_name || (lead.ops_assigned_by ? `by staff #${lead.ops_assigned_by}` : ''),
      });
    }

    // Lead activities: status_change / cold. 'created' is already covered by
    // the lead's own created_at above, and chat/call are rebuilt from their
    // real stores below — showing them from here would duplicate every event.
    for (const a of lead.activities || []) {
      if (a.type === 'chat' || a.type === 'call' || a.type === 'created') continue;
      push({
        at: a.timestamp, kind: a.type || 'activity', source: 'activities', lead_id: lead.id,
        title: a.type === 'created' ? 'Lead created' : (a.type === 'status_change' ? 'Status changed' : a.type || 'Activity'),
        detail: a.description, actor: a.actor,
      });
    }

    for (const note of lead.notes || []) {
      push({
        at: note.timestamp, kind: 'note', source: 'notes', lead_id: lead.id,
        title: 'Note', detail: note.text, actor: note.author,
      });
    }
  }

  // Full chat text lives only in conversations[].messages[] — the activities
  // copy is truncated, so this is the authoritative thread.
  for (const conv of conversations) {
    for (const m of conv.messages || []) {
      if (m.direction === 'system') continue; // delivery receipts, not content
      push({
        at: m.timestamp, kind: 'chat', source: 'conversations',
        direction: m.direction,
        title: m.direction === 'in' ? 'WhatsApp received' : 'WhatsApp sent',
        detail: m.text, actor: m.sender_name || (m.direction === 'in' ? conv.customer_name : null),
      });
    }
  }

  events.sort((a, b) => new Date(a.at) - new Date(b.at));
  return events;
}

function moneyTotals(payments) {
  const sum = (rows) => rows.filter((p) => p.status === 'paid').reduce((n, p) => n + (Number(p.amount) || 0), 0);
  const incoming = payments.filter((p) => p.direction === 'in');
  const outgoing = payments.filter((p) => p.direction === 'out');
  const pending = payments.filter((p) => p.status === 'awaiting' || p.status === 'processing');
  return {
    received: sum(incoming),
    sent: sum(outgoing),
    pending_received: pending.filter((p) => p.direction === 'in').reduce((n, p) => n + (Number(p.amount) || 0), 0),
    pending_sent: pending.filter((p) => p.direction === 'out').reduce((n, p) => n + (Number(p.amount) || 0), 0),
    outstanding: sum(incoming) - sum(outgoing),
    count: payments.length,
  };
}

// ------------------------------------------------------------------ routes --

router.use(requireStaff);

// GET /api/admin/companies — account list with rollups
router.get('/', requireStaff, (req, res) => {
  try {
    const role = req.staff?.role || '';
    if (!ACCOUNT_ROLES.has(role) && !SALES_ROLES.has(role)) {
      return res.status(403).json({ error: 'Accounts access is limited to sales and admin roles' });
    }
    dbHelpers.backfillCompanies();

    const companies = scopeCompanies(req, dbHelpers.getCompanies());
    const enriched = companies
      .map((c) => {
        const leads = leadsForCompany(c.id);
        const { payments } = paymentsForCompany(c);
        return {
          ...c,
          lead_count: leads.length,
          lead_statuses: leads.map((l) => l.status),
          totals: moneyTotals(payments),
          last_activity_at: [
            c.updated_at,
            ...leads.map((l) => l.updated_at),
            ...payments.map((p) => p.updated_at),
          ].filter(Boolean).sort().slice(-1)[0] || c.created_at,
        };
      })
      .sort((a, b) => new Date(b.last_activity_at) - new Date(a.last_activity_at));

    res.set('Cache-Control', 'no-store');
    res.json({ companies: enriched, total: enriched.length });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load companies', details: error.message });
  }
});

// GET /api/admin/companies/:id — the drill-down
router.get('/:id', requireStaff, (req, res) => {
  try {
    const id = Number(req.params.id);
    const company = dbHelpers.getCompanyById(id);
    if (!company) return res.status(404).json({ error: 'Company not found' });
    if (!canSeeCompany(req, id)) return res.status(403).json({ error: 'You do not have access to this account' });

    const leads = leadsForCompany(id);
    const { payments, inferred } = paymentsForCompany(company);
    const conversations = conversationsForCompany(id);
    const timeline = buildTimeline(company, { conversations });

    res.set('Cache-Control', 'no-store');
    res.json({
      company: {
        ...company,
        totals: moneyTotals(payments),
        lead_count: leads.length,
      },
      leads: leads.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
      payments: payments.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
      conversations,
      timeline,
      // Payments matched by name only — surfaced so the UI can flag them as
      // unconfirmed rather than presenting them as authoritative links.
      inferred_payment_ids: inferred,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load company', details: error.message });
  }
});

// PUT /api/admin/companies/:id — edit account details
router.put('/:id', requireStaff, (req, res) => {
  try {
    const id = Number(req.params.id);
    const company = dbHelpers.getCompanyById(id);
    if (!company) return res.status(404).json({ error: 'Company not found' });
    if (!canSeeCompany(req, id)) return res.status(403).json({ error: 'You do not have access to this account' });

    // Renaming an account can collide with an existing one. Merging accounts is
    // a deliberate, separate operation — refuse rather than silently combine.
    if (req.body?.name) {
      const key = dbHelpers.companyKey(req.body.name);
      const clash = dbHelpers.getCompanyByNameKey(key);
      if (clash && Number(clash.id) !== id) {
        return res.status(409).json({
          error: `“${req.body.name}” already matches an existing account (#${clash.id}). Merge them instead of renaming.`,
        });
      }
    }

    const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
    const patch = {};
    for (const [field, max] of [['name', 100], ['contact_name', 100], ['phone', 20], ['email', 100], ['category', 100], ['pincode', 10]]) {
      if (req.body?.[field] !== undefined) patch[field] = str(req.body[field], max);
    }
    if (Object.keys(patch).length === 0) return res.json({ success: true, company });

    res.json({ success: true, company: dbHelpers.updateCompany(id, patch) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update company', details: error.message });
  }
});

export default router;
