import express from 'express';
import { dbHelpers } from '../db.js';
import { optionalStaff, requireStaff } from '../middleware/staffAuth.js';
import { queueBackfill, flushBackfill } from '../services/sheetBackfill.js';

const router = express.Router();

// Lead pipeline (two stages):
//   Sales  : new → assigned (by BDM) → in_followup → qualified (by BD exec)
//   Ops    : qualified (handoff — Ops Manager sees it) → in_operations
//            (assigned by Ops Manager) → completed
// Statuses are the single source of truth; the sales/ops split is derived:
const SALES_STATUSES = ['new', 'assigned', 'in_followup', 'qualified', 'cold'];
const OPS_VISIBLE = ['qualified', 'in_operations', 'completed']; // what Ops Manager sees
const SALES_ONLY = ['new', 'assigned', 'in_followup']; // ops roles may not set
const OPS_ONLY = ['in_operations', 'completed']; // sales roles may not set

// GET /api/leads — staff-scoped
router.get('/', optionalStaff, (req, res) => {
  try {
    // Legacy leads predate the companies collection; link them on first read.
    dbHelpers.backfillCompanies();
    let leads = dbHelpers.getLeads().slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const role = req.staff?.role;
    // bd_executive: only assigned leads
    if (role === 'bd_executive') {
      leads = leads.filter((l) => Number(l.bd_exec_id) === Number(req.staff.id));
    }
    // bdm: leads they assigned + unassigned in their domain
    if (role === 'bdm') {
      leads = leads.filter((l) => Number(l.bdm_id) === Number(req.staff.id) || !l.bdm_id);
    }
    // ops_manager: only leads the sales team has processed (ready for ops)
    if (role === 'ops_manager') {
      leads = leads.filter((l) => OPS_VISIBLE.includes(l.status));
    }
    // ops_executive: only leads assigned to them by the Ops Manager
    if (role === 'ops_executive') {
      leads = leads.filter((l) => Number(l.ops_exec_id) === Number(req.staff.id));
    }
    // member / others: don't see leads
    if (role === 'member') {
      leads = [];
    }
    // Fail closed. `optionalStaff` deliberately lets anonymous requests through
    // (the public POST /api/leads enquiry form needs that), which means an
    // unauthenticated caller arrives here with role === undefined and matches
    // NONE of the filters above — so without this guard every lead, with names,
    // phones and emails, was served to anyone who asked.
    if (!req.staff) {
      return res.status(401).json({ error: 'Staff sign-in required' });
    }
    // Attach live payment state. The lead stores only the reference; the status
    // lives on the payment row so it stays correct when a PayU callback or a
    // manager's manual confirmation flips it — no denormalised copy to drift.
    const paymentsByRef = new Map(dbHelpers.getPayments().map((p) => [p.reference, p]));

    // Money actually received per lead. A lead collects more than once — the
    // booking fee at checkout, then the balance against the lead as the work
    // progresses — so the received figure has to be summed over every payment
    // tagged with lead_id, not read off the first one. Built in one pass so
    // the table does not fan out into a rollup request per row.
    const round2 = (n) => Math.round(n * 100) / 100;
    const receivedByLead = new Map();
    const pendingByLead = new Map();
    for (const p of dbHelpers.getPayments()) {
      const leadId = Number(p.lead_id);
      if (!leadId || p.direction === 'out') continue;
      if (p.status === 'paid') {
        receivedByLead.set(leadId, (receivedByLead.get(leadId) || 0) + (Number(p.amount) || 0));
      } else {
        pendingByLead.set(leadId, (pendingByLead.get(leadId) || 0) + (Number(p.amount) || 0));
      }
    }

    leads = leads.map((l) => {
      const leadId = Number(l.id);
      const amountReceived = round2(receivedByLead.get(leadId) || 0);
      const amountPending = round2(pendingByLead.get(leadId) || 0);
      const base = {
        ...l,
        // What has actually landed. 0 is meaningful: a lead with a payment
        // request that was never paid is not the same as one with nothing due.
        amount_received: amountReceived,
        amount_pending: amountPending,
        // Campaign total, when we priced one. Lets the table show
        // received-of-quoted without a second lookup.
        amount_quoted: Number(l.amountQuoted) || 0,
      };

      const payment = l.payment_reference ? paymentsByRef.get(l.payment_reference) : null;

      // A lead can hold a payment_reference whose row no longer exists — the
      // payment was cancelled and purged, or the lead was migrated. Falling
      // back to the lead's own denormalised status in that case is how the
      // pipeline ended up showing "Paid" next to a Received total of zero: the
      // status said paid, the money said otherwise. When we cannot find the
      // payment we believe the ledger, not the stale copy.
      if (!payment) {
        if (l.payment_reference) {
          base.payment_status = 'missing';
          base.payment_amount = undefined;
          base.payment_rail = undefined;
        }
        return base;
      }

      return {
        ...base,
        payment_status: payment.status,
        payment_amount: payment.amount,
        payment_rail: payment.rail,
      };
    });
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.json({ leads });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load leads', details: error.message });
  }
});

// POST /api/leads — public (checkout / customize form create leads)
router.post('/', (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Invalid lead payload' });
    }
    const b = req.body;
    const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
    // Allowlist: this endpoint is unauthenticated, so a caller must not be able
    // to set pipeline state (status, assignment, payment fields) by posting.
    const leadData = {
      businessName: text(b.businessName, 100),
      contactName: text(b.contactName, 100),
      email: text(b.email, 100),
      phone: text(b.phone, 20),
      category: text(b.category, 300),
      locations: text(b.locations, 20),
      radius: text(b.radius, 20),
      pincode: text(b.pincode, 100),
      zone: text(b.zone, 50),
      duration: text(b.duration, 50),
      startDate: text(b.startDate, 30),
      message: text(b.message, 1000),
      budget: text(b.budget, 50),
      selectedLocations: Array.isArray(b.selectedLocations) ? b.selectedLocations.slice(0, 500) : [],
      invoice: b.invoice && typeof b.invoice === 'object' ? b.invoice : undefined,
      status: 'new',
      source: text(b.source, 30) || 'checkout',
    };
    const lead = dbHelpers.addLead(leadData);

    // Every lead belongs to a customer account so the CRM has one spine.
    const company = dbHelpers.linkLeadToCompany(lead.id);
    if (company) lead.company_id = company.id;

    // Log activity
    dbHelpers.addLeadActivity(lead.id, {
      type: 'created',
      description: `Lead created from ${lead.source}`,
      actor: 'system',
    });

    // Sheet backfill (same as old orders)
    try {
      const locs = Array.isArray(lead.selectedLocations) ? lead.selectedLocations : [];
      const entries = locs.map((loc) => ({
        name: loc.fullName || loc.name,
        type: loc.type,
        lat: loc.lat,
        lng: loc.lng,
        source: loc.source,
        pin_code: lead.pincode,
      })).filter((e) => e.name);
      if (entries.length > 0) {
        queueBackfill(entries);
        flushBackfill().catch(() => {});
      }
    } catch (bfErr) {
      console.warn('[Leads] backfill queue failed:', bfErr.message);
    }

    res.json({ success: true, lead });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save lead', details: error.message });
  }
});

// GET /api/leads/:id — single lead
router.get('/:id', optionalStaff, (req, res) => {
  try {
    const lead = dbHelpers.getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json({ lead });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load lead', details: error.message });
  }
});

// PUT /api/leads/:id — update lead (assignment, status, notes)
router.put('/:id', requireStaff, (req, res) => {
  try {
    const updates = req.body || {};
    const lead = dbHelpers.getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const role = req.staff?.role || '';
    const canAssignBd = ['super_admin', 'manager', 'bdm'].includes(role);
    const canAssignOps = ['super_admin', 'manager', 'ops_manager'].includes(role);

    // Status scope guard: sales roles can't push into ops-only statuses and
    // ops roles can't pull leads back into the sales funnel.
    if (updates.status && updates.status !== lead.status) {
      if (['bd_executive', 'bdm'].includes(role) && OPS_ONLY.includes(updates.status)) {
        return res.status(403).json({ error: 'Only the Operations Manager / Ops Executive can use operations statuses' });
      }
      if (['ops_executive', 'ops_manager'].includes(role) && SALES_ONLY.includes(updates.status)) {
        return res.status(403).json({ error: 'That status belongs to the sales pipeline' });
      }
    }

    // BD Executive assignment (sales stage) — BDM / admin only
    if (updates.bd_exec_id !== undefined) {
      if (!canAssignBd) return res.status(403).json({ error: 'Only the BDM or an admin can assign a BD Executive' });
      if (updates.bd_exec_id && updates.bd_exec_id !== '') {
        const member = dbHelpers.getUserById(Number(updates.bd_exec_id));
        if (!member || !member.is_team || !['bd_executive', 'bdm'].includes(member.role)) {
          return res.status(400).json({ error: 'Assigned member is not a BD Executive' });
        }
        updates.bd_exec_id = Number(updates.bd_exec_id);
        updates.assigned_at = new Date().toISOString();
        updates.assigned_by = req.staff.id;
        if (role === 'bdm' && !lead.bdm_id) updates.bdm_id = req.staff.id;
        updates.status = 'assigned';
      } else {
        updates.bd_exec_id = null;
        updates.assigned_at = null;
        updates.assigned_by = null;
      }
    }

    if (updates.bdm_id !== undefined) {
      if (updates.bdm_id && updates.bdm_id !== '') {
        updates.bdm_id = Number(updates.bdm_id);
      } else {
        updates.bdm_id = null;
      }
    }

    // Ops Executive assignment (operations stage) — Ops Manager / admin only
    if (updates.ops_exec_id !== undefined) {
      if (!canAssignOps) return res.status(403).json({ error: 'Only the Operations Manager or an admin can assign an Ops Executive' });
      if (updates.ops_exec_id && updates.ops_exec_id !== '') {
        const member = dbHelpers.getUserById(Number(updates.ops_exec_id));
        if (!member || !member.is_team || member.role !== 'ops_executive') {
          return res.status(400).json({ error: 'Assigned member is not an Ops Executive' });
        }
        updates.ops_exec_id = Number(updates.ops_exec_id);
        updates.ops_assigned_at = new Date().toISOString();
        updates.ops_assigned_by = req.staff.id;
        updates.status = 'in_operations';
      } else {
        updates.ops_exec_id = null;
        updates.ops_assigned_at = null;
        updates.ops_assigned_by = null;
      }
    }

    // Status transitions
    if (updates.status && updates.status !== lead.status) {
      const isHandoff = updates.status === 'qualified';
      dbHelpers.addLeadActivity(lead.id, {
        type: 'status_change',
        description: isHandoff
          ? 'Sales qualified — ready for Operations Manager'
          : `Status changed from ${lead.status} to ${updates.status}`,
        actor: req.staff.name || req.staff.email,
        meta: { from: lead.status, to: updates.status },
      });
    }

    // Cold flag
    if (updates.cold_flag === true && !lead.cold_flag) {
      dbHelpers.addLeadActivity(lead.id, {
        type: 'cold',
        description: `Marked as cold lead${updates.cold_reason ? ': ' + updates.cold_reason : ''}`,
        actor: req.staff.name || req.staff.email,
        meta: { reason: updates.cold_reason },
      });
    }

    const updated = dbHelpers.updateLead(req.params.id, updates);
    res.json({ success: true, lead: updated });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update lead', details: error.message });
  }
});

// POST /api/leads/:id/note — add a note
router.post('/:id/note', requireStaff, (req, res) => {
  try {
    const lead = dbHelpers.getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    const note = dbHelpers.addLeadNote(req.params.id, {
      text: req.body.text || '',
      author: req.staff.name || req.staff.email,
      author_id: req.staff.id,
    });
    res.json({ success: true, lead: note });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add note', details: error.message });
  }
});

// DELETE /api/leads/:id
router.delete('/:id', requireStaff, (req, res) => {
  try {
    dbHelpers.deleteLead(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete lead', details: error.message });
  }
});

export default router;
