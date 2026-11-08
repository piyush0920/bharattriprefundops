/* BharatTrip RefundOps — frontend-only workflow prototype.
 * All state is stored in this browser's localStorage. No backend, email,
 * WhatsApp, bank, or payment integration is present in this prototype.
 */
'use strict';

const STORAGE_KEY = 'bharattrip-refundops-v1';
const APPROVAL_THRESHOLD = 50000; // Demo policy assumption; configure with leadership before real use.
const INTAKE_REPLY_LIMIT_HOURS = 4; // Assumption: flag AI-intake replies still drafted after this many hours.
const SLA_HOURS = {
  'Support Review': 4,
  'Awaiting Agent Info': 24,
  'Sent to Payout': 4,
  'Finance Review': 24,
  'Pending Approval': 24,
  'Processing': 48
};
const STATUS_LABELS = {
  'Support Review': 'Support review',
  'Awaiting Agent Info': 'Awaiting agent info',
  'Sent to Payout': 'Sent to payout',
  'Finance Review': 'Finance review',
  'Pending Approval': 'Pending approval',
  'Processing': 'Processing',
  'Paid': 'Paid',
  'Declined': 'Declined'
};
const CLOSED_STATUSES = new Set(['Paid', 'Declined']);
const SUPPORT_QUEUE = new Set(['Support Review', 'Awaiting Agent Info']);
const FINANCE_QUEUE = new Set(['Sent to Payout', 'Finance Review', 'Pending Approval', 'Processing']);
const SUPPORT_USERS = ['Priya Nair', 'Rohan Das', 'Meera Iyer'];
const FINANCE_USERS = ['Arjun Mehta', 'Neha Kapoor', 'Kabir Sethi'];
const MANAGER_USER = 'Kavya Rao';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const now = () => new Date().toISOString();
const hoursAgo = hours => new Date(Date.now() - hours * 3600000).toISOString();
const daysAgo = days => new Date(Date.now() - days * 86400000).toISOString();
const initials = name => (name || 'NA').split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase();
const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value || 0));
const dateTime = value => value ? new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '—';
const dateOnly = value => value ? new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value)) : '—';
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const safeText = value => escapeHtml(value || '—');
const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const makeId = (prefix, n) => `${prefix}-${new Date().getFullYear()}-${String(n).padStart(4, '0')}`;

let currentView = 'support';
let currentUser = SUPPORT_USERS[0];
let selectedTicketId = null;
let modalAction = null;
let notificationOpen = false;
let lastViewedUpdateCount = 0;
let filters = { search: '', status: 'all', sort: 'oldest' };
let aiIntakeInput = { message: '', channel: 'Email' };
let aiIntakeDraft = null;
let aiIntakeLoading = false;
let aiIntakeError = '';
let state = loadState();

function sampleTicket(id, data) {
  const createdAt = data.createdAt;
  const stageStartedAt = data.stageStartedAt || createdAt;
  const activity = [
    { at: createdAt, actor: data.supportOwner || SUPPORT_USERS[0], role: 'Support', message: 'Refund request logged and ticket ID generated.', type: 'created' }
  ];
  if (data.status !== 'Support Review') {
    activity.push({ at: stageStartedAt, actor: data.status === 'Sent to Payout' ? (data.supportOwner || SUPPORT_USERS[0]) : (data.financeOwner || FINANCE_USERS[0]), role: data.status === 'Sent to Payout' ? 'Support' : 'Finance', message: `Status updated to ${STATUS_LABELS[data.status] || data.status}.`, type: 'status' });
  }
  const financeRecord = data.financeRecord ? {
    financeRefId: data.financeRecord,
    receivedAt: data.financeReceivedAt || stageStartedAt,
    acknowledgedBy: data.financeOwner || FINANCE_USERS[0],
    paidAmount: data.paidAmount ?? null,
    deductionReason: data.deductionReason || '',
    outcome: data.status === 'Paid' ? 'Paid' : data.status === 'Declined' ? 'Declined' : 'Open'
  } : null;
  return {
    ticketId: id,
    financeRefId: financeRecord?.financeRefId || null,
    agentName: data.agentName,
    agentCompany: data.agentCompany,
    agentEmail: data.agentEmail,
    bookingRef: data.bookingRef,
    route: data.route,
    amountRequested: data.amountRequested,
    paidAmount: data.paidAmount ?? null,
    deductionReason: data.deductionReason || '',
    reason: data.reason,
    source: data.source,
    notes: data.notes || '',
    status: data.status,
    supportOwner: data.supportOwner || SUPPORT_USERS[0],
    financeOwner: data.financeOwner || null,
    createdAt,
    updatedAt: stageStartedAt,
    stageStartedAt,
    financeAckAt: data.financeReceivedAt || null,
    financeRecord,
    declineReason: data.declineReason || '',
    activity,
    agentUpdates: data.agentUpdates || [],
    source_channel: data.source_channel || data.source || 'Unknown',
    created_via: data.created_via || 'manual',
    original_message: data.original_message || '',
    reply_status: data.reply_status || 'not_applicable',
    reply_text: data.reply_text || '',
    reply_drafted_at: data.reply_drafted_at || null,
    reply_sent_at: data.reply_sent_at || null,
    referenced_ticket_id: data.referenced_ticket_id || null
  };
}

function seedState() {
  const tickets = [
    sampleTicket('BT-2026-0101', { agentName:'Aarav Malhotra', agentCompany:'Northstar Travels', agentEmail:'aarav@northstar.example', bookingRef:'BKG-DEL-84219', route:'DEL → DXB', amountRequested:18400, reason:'Flight cancellation', source:'Email', notes:'Airline cancellation confirmed; invoice attached.', status:'Support Review', supportOwner:'Priya Nair', createdAt:hoursAgo(2) }),
    sampleTicket('BT-2026-0102', { agentName:'Sana Qureshi', agentCompany:'Wanderwise Partners', agentEmail:'sana@wanderwise.example', bookingRef:'BKG-BOM-51038', route:'BOM → SIN', amountRequested:27600, reason:'Schedule change', source:'WhatsApp', notes:'Waiting for cancelled ticket copy from agent.', status:'Awaiting Agent Info', supportOwner:'Rohan Das', createdAt:hoursAgo(31), stageStartedAt:hoursAgo(25) }),
    sampleTicket('BT-2026-0103', { agentName:'Dev Patel', agentCompany:'TripCanvas', agentEmail:'dev@tripcanvas.example', bookingRef:'BKG-BLR-33092', route:'BLR → MAA', amountRequested:9200, reason:'Duplicate booking', source:'Phone', status:'Sent to Payout', supportOwner:'Meera Iyer', financeOwner:'Arjun Mehta', createdAt:hoursAgo(11), stageStartedAt:hoursAgo(7) }),
    sampleTicket('BT-2026-0104', { agentName:'Ishita Roy', agentCompany:'BlueMaple Holidays', agentEmail:'ishita@bluemaple.example', bookingRef:'BKG-DEL-77201', route:'DEL → LHR', amountRequested:64800, reason:'Flight cancellation', source:'Portal', status:'Pending Approval', supportOwner:'Priya Nair', financeOwner:'Neha Kapoor', createdAt:hoursAgo(40), stageStartedAt:hoursAgo(28), financeRecord:'FIN-2026-0042', financeReceivedAt:hoursAgo(36) }),
    sampleTicket('BT-2026-0105', { agentName:'Kabir Anand', agentCompany:'Nomad Lane', agentEmail:'kabir@nomadlane.example', bookingRef:'BKG-HYD-22145', route:'HYD → BOM', amountRequested:15300, reason:'Hotel cancellation', source:'Email', status:'Finance Review', supportOwner:'Rohan Das', financeOwner:'Arjun Mehta', createdAt:hoursAgo(20), stageStartedAt:hoursAgo(15), financeRecord:'FIN-2026-0043', financeReceivedAt:hoursAgo(15) }),
    sampleTicket('BT-2026-0106', { agentName:'Mira Fernandes', agentCompany:'Coastline Travel Co.', agentEmail:'mira@coastline.example', bookingRef:'BKG-GOI-11832', route:'GOI → DEL', amountRequested:11200, reason:'Passenger cancellation', source:'WhatsApp', status:'Processing', supportOwner:'Meera Iyer', financeOwner:'Neha Kapoor', createdAt:hoursAgo(34), stageStartedAt:hoursAgo(19), financeRecord:'FIN-2026-0044', financeReceivedAt:hoursAgo(30) }),
    sampleTicket('BT-2026-0107', { agentName:'Rahul Bhatia', agentCompany:'OrbitBridge', agentEmail:'rahul@orbitbridge.example', bookingRef:'BKG-DEL-61027', route:'DEL → GOI', amountRequested:8700, paidAmount:8700, reason:'Schedule change', source:'Email', status:'Paid', supportOwner:'Priya Nair', financeOwner:'Arjun Mehta', createdAt:daysAgo(4), stageStartedAt:daysAgo(2), financeRecord:'FIN-2026-0045', financeReceivedAt:daysAgo(3), agentUpdates:[{at:daysAgo(2),message:'Your refund has been paid by BharatTrip. Ticket BT-2026-0107 is complete.',channel:'Demo portal'}] }),
    sampleTicket('BT-2026-0108', { agentName:'Tara Menon', agentCompany:'Maple Route Travel', agentEmail:'tara@mapleroute.example', bookingRef:'BKG-MAA-99218', route:'MAA → COK', amountRequested:5800, reason:'Duplicate booking', source:'Phone', status:'Declined', supportOwner:'Rohan Das', financeOwner:'Kabir Sethi', declineReason:'Airline fare rules classify this ticket as non-refundable.', createdAt:daysAgo(5), stageStartedAt:daysAgo(3), financeRecord:'FIN-2026-0046', financeReceivedAt:daysAgo(4) }),
    sampleTicket('BT-2026-0109', { agentName:'Nikhil Sood', agentCompany:'Skyward Associates', agentEmail:'nikhil@skyward.example', bookingRef:'BKG-JAI-54002', route:'JAI → DEL', amountRequested:13600, reason:'Flight cancellation', source:'Email', status:'Sent to Payout', supportOwner:'Meera Iyer', financeOwner:'Neha Kapoor', createdAt:hoursAgo(6), stageStartedAt:hoursAgo(2) }),
    sampleTicket('BT-2026-0110', { agentName:'Ananya Sen', agentCompany:'The Travel Atelier', agentEmail:'ananya@atelier.example', bookingRef:'BKG-CCU-47012', route:'CCU → DEL', amountRequested:43200, paidAmount:41900, deductionReason:'Airline cancellation fee of ₹1,300 as per fare conditions.', reason:'Passenger cancellation', source:'Portal', status:'Processing', supportOwner:'Priya Nair', financeOwner:'Arjun Mehta', createdAt:daysAgo(3), stageStartedAt:hoursAgo(53), financeRecord:'FIN-2026-0047', financeReceivedAt:daysAgo(2) }),
    sampleTicket('BT-2026-0111', { agentName:'Vikram Joshi', agentCompany:'Summit Getaways', agentEmail:'vikram@summit.example', bookingRef:'BKG-PNQ-81140', route:'PNQ → BLR', amountRequested:7400, paidAmount:7400, reason:'Duplicate booking', source:'WhatsApp', status:'Paid', supportOwner:'Rohan Das', financeOwner:'Neha Kapoor', createdAt:daysAgo(2), stageStartedAt:hoursAgo(14), financeRecord:'FIN-2026-0048', financeReceivedAt:daysAgo(1) }),
    sampleTicket('BT-2026-0112', { agentName:'Zoya Khan', agentCompany:'OpenRoad Journeys', agentEmail:'zoya@openroad.example', bookingRef:'BKG-AMD-39018', route:'AMD → BOM', amountRequested:19400, reason:'Flight cancellation', source:'WhatsApp', status:'Awaiting Agent Info', supportOwner:'Meera Iyer', financeOwner:'Kabir Sethi', createdAt:hoursAgo(14), stageStartedAt:hoursAgo(9), financeRecord:'FIN-2026-0049', financeReceivedAt:hoursAgo(10) })
  ];
  return { version: 2, tickets, processIssues: [], notifications: [], counters: { ticket: 112, finance: 49 }, createdAt: now() };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.tickets)) {
        parsed.notifications ||= [];
        parsed.processIssues ||= [];
        parsed.counters ||= { ticket: 112, finance: 49 };
        parsed.tickets.forEach(ticket => {
          ticket.source_channel ||= ticket.source || 'Unknown';
          ticket.created_via ||= 'manual';
          ticket.original_message ||= '';
          ticket.reply_status ||= 'not_applicable';
          ticket.reply_text ||= '';
          ticket.reply_drafted_at ||= null;
          ticket.reply_sent_at ||= null;
          ticket.referenced_ticket_id ||= null;
        });
        parsed.version = 2;
        return parsed;
      }
    }
  } catch (error) {
    console.warn('Could not read saved demo data; loading sample data.', error);
  }
  const seeded = seedState();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded)); } catch (error) { console.warn('Local storage unavailable.', error); }
  return seeded;
}

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (error) { showToast('Browser storage is unavailable or full. Changes may not persist after refresh.', 'warning'); }
}
function nextTicketId() { state.counters.ticket = (state.counters.ticket || 0) + 1; return makeId('BT', state.counters.ticket); }
function nextFinanceId() { state.counters.finance = (state.counters.finance || 0) + 1; return makeId('FIN', state.counters.finance); }
function getTicket(id) { return state.tickets.find(ticket => ticket.ticketId === id); }
function addActivity(ticket, message, role, actor = currentUser, type = 'note') {
  ticket.activity ||= [];
  ticket.activity.unshift({ at: now(), actor, role, message, type });
  ticket.updatedAt = now();
}
function queueAgentUpdate(ticket, message) {
  ticket.agentUpdates ||= [];
  ticket.agentUpdates.unshift({ at: now(), message, channel: 'Demo portal' });
  state.notifications.unshift({ at: now(), ticketId: ticket.ticketId, title: 'Agent update prepared', message, kind: 'agent' });
  state.notifications = state.notifications.slice(0, 30);
}
function changeStatus(ticket, status, message, role, actor = currentUser, agentMessage = null) {
  ticket.status = status;
  ticket.stageStartedAt = now();
  ticket.updatedAt = now();
  addActivity(ticket, message, role, actor, 'status');
  if (agentMessage) queueAgentUpdate(ticket, agentMessage);
}
function financeRecordExists(ticket) { return Boolean(ticket.financeRecord && ticket.financeRecord.financeRefId); }
function ensureFinanceRecord(ticket) {
  if (!ticket.financeRecord) {
    const financeRefId = nextFinanceId();
    ticket.financeRefId = financeRefId;
    ticket.financeRecord = { financeRefId, receivedAt: now(), acknowledgedBy: currentUser, paidAmount: null, deductionReason: '', outcome: 'Open' };
    ticket.financeAckAt = now();
  }
  return ticket.financeRecord;
}
function isOverdue(ticket) {
  if (CLOSED_STATUSES.has(ticket.status)) return false;
  const limit = SLA_HOURS[ticket.status];
  if (!limit) return false;
  return (Date.now() - new Date(ticket.stageStartedAt || ticket.updatedAt).getTime()) > limit * 3600000;
}
function elapsedLabel(ticket) {
  if (CLOSED_STATUSES.has(ticket.status)) return 'Closed';
  const hours = Math.max(0, (Date.now() - new Date(ticket.stageStartedAt || ticket.updatedAt).getTime()) / 3600000);
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 24) return `${Math.floor(hours)}h`;
  return `${Math.floor(hours / 24)}d ${Math.floor(hours % 24)}h`;
}
function slaLabel(ticket) { return CLOSED_STATUSES.has(ticket.status) ? 'Complete' : `${SLA_HOURS[ticket.status] || '—'}h target`; }
function statusClass(status) { return `status-${String(status).toLowerCase().replace(/\s+/g, '-')}`; }
function statusBadge(status) { return `<span class="status ${statusClass(status)}">${escapeHtml(STATUS_LABELS[status] || status)}</span>`; }
function ownerChip(name) { return `<span class="owner-chip"><span class="owner-dot">${escapeHtml(initials(name))}</span>${escapeHtml(name || 'Unassigned')}</span>`; }
function activeTickets() { return state.tickets.filter(ticket => !CLOSED_STATUSES.has(ticket.status)); }
function getCounts() {
  const tickets = state.tickets;
  return {
    total: tickets.length,
    open: activeTickets().length,
    support: tickets.filter(t => SUPPORT_QUEUE.has(t.status)).length,
    financeIntake: tickets.filter(t => t.status === 'Sent to Payout').length,
    financeReview: tickets.filter(t => t.status === 'Finance Review').length,
    pendingApproval: tickets.filter(t => t.status === 'Pending Approval').length,
    processing: tickets.filter(t => t.status === 'Processing').length,
    paid: tickets.filter(t => t.status === 'Paid').length,
    declined: tickets.filter(t => t.status === 'Declined').length,
    overdue: activeTickets().filter(isOverdue).length,
    closed: tickets.filter(t => CLOSED_STATUSES.has(t.status)).length,
    financeRecords: tickets.filter(financeRecordExists).length,
    orphanClosed: tickets.filter(t => CLOSED_STATUSES.has(t.status) && !financeRecordExists(t)).length,
    aiIntakeCreated: tickets.filter(t => t.created_via === 'ai_intake').length,
    // A message attached to a manually-created ticket is still an AI-intake reply.
    aiRepliesSent: tickets.filter(t => t.created_via === 'ai_intake' && t.reply_status === 'sent').length,
    draftedRepliesOverdue: tickets.filter(isIntakeReplyOverdue).length
  };
}

function render() {
  renderNavigation();
  const content = $('#appContent');
  if (!content) return;
  if (currentView === 'support') content.innerHTML = renderSupport();
  else if (currentView === 'finance') content.innerHTML = renderFinance();
  else if (currentView === 'management') content.innerHTML = renderManagement();
  else content.innerHTML = renderAllTickets();
  $('#breadcrumbCurrent').textContent = ({support:'Support desk', finance:'Finance desk', management:'Management', tickets:'All tickets'})[currentView];
  $('#userName').textContent = currentUser;
  $('#userRole').textContent = currentView === 'support' ? 'Support · Agent' : currentView === 'finance' ? 'Finance · Analyst' : currentView === 'management' ? 'Management · Lead' : 'Operations · Viewer';
  $('#userAvatar').textContent = initials(currentUser);
  $('#notificationDot').style.display = state.notifications.length > lastViewedUpdateCount ? 'block' : 'none';
  if (selectedTicketId && $('#modalRoot').innerHTML) renderTicketModal();
}

function renderNavigation() {
  $$('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === currentView));
  const counts = getCounts();
  $('#supportNavCount').textContent = counts.support;
  $('#financeNavCount').textContent = counts.financeIntake + counts.financeReview + counts.pendingApproval + counts.processing;
}

function pageHead(eyebrow, title, subtitle, actions = '') {
  return `<div class="page-head"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p class="page-subtitle">${subtitle}</p></div><div class="head-actions">${actions}</div></div>`;
}
function kpi(label, value, icon, tone, foot) {
  return `<div class="kpi-card"><div class="kpi-top"><span>${label}</span><span class="kpi-icon ${tone || ''}">${icon}</span></div><div class="kpi-value">${value}</div><div class="kpi-foot">${foot || ''}</div></div>`;
}
function ticketRow(ticket, options = {}) {
  const person = options.person || ticket.agentName;
  const overdue = isOverdue(ticket);
  const amount = money(ticket.amountRequested);
  const owner = options.owner === 'finance' ? ticket.financeOwner : ticket.supportOwner;
  return `<tr>
    <td><button class="ticket-id" data-open-ticket="${ticket.ticketId}">${ticket.ticketId}</button>${ticket.financeRecord ? `<div class="footnote">${ticket.financeRecord.financeRefId}</div>` : ''}</td>
    <td><div class="agent-cell"><div class="mini-avatar">${escapeHtml(initials(person))}</div><div><strong>${escapeHtml(person)}</strong><span>${escapeHtml(ticket.bookingRef)} · ${escapeHtml(ticket.route)}</span></div></div></td>
    <td>${dateOnly(ticket.createdAt)}</td>
    <td class="amount">${ticket.amountRequested ? amount : '—'}</td>
    <td>${statusBadge(ticket.status)}</td>
    <td>${ownerChip(owner)}</td>
    <td><div class="age-cell"><span class="age-indicator ${overdue ? 'overdue' : ''}"></span><span>${elapsedLabel(ticket)}</span>${overdue ? '<span class="tag high">Overdue</span>' : ''}</div></td>
    <td><button class="btn btn-secondary btn-small" data-open-ticket="${ticket.ticketId}">View</button></td>
  </tr>`;
}
function tableMarkup(tickets, emptyMessage = 'No requests in this queue.', options = {}) {
  if (!tickets.length) return `<div class="empty-state"><strong>All clear</strong>${emptyMessage}</div>`;
  return `<div class="queue-table-wrap"><table><thead><tr><th>Ticket ID</th><th>Agent / booking</th><th>Created</th><th>Requested</th><th>Status</th><th>Owner</th><th>Stage age</th><th></th></tr></thead><tbody>${tickets.map(t => ticketRow(t, options)).join('')}</tbody></table></div>`;
}
function sortTickets(tickets, sort = 'oldest') {
  const copy = [...tickets];
  if (sort === 'newest') return copy.sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt));
  if (sort === 'amount-high') return copy.sort((a,b) => b.amountRequested-a.amountRequested);
  if (sort === 'amount-low') return copy.sort((a,b) => a.amountRequested-b.amountRequested);
  if (sort === 'overdue') return copy.sort((a,b) => Number(isOverdue(b))-Number(isOverdue(a)) || new Date(a.stageStartedAt)-new Date(b.stageStartedAt));
  return copy.sort((a,b) => new Date(a.createdAt)-new Date(b.createdAt));
}

const AI_CLASSIFICATIONS = ['new_request', 'status_chase', 'process_complaint', 'unclear'];
const AI_LANGUAGES = ['English', 'Hinglish', 'Hindi', 'Other'];
const AI_INTAKE_SAMPLES = [
  { label:'Peak Journeys · Email', channel:'Email', message:`From: Peak Journeys

Hi, I cancelled booking for DEL-DXB last week and was told I’d get a refund. I haven’t received anything and I don’t have any reference number. Please help, my client is asking.` },
  { label:'Nomad Travel · WhatsApp', channel:'WhatsApp', message:`From: Nomad Travel

Bhai refund ka kya hua? BLR-MAA wala. 2 hafte ho gaye, koi jawab nahi.` },
  { label:'Internal process note', channel:'Internal note', message:'Finance says they never received several of the refunds I closed last month. I marked them done on my side. Not sure where they went.' }
];

function isIntakeReplyOverdue(ticket) {
  if (ticket.reply_status !== 'drafted') return false;
  const draftedAt = ticket.reply_drafted_at || ticket.updatedAt || ticket.createdAt;
  return Date.now() - new Date(draftedAt).getTime() > INTAKE_REPLY_LIMIT_HOURS * 3600000;
}

function renderAIIntakePanel() {
  return `<section class="panel ai-intake-panel">
    <div class="panel-header"><div><h2 class="panel-title">AI Intake</h2><p class="panel-subtitle">Turn an email, WhatsApp message or phone note into a reviewed refund ticket.</p></div><span class="tag ai-offline-tag">Simulated AI</span></div>
    <div class="panel-body">
      <div class="notice warning ai-privacy-notice"><div class="notice-icon">!</div><div><strong>Demo mode: simulated AI, no message leaves your browser.</strong><p>Results are canned for the three sample messages; anything else returns an unclear result for human review. Verify every field before acting. This app does not send email or WhatsApp replies.</p></div></div>
      <div class="ai-intake-layout">
        <div class="ai-intake-compose">
          <div class="form-field"><label for="aiIntakeMessage">Original message</label><textarea id="aiIntakeMessage" maxlength="2000" placeholder="Paste the agent’s email, WhatsApp message or an internal note…">${escapeHtml(aiIntakeInput.message)}</textarea><span class="form-hint">Maximum 2,000 characters. Treat pasted content as untrusted input.</span></div>
          <div class="form-field"><label for="aiIntakeChannel">Channel</label><select id="aiIntakeChannel">${['Email','WhatsApp','Phone note','Internal note'].map(channel=>`<option value="${channel}" ${aiIntakeInput.channel===channel?'selected':''}>${channel}</option>`).join('')}</select></div>
          <div class="ai-intake-actions"><button class="btn btn-primary" data-ai-action="analyse" ${aiIntakeLoading?'disabled':''}>${aiIntakeLoading?'Analysing…':'✦ Analyse message'}</button><span class="footnote">Analysis never creates a ticket automatically.</span></div>
          <div class="ai-samples"><span class="form-hint">Load a sample test case:</span>${AI_INTAKE_SAMPLES.map((sample,index)=>`<button class="btn btn-secondary btn-small" data-ai-sample="${index}">${escapeHtml(sample.label)}</button>`).join('')}</div>
        </div>
        <div class="ai-intake-side"><div class="ai-side-icon">✦</div><strong>Human-in-the-loop intake</strong><p>The mock analyser returns a structured result. Support reviews the extracted fields, checks ticket matches and confirms the next action.</p><div class="ai-step"><span>01</span> Analyse the message</div><div class="ai-step"><span>02</span> Review extracted details and matches</div><div class="ai-step"><span>03</span> Confirm ticket creation or flag an issue</div></div>
      </div>
      ${aiIntakeLoading ? '<div class="ai-loading">Preparing the simulated analysis…</div>' : ''}
      ${aiIntakeError ? `<div class="notice warning" style="margin:14px 0 0"><div class="notice-icon">!</div><div><strong>Analysis notice</strong><p>${escapeHtml(aiIntakeError)}</p></div></div>` : ''}
      ${aiIntakeDraft ? renderAIIntakeReview() : ''}
    </div>
  </section>`;
}

function renderAIField(label, name, control, needsConfirm, confirmKey = name) {
  return `<div class="ai-review-field ${confirmKey === 'confidence' ? 'ai-confidence-field' : ''}"><div class="ai-review-label"><label for="${name}">${label}</label><label class="ai-confirm-label" style="display:${needsConfirm?'flex':'none'}"><input type="checkbox" data-ai-confirm-field="${confirmKey}" /> Confirm</label></div>${control}</div>`;
}

function renderAIResolution(matches, selected = 'create') {
  const validSelection = selected === 'create' || matches.some(candidate=>selected === `attach:${candidate.ticket.ticketId}`);
  const choice = validSelection ? selected : 'create';
  return `<div class="ai-resolution"><div class="ai-review-heading"><div><h3>Ticket matching</h3><p>Matching runs in the browser using agent/company, route and referenced ticket ID.</p></div><span class="tag">${matches.length} candidate${matches.length===1?'':'s'}</span></div>
    <label class="ai-match-option"><input type="radio" name="resolution" value="create" ${choice==='create'?'checked':''}/> <span><strong>Create new ticket</strong><small>Generate a new BharatTrip ticket ID.</small></span></label>
    ${matches.map(candidate=>`<label class="ai-match-option"><input type="radio" name="resolution" value="attach:${escapeHtml(candidate.ticket.ticketId)}" ${choice===`attach:${candidate.ticket.ticketId}`?'checked':''}/> <span><strong>Attach to existing ticket ${escapeHtml(candidate.ticket.ticketId)}</strong><small>${escapeHtml(candidate.ticket.agentCompany || candidate.ticket.agentName)} · ${escapeHtml(candidate.ticket.route || 'Route not recorded')} · ${escapeHtml(candidate.reason)}</small></span></label>`).join('')}
    ${!matches.length ? '<p class="footnote">No matching ticket found. Creating a new ticket is the available path.</p>' : ''}</div>`;
}

function refreshAIReviewMatches() {
  const form = $('#aiIntakeReviewForm');
  if (!form || !aiIntakeDraft) return;
  const data = getAIReviewData();
  if (!data) return;
  const selected = new FormData(form).get('resolution') || aiIntakeDraft.defaultResolution || 'create';
  const matches = matchAIIntakeTickets(data);
  const selectionStillMatches = selected === 'create' || matches.some(candidate=>selected === `attach:${candidate.ticket.ticketId}`);
  let nextSelection = selectionStillMatches ? selected : 'create';
  if (selected === 'create' && matches.length && aiIntakeDraft.result.classification === 'status_chase' && !aiIntakeDraft.resolutionTouched) nextSelection = `attach:${matches[0].ticket.ticketId}`;
  aiIntakeDraft.matches = matches;
  aiIntakeDraft.defaultResolution = nextSelection;
  const current = $('.ai-resolution', form);
  if (current) current.outerHTML = renderAIResolution(matches, nextSelection);
}

function renderAIIntakeReview() {
  const result = aiIntakeDraft.result;
  const lowConfidence = Number(result.confidence) < 0.6 || result.classification === 'unclear';
  const candidates = aiIntakeDraft.matches;
  const isProcessIssue = result.classification === 'process_complaint';
  const defaultResolution = aiIntakeDraft.defaultResolution;
  const classificationOptions = AI_CLASSIFICATIONS.map(value=>`<option value="${value}" ${result.classification===value?'selected':''}>${value.replaceAll('_',' ')}</option>`).join('');
  const languageOptions = AI_LANGUAGES.map(value=>`<option value="${value}" ${result.language===value?'selected':''}>${value}</option>`).join('');
  const confirmRequired = `<div class="notice warning ai-low-confidence" id="aiLowConfidenceNotice" ${lowConfidence?'':'hidden'}><div class="notice-icon">!</div><div><strong>Low-confidence result — field confirmation required.</strong><p>Confidence is below 0.60 or the classification is unclear. Review and explicitly confirm every extracted field before continuing.</p></div></div>`;
  const fieldConfirmation = lowConfidence;
  const resolution = renderAIResolution(candidates, defaultResolution);
  return `<section class="ai-review" id="aiIntakeReview">
    <div class="ai-review-top"><div><div class="eyebrow">HUMAN REVIEW REQUIRED</div><h3>Review simulated analysis</h3><p>Nothing is saved until a Support agent confirms.</p></div><div class="ai-confidence-wrap"><div class="ai-confidence"><strong>${Math.round(Number(result.confidence)*100)}%</strong><span>initial confidence</span></div></div></div>
    <div class="ai-result-meta"><span class="tag">${escapeHtml(aiIntakeDraft.modeLabel)}</span><span class="tag">${escapeHtml(result.classification.replaceAll('_',' '))}</span><span class="footnote">${escapeHtml(result.reasoning)}</span></div>
    ${confirmRequired}
    <form data-form="ai-intake-review" id="aiIntakeReviewForm">
      <div class="ai-review-grid">
        ${renderAIField('Classification','aiClassification',`<select id="aiClassification" name="classification" data-ai-review-field="classification">${classificationOptions}</select>`,fieldConfirmation,'classification')}
        ${renderAIField('Agent / agency name','aiAgentName',`<input id="aiAgentName" name="agent_name" type="text" value="${escapeHtml(result.agent_name || '')}" placeholder="Not identified" data-ai-review-field="agent_name" />`,fieldConfirmation,'agent_name')}
        ${renderAIField('Route','aiRoute',`<input id="aiRoute" name="route" type="text" value="${escapeHtml(result.route || '')}" placeholder="Not identified" data-ai-review-field="route" />`,fieldConfirmation,'route')}
        ${renderAIField('Referenced ticket ID','aiReferencedTicket',`<input id="aiReferencedTicket" name="referenced_ticket_id" type="text" value="${escapeHtml(result.referenced_ticket_id || '')}" placeholder="RF-xxxx or blank" data-ai-review-field="referenced_ticket_id" />`,fieldConfirmation,'referenced_ticket_id')}
        ${renderAIField('Time waiting','aiTimeWaiting',`<input id="aiTimeWaiting" name="time_waiting" type="text" value="${escapeHtml(result.time_waiting || '')}" placeholder="Not stated" data-ai-review-field="time_waiting" />`,fieldConfirmation,'time_waiting')}
        ${renderAIField('Language','aiLanguage',`<select id="aiLanguage" name="language" data-ai-review-field="language">${languageOptions}</select>`,fieldConfirmation,'language')}
        ${renderAIField('Confidence score (0–1)','aiConfidence',`<input id="aiConfidence" name="confidence" type="number" min="0" max="1" step="0.01" value="${Number(result.confidence).toFixed(2)}" data-ai-review-field="confidence" />`,fieldConfirmation,'confidence')}
        ${renderAIField('Missing information (comma-separated)','aiMissingFields',`<input id="aiMissingFields" name="missing_fields" type="text" value="${escapeHtml(result.missing_fields.join(', '))}" placeholder="e.g. booking reference, requested amount" data-ai-review-field="missing_fields" />`,fieldConfirmation,'missing_fields')}
        ${renderAIField('Reasoning','aiReasoning',`<textarea id="aiReasoning" name="reasoning" data-ai-review-field="reasoning">${escapeHtml(result.reasoning)}</textarea>`,fieldConfirmation,'reasoning')}
        <div class="ai-review-field ai-reply-field">${renderAIField('Draft reply · editable','aiDraftReply',`<textarea id="aiDraftReply" name="draft_reply" data-ai-review-field="draft_reply">${escapeHtml(result.draft_reply)}</textarea><span class="form-hint">The {{TICKET_ID}} placeholder is replaced after confirmation. Copy and send the reply outside this app.</span>`,fieldConfirmation,'draft_reply')}</div>
      </div>
      <div class="callout-inline ai-process-callout" ${isProcessIssue?'':'hidden'}><strong>Process issue detected.</strong> This is not a refund request. No ticket will be created; flag it for Management review instead.</div>${resolution.replace('<div class="ai-resolution"','<div class="ai-resolution" '+(isProcessIssue?'hidden':''))}
      <div class="ai-review-footer"><button type="button" class="btn btn-secondary" data-ai-action="discard">Discard analysis</button><button type="button" id="aiFlagBtn" class="btn btn-warning" data-ai-action="flag" ${isProcessIssue?'':'hidden'}>⚑ Flag for review</button><button type="submit" id="aiConfirmBtn" class="btn btn-primary" ${isProcessIssue?'hidden':''}>Confirm and create/attach ticket →</button></div>
    </form>
  </section>`;
}

function renderAgentReplyCard(ticket) {
  if (ticket.reply_status === 'drafted' && (currentView === 'support' || currentView === 'tickets')) {
    return `<section class="detail-card ai-agent-reply"><h3>Agent reply · draft</h3><p class="footnote">This app does not send email or WhatsApp messages. Copy the reply, send it through your normal channel, then mark it as sent.</p><textarea readonly>${escapeHtml(ticket.reply_text || '')}</textarea><div class="action-buttons"><button class="btn btn-secondary btn-small" data-action="copy-reply" data-ticket-id="${escapeHtml(ticket.ticketId)}">Copy reply</button><button class="btn btn-success btn-small" data-ticket-action="mark-reply-sent" data-ticket-id="${escapeHtml(ticket.ticketId)}">Mark reply as sent</button></div></section>`;
  }
  if (ticket.reply_status === 'sent') return `<section class="detail-card ai-agent-reply"><h3>Agent reply · marked sent</h3><span class="tag">Marked sent ${ticket.reply_sent_at ? dateTime(ticket.reply_sent_at) : ''}</span><p class="footnote">This is a manual confirmation that the message was sent outside the prototype. The app did not send it.</p><p>${escapeHtml(ticket.reply_text || '')}</p></section>`;
  return '';
}

function renderInformalIntakeCard() {
  const aiTickets = state.tickets.filter(ticket=>ticket.created_via==='ai_intake');
  const overdueReplies = sortTickets(state.tickets.filter(isIntakeReplyOverdue), 'oldest');
  const sent = aiTickets.filter(ticket=>ticket.reply_status==='sent').length;
  return `<section class="panel ai-management-card"><div class="panel-header"><div><h2 class="panel-title">Informal-channel intake</h2><p class="panel-subtitle">AI-assisted tickets and follow-up reply controls</p></div><span class="tag">${INTAKE_REPLY_LIMIT_HOURS}h reply limit · assumption</span></div><div class="panel-body"><div class="ai-management-metrics"><div><span>Tickets created via AI Intake</span><strong>${aiTickets.length}</strong></div><div><span>AI-created tickets marked sent</span><strong>${sent}</strong></div><div><span>Drafted replies beyond limit</span><strong class="${overdueReplies.length?'ai-overdue-count':''}">${overdueReplies.length}</strong></div></div><div class="ai-overdue-list"><strong>Drafted replies requiring follow-up</strong>${overdueReplies.length ? overdueReplies.map(ticket=>`<div class="ai-overdue-item"><div><button class="ticket-id" data-open-ticket="${escapeHtml(ticket.ticketId)}">${escapeHtml(ticket.ticketId)}</button><span>${escapeHtml(ticket.agentCompany || ticket.agentName)} · ${escapeHtml(ticket.source_channel || ticket.source)}</span></div><span class="tag high">Drafted ${escapeHtml(elapsedReplyLabel(ticket))}</span></div>`).join('') : '<p class="footnote">No drafted replies are past the assumed follow-up limit.</p>'}</div></div></section>`;
}

function elapsedReplyLabel(ticket) {
  const hours = Math.max(0, (Date.now()-new Date(ticket.reply_drafted_at || ticket.createdAt).getTime())/3600000);
  return hours < 24 ? `${Math.floor(hours)}h` : `${Math.floor(hours/24)}d ${Math.floor(hours%24)}h`;
}

function renderProcessIssuesCard() {
  const issues = state.processIssues || [];
  return `<section class="panel ai-process-issues"><div class="panel-header"><div><h2 class="panel-title">Process issues</h2><p class="panel-subtitle">Internal notes and complaints flagged by Support for Management review</p></div><span class="tag">${issues.length} flagged</span></div><div class="panel-body">${issues.length ? `<div class="process-issue-list">${issues.slice(0,12).map(issue=>`<article class="process-issue-item"><div class="process-issue-head"><strong>${escapeHtml(issue.classification || 'Process complaint')}</strong><span class="tag">${escapeHtml(issue.status || 'Open')}</span></div><p>${escapeHtml(issue.original_message || '')}</p><div class="footnote">${escapeHtml(issue.channel || 'Unknown channel')} · ${dateTime(issue.created_at)} · Flagged by ${escapeHtml(issue.created_by || 'Support')}</div>${issue.reasoning ? `<div class="process-issue-reason">${escapeHtml(issue.reasoning)}</div>` : ''}</article>`).join('')}</div>` : '<div class="empty-state"><strong>No process issues flagged</strong>Use AI Intake to flag internal process complaints for Management review.</div>'}</div></section>`;
}

function analyseMessage(message, channel) {
  const lower = String(message || '').toLowerCase();
  if (lower.includes('peak journeys') && lower.includes('del-dxb')) {
    return { classification:'new_request', agent_name:'Peak Journeys', route:'DEL-DXB', referenced_ticket_id:null, time_waiting:'last week', language:'English', confidence:0.96, missing_fields:['booking reference'], reasoning:'The sender describes a cancelled booking and asks for help with a refund but has no reference number.', draft_reply:'Hello Peak Journeys, we have recorded your message under ticket {{TICKET_ID}}. Please share the booking reference so our team can review the request.' };
  }
  if (lower.includes('nomad travel') && lower.includes('blr-maa')) {
    return { classification:'status_chase', agent_name:'Nomad Travel', route:'BLR-MAA', referenced_ticket_id:null, time_waiting:'2 weeks', language:'Hinglish', confidence:0.94, missing_fields:['booking reference'], reasoning:'The sender is following up on an earlier refund request and says there has been no response for two weeks.', draft_reply:'Hello Nomad Travel, aapka refund follow-up ticket {{TICKET_ID}} ke under note kar liya hai. Kripya booking reference share kar dein, taaki Support team request check kar sake.' };
  }
  if ((channel === 'Internal note' || lower.includes('finance says')) && lower.includes('never received') && lower.includes('closed')) {
    return { classification:'process_complaint', agent_name:null, route:null, referenced_ticket_id:null, time_waiting:'last month', language:'English', confidence:0.98, missing_fields:[], reasoning:'This is an internal complaint about the Support-to-Finance handoff process, not an individual refund request.', draft_reply:'This internal process issue has been flagged for review. Reference {{TICKET_ID}}.' };
  }
  const hasDevanagari = /[\u0900-\u097f]/.test(message);
  const hasHinglishMarkers = /\b(bhai|kya|ka|hai|nahi|hua|ho gaya|kar dein)\b/i.test(message);
  const hasCommonEnglish = /\b(hello|hi|the|a|an|i|we|you|refund|booking|please|help|is|have|from|for|to|my|client)\b/i.test(message);
  const language = hasDevanagari ? 'Hindi' : hasHinglishMarkers ? 'Hinglish' : hasCommonEnglish ? 'English' : 'Other';
  const reply = language === 'Hinglish'
    ? 'Namaste, kripya batayein ki yeh nayi refund request hai ya pehle se maujood request ka follow-up. Saath hi travel agency ka naam aur route ya booking reference share kar dein. Reference {{TICKET_ID}} review ke baad add kiya jayega.'
    : language === 'Hindi'
      ? 'नमस्ते, कृपया बताएं कि यह नई रिफंड रिक्वेस्ट है या पहले से दर्ज रिक्वेस्ट का फॉलो-अप। साथ ही ट्रैवल एजेंसी का नाम और रूट या बुकिंग रेफरेंस साझा करें। समीक्षा के बाद {{TICKET_ID}} जोड़ा जाएगा।'
      : 'Hello, please let us know whether this is a new refund request or a follow-up, and share the travel agency name plus the route or booking reference. Reference {{TICKET_ID}} will be added after review.';
  return { classification:'unclear', agent_name:null, route:null, referenced_ticket_id:null, time_waiting:null, language, confidence:0.32, missing_fields:['request type','agency name','route or booking reference'], reasoning:'The message does not contain enough information to identify a refund request or match it to an existing ticket.', draft_reply:reply };
}
function validateAIResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('AI response must be a JSON object.');
  const expectedKeys = ['classification','agent_name','route','referenced_ticket_id','time_waiting','language','confidence','missing_fields','reasoning','draft_reply'];
  if (Object.keys(value).length !== expectedKeys.length || expectedKeys.some(key=>!Object.prototype.hasOwnProperty.call(value,key))) throw new Error('AI response keys do not match the required JSON contract.');
  const allowed = ['new_request','status_chase','process_complaint','unclear'];
  if (!allowed.includes(value.classification)) throw new Error('AI response has an unsupported classification.');
  const languages = ['English','Hinglish','Hindi','Other'];
  if (!languages.includes(value.language)) throw new Error('AI response has an unsupported language.');
  if (typeof value.confidence !== 'number' || value.confidence < 0 || value.confidence > 1) throw new Error('AI confidence must be a number from 0 to 1.');
  if (!Array.isArray(value.missing_fields) || value.missing_fields.some(item=>typeof item!=='string')) throw new Error('AI missing_fields must be an array of strings.');
  for (const key of ['agent_name','route','referenced_ticket_id','time_waiting']) {
    if (value[key] !== null && typeof value[key] !== 'string') throw new Error(`AI ${key} must be a string or null.`);
  }
  if (value.referenced_ticket_id && !/^RF-\d{4,}$/i.test(value.referenced_ticket_id.trim())) throw new Error('AI referenced_ticket_id must use the RF-#### format.');
  if (typeof value.reasoning !== 'string' || !value.reasoning.trim() || typeof value.draft_reply !== 'string' || !value.draft_reply.includes('{{TICKET_ID}}')) throw new Error('AI response is missing reasoning or the {{TICKET_ID}} draft placeholder.');
  return {
    classification:value.classification,
    agent_name:value.agent_name?.trim() || null,
    route:value.route?.trim() || null,
    referenced_ticket_id:value.referenced_ticket_id?.trim() || null,
    time_waiting:value.time_waiting?.trim() || null,
    language:value.language,
    confidence:value.confidence,
    missing_fields:value.missing_fields.map(item=>item.trim()).filter(Boolean),
    reasoning:value.reasoning.trim(),
    draft_reply:value.draft_reply.trim()
  };
}

function matchAIIntakeTickets(result) {
  const agent = normalize(result.agent_name);
  const route = normalize(result.route);
  const reference = normalize(result.referenced_ticket_id);
  const matches = new Map();
  state.tickets.forEach(ticket => {
    const refMatch = reference && [ticket.ticketId,ticket.referenced_ticket_id,ticket.legacyReferenceId].some(value=>normalize(value)===reference);
    const sameAgent = agent && [ticket.agentCompany,ticket.agentName].some(value=>normalize(value)===agent);
    const sameRoute = route && normalize(ticket.route)===route;
    if (refMatch || (sameAgent && sameRoute)) {
      matches.set(ticket.ticketId, { ticket, reason:refMatch ? 'Referenced ticket ID match' : 'Same agent/company and route' });
    }
  });
  return [...matches.values()].sort((a,b)=>Number(normalize(b.ticket.ticketId)===normalize(result.referenced_ticket_id))-Number(normalize(a.ticket.ticketId)===normalize(result.referenced_ticket_id)));
}

function extractAIRequestDetails(message) {
  const text = String(message || '');
  const booking = text.match(/\bBKG[-\s]?[A-Z0-9-]{4,}\b/i) || text.match(/\b(?:booking\s*(?:reference|ref|id|number|no\.?)|PNR)\s*[:#-]\s*([A-Z0-9-]{4,})/i);
  const amountMatch = text.match(/(?:₹|INR\s*|Rs\.?\s*)([0-9][0-9,]*(?:\.\d{1,2})?)/i) || text.match(/(?:refund amount|amount requested)\s*(?:is|[:=])\s*([0-9][0-9,]*(?:\.\d{1,2})?)/i);
  const bookingRef = booking ? (booking[1] || booking[0]).replace(/^BKG\s*/i,'BKG-').toUpperCase() : '';
  const amountRequested = amountMatch ? Number(amountMatch[1].replace(/,/g,'')) : null;
  return { bookingRef, amountRequested:Number.isFinite(amountRequested) ? amountRequested : null };
}

function analyseAIIntake() {
  const message = $('#aiIntakeMessage')?.value?.trim() || '';
  const channel = $('#aiIntakeChannel')?.value || 'Email';
  if (!message) return showToast('Paste a message before analysing.', 'warning');
  if (message.length > 2000) return showToast('Messages must be 2,000 characters or fewer.', 'error');
  aiIntakeInput = { message, channel };
  aiIntakeDraft = null;
  aiIntakeError = '';
  aiIntakeLoading = true;
  render();
  try {
    const result = validateAIResult(analyseMessage(message, channel));
    const matches = matchAIIntakeTickets(result);
    const preferred = result.classification === 'status_chase' && matches.length ? `attach:${matches[0].ticket.ticketId}` : 'create';
    aiIntakeDraft = { result, matches, defaultResolution:preferred, modeLabel:'Simulated result', resolutionTouched:false };
  } catch (error) {
    aiIntakeError = 'The simulated analyser returned an invalid result. Please try one of the sample messages or reset the demo data.';
  }
  aiIntakeLoading = false;
  render();
}
function getAIReviewData() {
  const form = $('#aiIntakeReviewForm');
  if (!form) return null;
  const data = Object.fromEntries(new FormData(form).entries());
  data.missing_fields = String(data.missing_fields || '').split(',').map(value=>value.trim()).filter(Boolean);
  data.confidence = Number(data.confidence);
  data.agent_name = String(data.agent_name || '').trim() || null;
  data.route = String(data.route || '').trim() || null;
  data.referenced_ticket_id = String(data.referenced_ticket_id || '').trim() || null;
  data.time_waiting = String(data.time_waiting || '').trim() || null;
  data.reasoning = String(data.reasoning || '').trim();
  data.draft_reply = String(data.draft_reply || '').trim();
  return data;
}

function updateAIReviewMode() {
  const form = $('#aiIntakeReviewForm');
  const classification = $('#aiClassification')?.value;
  if (!form || !classification) return;
  const isProcess = classification === 'process_complaint';
  const reviewedConfidence = Number($('#aiConfidence')?.value ?? aiIntakeDraft?.result?.confidence ?? 0);
  const lowConfidence = Number(aiIntakeDraft?.result?.confidence || 0) < 0.6 || reviewedConfidence < 0.6 || aiIntakeDraft?.result?.classification === 'unclear' || classification === 'unclear';
  const resolution = $('.ai-resolution', form);
  const callout = $('.ai-process-callout', form);
  const flagButton = $('#aiFlagBtn', form);
  const confirmButton = $('#aiConfirmBtn', form);
  if (resolution) resolution.hidden = isProcess;
  if (callout) callout.hidden = !isProcess;
  const confidenceNotice = $('#aiLowConfidenceNotice', form);
  if (confidenceNotice) confidenceNotice.hidden = !lowConfidence;
  if (flagButton) flagButton.hidden = !isProcess;
  if (confirmButton) confirmButton.hidden = isProcess;
  $$('.ai-confirm-label', form).forEach(label => { label.style.display = lowConfidence ? 'flex' : 'none'; });
}

function validateHumanReview(data) {
  if (!data.draft_reply.includes('{{TICKET_ID}}')) return 'Keep the {{TICKET_ID}} placeholder in the reply draft.';
  if (!Number.isFinite(data.confidence) || data.confidence < 0 || data.confidence > 1) return 'Enter a confidence score between 0 and 1.';
  if (Number(aiIntakeDraft.result.confidence)<0.6 || data.confidence<0.6 || aiIntakeDraft.result.classification==='unclear' || data.classification==='unclear') {
    const fields = ['classification','agent_name','route','referenced_ticket_id','time_waiting','language','confidence','missing_fields','reasoning','draft_reply'];
    const reviewRoot = $('#aiIntakeReview');
    const missing = fields.filter(key=>!$(`[data-ai-confirm-field="${key}"]`, reviewRoot)?.checked);
    if (missing.length) return `Explicitly confirm each field before continuing. Still to confirm: ${missing.join(', ')}.`;
  }
  return '';
}

function confirmAIIntake() {
  if (!aiIntakeDraft) return;
  const data = getAIReviewData();
  if (!data) return;
  const validationError = validateHumanReview(data);
  if (validationError) return showToast(validationError, 'error');
  if (data.classification === 'process_complaint') return showToast('Process complaints must use Flag for review; no refund ticket can be created.', 'warning');
  if (data.classification === 'unclear') return showToast('Choose a clear classification after reviewing the message.', 'warning');
  const resolution = data.resolution || aiIntakeDraft.defaultResolution || 'create';
  if (resolution.startsWith('attach:')) {
    const ticketId = resolution.slice('attach:'.length);
    const ticket = getTicket(ticketId);
    const currentMatches = matchAIIntakeTickets(data).map(match=>match.ticket.ticketId);
    if (!ticket || !currentMatches.includes(ticketId)) return showToast('The selected ticket is no longer a match for the reviewed agent, route or reference. Re-analyse or choose a current candidate.', 'error');
    attachAIIntakeToTicket(ticket, data);
    return;
  }
  const requestedMissing = data.missing_fields.map(item=>item.toLowerCase());
  const extractedDetails = extractAIRequestDetails(aiIntakeInput.message);
  const bookingRef = extractedDetails.bookingRef;
  const amountRequested = extractedDetails.amountRequested;
  const status = requestedMissing.length || !bookingRef || !amountRequested || !data.route || !data.agent_name
    ? 'Awaiting Agent Info'
    : 'Support Review';
  const company = data.agent_name || 'Agency not identified';
  const replyText = data.draft_reply;
  const ticket = createTicket(null, {
    data:{ agentName:'Contact not provided', agentCompany:company, agentEmail:'', bookingRef, route:data.route || '', amountRequested, reason:data.classification==='status_chase'?'Refund status follow-up':'Refund request', source:aiIntakeInput.channel, notes:`AI Intake classification: ${data.classification}.\nMissing information: ${requestedMissing.join(', ') || 'None identified'}.\nReasoning: ${data.reasoning}` , supportOwner:currentUser },
    createdVia:'ai_intake', sourceChannel:aiIntakeInput.channel, originalMessage:aiIntakeInput.message,
    replyStatus:'drafted', replyText, referencedTicketId:data.referenced_ticket_id, status, silent:true
  });
  if (!ticket) return;
  ticket.reply_text = data.draft_reply.replaceAll('{{TICKET_ID}}',ticket.ticketId);
  ticket.reply_drafted_at = now();
  addActivity(ticket, 'AI Intake reply draft prepared for Support review. No email or WhatsApp message was sent.', 'Support', currentUser, 'note');
  saveState();
  aiIntakeDraft=null; aiIntakeInput={ message:'', channel:'Email' }; aiIntakeError='';
  render(); openTicket(ticket.ticketId); showToast(`AI Intake created ${ticket.ticketId}. Review and send the reply outside this app.`, 'success');
}

function attachAIIntakeToTicket(ticket, data) {
  // Keep the channel for the most recent AI-assisted reply, while the original
  // ticket.source field continues to describe how the original request arrived.
  ticket.source_channel = aiIntakeInput.channel;
  if (!ticket.original_message) ticket.original_message = aiIntakeInput.message;
  if (data.agent_name && (!ticket.agentCompany || ticket.agentCompany==='Agency not identified')) ticket.agentCompany=data.agent_name;
  if (data.route && !ticket.route) ticket.route=data.route.toUpperCase().replace(/\s*[-→]\s*/g,' → ');
  ticket.referenced_ticket_id ||= data.referenced_ticket_id;
  ticket.reply_status='drafted';
  ticket.reply_drafted_at=now();
  ticket.reply_sent_at=null;
  ticket.reply_text=data.draft_reply.replaceAll('{{TICKET_ID}}',ticket.ticketId);
  addActivity(ticket, `AI Intake message attached via ${aiIntakeInput.channel}: ${aiIntakeInput.message}. Support confirmed this is an update to the existing ticket. A reply draft is ready; no message was sent.`, 'Support', currentUser, 'note');
  saveState();
  aiIntakeDraft=null; aiIntakeInput={ message:'', channel:'Email' }; aiIntakeError='';
  render(); openTicket(ticket.ticketId); showToast(`Message attached to ${ticket.ticketId}. Review and send the reply outside this app.`, 'success');
}

function flagAIProcessIssue() {
  if (!aiIntakeDraft) return;
  const data = getAIReviewData();
  if (!data) return;
  const validationError = validateHumanReview(data);
  if (validationError) return showToast(validationError, 'error');
  if (data.classification !== 'process_complaint') return showToast('Only process complaints can be flagged here. Review the classification.', 'warning');
  state.processIssues ||= [];
  state.processIssues.unshift({ issue_id:`PI-${Date.now()}`, classification:'process_complaint', agent_name:data.agent_name, route:data.route, channel:aiIntakeInput.channel, original_message:aiIntakeInput.message, reasoning:data.reasoning, confidence:data.confidence, created_at:now(), created_by:currentUser, status:'Open' });
  saveState(); aiIntakeDraft=null; aiIntakeInput={message:'',channel:'Email'}; aiIntakeError=''; render();
  showToast('Process issue flagged for Management review. No refund ticket was created.', 'success');
}

function markReplyAsSent(ticket) {
  if (ticket.reply_status !== 'drafted') return showToast('Only a drafted reply can be marked sent.', 'warning');
  if (!confirm('Have you sent this reply to the agent using your normal email or WhatsApp channel? The app will only record your confirmation; it will not send anything.')) return;
  ticket.reply_status='sent'; ticket.reply_sent_at=now();
  addActivity(ticket, `Support manually confirmed that the agent reply was sent outside the app via ${ticket.source_channel || ticket.source || 'the original channel'}. The prototype did not send it.`, 'Support', currentUser, 'status');
  ticket.agentUpdates ||= [];
  ticket.agentUpdates.unshift({ at:now(), message:ticket.reply_text, channel:`Manually sent via ${ticket.source_channel || ticket.source || 'external channel'}` });
  saveState(); render(); renderTicketModal(); showToast('Reply marked as sent. No message was sent by the application.', 'success');
}

function renderSupport() {
  const c = getCounts();
  const supportTickets = sortTickets(state.tickets.filter(t => !CLOSED_STATUSES.has(t.status)), 'overdue');
  const overdue = activeTickets().filter(isOverdue);
  return `${pageHead('SUPPORT WORKSPACE', 'Support desk', 'Capture every incoming refund request, complete the handoff, and keep the agent informed.', `<button class="btn btn-secondary" data-action="export">↧ Export data</button><button class="btn btn-primary" data-action="new-ticket">＋ Create refund ticket</button>`)}
    <div class="notice info"><div class="notice-icon">✓</div><div><strong>No ticket, no refund.</strong><p>Log requests received by email, WhatsApp, phone or portal before any refund work begins. The new ticket ID is the reference returned to the agent.</p></div></div>
    ${renderAIIntakePanel()}
    <section class="kpi-grid">
      ${kpi('Support-owned queue', c.support, '▦', '', 'Requests needing Support action')}
      ${kpi('Sent to Finance', c.financeIntake, '↗', 'teal', 'Awaiting Finance acknowledgement')}
      ${kpi('Awaiting agent details', state.tickets.filter(t=>t.status==='Awaiting Agent Info').length, '…', 'amber', 'Support follow-up required')}
      ${kpi('Overdue across workflow', c.overdue, '!', 'red', 'Past the assumed stage target')}
    </section>
    <div class="content-grid">
      <section class="panel"><div class="panel-header"><div><h2 class="panel-title">Active refund requests</h2><p class="panel-subtitle">Shared ticket records · Support has visibility across the lifecycle</p></div><span class="tag">${supportTickets.length} active</span></div>
        ${tableMarkup(supportTickets, 'No active refund requests.')}
        <div class="queue-footer"><span>Support can submit complete requests to Finance; only Finance can close tickets.</span><span>${overdue.length} overdue</span></div>
      </section>
      <div class="side-stack">
        <section class="panel"><div class="panel-header"><div><h2 class="panel-title">Support quick actions</h2><p class="panel-subtitle">Keep intake and follow-up moving</p></div></div><div class="panel-body"><div class="quick-actions">
          <button class="quick-action" data-action="new-ticket"><span class="quick-action-icon">＋</span><div><strong>Log an incoming request</strong><span>Generate a ticket ID immediately</span></div></button>
          <button class="quick-action" data-view="tickets"><span class="quick-action-icon">⌕</span><div><strong>Find an existing ticket</strong><span>Search by ticket or booking reference</span></div></button>
          <button class="quick-action" data-action="export"><span class="quick-action-icon">↧</span><div><strong>Export demo records</strong><span>Download a JSON backup</span></div></button>
        </div></div></section>
        <section class="panel"><div class="panel-header"><div><h2 class="panel-title">Queue ownership</h2><p class="panel-subtitle">Active tickets by current stage</p></div></div><div class="panel-body"><div class="queue-health">${renderQueueHealth()}</div><p class="sla-note">Stage limits are illustrative assumptions for this prototype, not agreed BharatTrip SLAs.</p></div></section>
      </div>
    </div>`;
}

function renderFinance() {
  const c = getCounts();
  const financeTickets = sortTickets(state.tickets.filter(t => FINANCE_QUEUE.has(t.status)), 'overdue');
  return `${pageHead('FINANCE WORKSPACE', 'Finance desk', 'Acknowledge submitted requests, make payout decisions, and record the financial outcome.', `<button class="btn btn-secondary" data-action="export">↧ Export data</button>`)}
    <div class="notice warning"><div class="notice-icon">!</div><div><strong>Finance controls the final outcome.</strong><p>Support cannot mark a request as paid or declined. A ticket is closed only after Finance records a payment or a reasoned decline.</p></div></div>
    <section class="kpi-grid">
      ${kpi('Awaiting acknowledgement', c.financeIntake, '↗', 'amber', 'Finance has not accepted ownership')}
      ${kpi('Under finance review', c.financeReview, '◫', 'teal', 'Eligibility and approval checks')}
      ${kpi('Manager approval', c.pendingApproval, '⌁', 'amber', `Above ${money(APPROVAL_THRESHOLD)} threshold`)}
      ${kpi('In payout processing', c.processing, '₹', '', 'Approved and awaiting payment')}
    </section>
    <section class="panel"><div class="panel-header"><div><h2 class="panel-title">Finance work queue</h2><p class="panel-subtitle">Requests routed from Support · Acknowledge to establish Finance ownership</p></div><div class="table-toolbar"><span class="tag">${financeTickets.length} in queue</span><select class="select-control" id="financeFilter"><option value="all">All finance stages</option><option value="Sent to Payout">Awaiting acknowledgement</option><option value="Finance Review">Finance review</option><option value="Pending Approval">Pending approval</option><option value="Processing">Processing</option></select></div></div>
      <div id="financeTable">${tableMarkup(financeTickets, 'No requests currently require Finance action.', {owner:'finance'})}</div>
      <div class="queue-footer"><span>Every acknowledgement creates a linked Finance record against the original Ticket ID.</span><span>${financeTickets.filter(isOverdue).length} overdue</span></div>
    </section>
    <div class="callout-inline" style="margin-top:15px"><strong>Manual control:</strong> refund eligibility, exceptions and declines remain human decisions. Requests over ${money(APPROVAL_THRESHOLD)} require manager approval before moving to payout processing. This threshold is a demo assumption.</div>`;
}

function renderQueueHealth() {
  const statuses = ['Support Review','Awaiting Agent Info','Sent to Payout','Finance Review','Pending Approval','Processing'];
  const tickets = activeTickets();
  return statuses.map(status => {
    const count = tickets.filter(t => t.status === status).length;
    const pct = tickets.length ? Math.round(count / tickets.length * 100) : 0;
    const tone = isHighRiskStatus(status) ? 'amber' : status === 'Processing' ? 'teal' : '';
    return `<div class="health-row"><div class="health-label"><span>${STATUS_LABELS[status]}</span><strong>${count}</strong></div><div class="progress-track"><div class="progress-fill ${tone}" style="width:${pct}%"></div></div></div>`;
  }).join('');
}
function isHighRiskStatus(status) { return ['Awaiting Agent Info','Sent to Payout','Pending Approval'].includes(status); }

function renderManagement() {
  const c = getCounts();
  const closed = state.tickets.filter(t => CLOSED_STATUSES.has(t.status));
  const financeCoverage = c.total ? Math.round(c.financeRecords / c.total * 100) : 0;
  const overdueRate = c.open ? Math.round(c.overdue / c.open * 100) : 0;
  const closedWithRecord = closed.filter(financeRecordExists).length;
  const closureIntegrity = closed.length ? Math.round(closedWithRecord / closed.length * 100) : 100;
  return `${pageHead('MANAGEMENT OVERVIEW', 'Refund operations overview', 'Monitor workload, queue health and the controls designed to prevent lost handoffs and false closures.', `<button class="btn btn-secondary" data-action="reset-demo">↻ Reset demo data</button><button class="btn btn-primary" data-action="export">↧ Export records</button>`)}
    <section class="kpi-grid">
      ${kpi('Total refund tickets', c.total, '▤', '', 'All requests captured in the prototype')}
      ${kpi('Open requests', c.open, '◷', 'amber', 'Not yet paid or declined')}
      ${kpi('Paid / declined', c.closed, '✓', 'teal', `${c.paid} paid · ${c.declined} declined`)}
      ${kpi('Overdue stages', c.overdue, '!', 'red', `${overdueRate}% of open tickets`)}
    </section>
    <div class="management-grid">
      <section class="panel"><div class="panel-header"><div><h2 class="panel-title">Workflow distribution</h2><p class="panel-subtitle">Current ticket volume by stage</p></div><span class="tag">Live demo view</span></div><div class="panel-body"><div class="chart-legend"><span class="legend-key"><i class="legend-swatch"></i> Support / handoff</span><span class="legend-key"><i class="legend-swatch teal"></i> Finance / payout</span></div><div class="chart-area">${renderStageChart()}</div><p class="sla-note">Bars show current demo ticket counts, not historical monthly performance.</p></div></section>
      <div class="side-stack">
        <div class="metric-callout"><div class="callout-label">Closure integrity</div><strong>${closureIntegrity}%</strong><p>${closedWithRecord} of ${closed.length} closed tickets have a linked Finance record.</p></div>
        <section class="panel"><div class="panel-header"><div><h2 class="panel-title">Control checks</h2><p class="panel-subtitle">Automated guardrails in this prototype</p></div></div><div class="panel-body"><div class="mini-list">
          <div class="mini-list-item"><div><strong>Closed without Finance record</strong><span>Should always remain zero</span></div><span class="mini-number" style="color:${c.orphanClosed ? 'var(--red)' : 'var(--green)'}">${c.orphanClosed}</span></div>
          <div class="mini-list-item"><div><strong>Tickets with Finance record</strong><span>Finance intake coverage</span></div><span class="mini-number">${financeCoverage}%</span></div>
          <div class="mini-list-item"><div><strong>Overdue active tickets</strong><span>Ageing against assumed limits</span></div><span class="mini-number" style="color:${c.overdue ? 'var(--red)' : 'var(--green)'}">${c.overdue}</span></div>
        </div></div></section>
      </div>
    </div>
    ${renderInformalIntakeCard()}
    ${renderProcessIssuesCard()}
    <div class="content-grid" style="margin-top:17px">
      <section class="panel"><div class="panel-header"><div><h2 class="panel-title">Ageing & ownership watchlist</h2><p class="panel-subtitle">Tickets past their stage target, sorted by oldest first</p></div><span class="tag high">${c.overdue} alerts</span></div>${tableMarkup(sortTickets(activeTickets().filter(isOverdue), 'oldest'), 'No overdue tickets. Nice work.')}</section>
      <section class="panel"><div class="panel-header"><div><h2 class="panel-title">Operational assumptions</h2><p class="panel-subtitle">Editable policy decisions before real deployment</p></div></div><div class="panel-body"><div class="mini-list">
        ${Object.entries(SLA_HOURS).map(([status,hours])=>`<div class="mini-list-item"><div><strong>${STATUS_LABELS[status]}</strong><span>Stage response target</span></div><span class="mini-number">${hours}h</span></div>`).join('')}
        <div class="mini-list-item"><div><strong>Manager approval threshold</strong><span>Above this amount</span></div><span class="mini-number">${money(APPROVAL_THRESHOLD)}</span></div>
      </div><p class="sla-note">All SLA values and the approval threshold are illustrative demo assumptions. They need operational and finance sign-off.</p></div></section>
    </div>`;
}
function renderStageChart() {
  const stages = [
    ['Support Review', 'support'], ['Awaiting Agent Info','support'], ['Sent to Payout','support'],
    ['Finance Review','finance'], ['Pending Approval','finance'], ['Processing','finance'], ['Paid','finance'], ['Declined','finance']
  ];
  const max = Math.max(1, ...stages.map(([s]) => state.tickets.filter(t=>t.status===s).length));
  return stages.map(([status, group]) => {
    const count = state.tickets.filter(t => t.status === status).length;
    const height = Math.max(2, Math.round(count / max * 100));
    return `<div class="chart-col"><div class="chart-bars"><div class="chart-bar ${group==='finance'?'secondary':''}" style="height:${height}%" title="${count} ${STATUS_LABELS[status]}"></div></div><span class="chart-month">${STATUS_LABELS[status].replace('Awaiting agent info','Awaiting info').replace('Pending approval','Approval').replace('Support review','Support').replace('Finance review','Review').replace('Sent to payout','Handoff').replace('Processing','Payout').replace('Declined','Declined')}</span></div>`;
  }).join('');
}

function renderAllTickets() {
  const tickets = filterTickets();
  return `${pageHead('TICKET REGISTER', 'All refund tickets', 'Search the shared register, inspect the audit trail, and follow each request from intake to outcome.', `<button class="btn btn-secondary" data-action="export">↧ Export JSON</button><button class="btn btn-primary" data-action="new-ticket">＋ New ticket</button>`)}
    <section class="panel"><div class="panel-header"><div><h2 class="panel-title">Central refund register</h2><p class="panel-subtitle">One ticket record and one permanent reference across Support and Finance</p></div><span class="tag">${tickets.length} shown / ${state.tickets.length} total</span></div>
      <div class="panel-body" style="padding-bottom:13px"><div class="table-toolbar"><label class="search-box"><span>⌕</span><input id="ticketSearch" type="search" placeholder="Search ticket, agent, booking ref…" value="${escapeHtml(filters.search)}" /></label><select class="select-control" id="ticketStatusFilter"><option value="all" ${filters.status==='all'?'selected':''}>All statuses</option>${Object.keys(STATUS_LABELS).map(status=>`<option value="${status}" ${filters.status===status?'selected':''}>${STATUS_LABELS[status]}</option>`).join('')}</select><select class="select-control" id="ticketSort"><option value="oldest" ${filters.sort==='oldest'?'selected':''}>Oldest first</option><option value="newest" ${filters.sort==='newest'?'selected':''}>Newest first</option><option value="overdue" ${filters.sort==='overdue'?'selected':''}>Overdue first</option><option value="amount-high" ${filters.sort==='amount-high'?'selected':''}>Highest amount</option><option value="amount-low" ${filters.sort==='amount-low'?'selected':''}>Lowest amount</option></select><button class="btn btn-secondary btn-small" data-action="clear-filters">Clear filters</button></div></div>
      <div id="allTicketsTable">${tableMarkup(tickets, 'No tickets match these filters.')}</div><div class="queue-footer"><span>Search is local to this browser's demo data.</span><span>${tickets.filter(isOverdue).length} overdue in result</span></div>
    </section>
    <p class="footnote" style="margin:12px 2px 0">Potential duplicate detection runs when a new ticket is submitted. Similar open booking references are flagged for review before a second ticket can be created.</p>`;
}
function filterTickets() {
  const q = normalize(filters.search);
  let result = state.tickets.filter(ticket => {
    const matchStatus = filters.status === 'all' || ticket.status === filters.status;
    const haystack = normalize([ticket.ticketId,ticket.financeRefId,ticket.agentName,ticket.agentCompany,ticket.agentEmail,ticket.bookingRef,ticket.route].join(' '));
    return matchStatus && (!q || haystack.includes(q));
  });
  return sortTickets(result, filters.sort);
}

function renderTicketModal() {
  const ticket = getTicket(selectedTicketId);
  if (!ticket) { closeModal(); return; }
  const root = $('#modalRoot');
  const title = `<div><div class="eyebrow">REFUND TICKET</div><h2>${ticket.ticketId}</h2><p>${escapeHtml(ticket.agentName)} · ${escapeHtml(ticket.bookingRef)} · ${escapeHtml(ticket.route)}</p></div>`;
  const financeBox = financeRecordExists(ticket)
    ? `<div class="finance-record-box"><strong>Finance record linked · ${ticket.financeRecord.financeRefId}</strong><span>Received ${dateTime(ticket.financeRecord.receivedAt)} · Owner ${escapeHtml(ticket.financeRecord.acknowledgedBy || ticket.financeOwner || 'Finance')}</span></div>`
    : `<div class="callout-inline">No Finance record yet. Finance acknowledgement will create the linked record.</div>`;
  const details = `<div class="detail-layout"><div class="detail-main">
    <section class="detail-card"><h3>Request details</h3><div class="detail-fields">
      ${detailField('Agent / company', `${ticket.agentName} · ${ticket.agentCompany}`)}${detailField('Agent email', ticket.agentEmail)}
      ${detailField('Booking reference', ticket.bookingRef)}${detailField('Route', ticket.route)}
      ${detailField('Requested amount', money(ticket.amountRequested))}${detailField('Request reason', ticket.reason)}
      ${detailField('Received via', ticket.source)}${detailField('Ticket created', dateTime(ticket.createdAt))}
      ${detailField('Created via', ticket.created_via === 'ai_intake' ? 'AI Intake' : 'Manual')}
      ${detailField('Reply status', ticket.reply_status || 'not_applicable')}
    </div>${ticket.original_message ? `<div class="original-message"><strong>Original message</strong><p>${escapeHtml(ticket.original_message)}</p></div>` : ''}</section>
    <section class="detail-card"><h3>Financial details</h3><div class="detail-fields">
      ${detailField('Requested amount', ticket.amountRequested ? money(ticket.amountRequested) : 'Pending agent details')}${detailField('Paid amount', ticket.paidAmount == null ? 'Not paid' : money(ticket.paidAmount))}
      ${detailField('Deduction reason', ticket.deductionReason || 'No deduction recorded')}${detailField('Finance reference', ticket.financeRefId || 'Not yet assigned')}
    </div><div style="margin-top:12px">${financeBox}</div></section>
    <section class="detail-card"><h3>Activity history</h3><div class="activity-list">${(ticket.activity || []).map(item=>`<div class="activity-item"><div class="activity-marker">${item.type==='created'?'＋':item.type==='status'?'↗':'·'}</div><div class="activity-copy"><strong>${escapeHtml(item.actor)} <span class="footnote">· ${escapeHtml(item.role)}</span></strong><p>${escapeHtml(item.message)}</p><time>${dateTime(item.at)}</time></div></div>`).join('')}</div></section>
    <section class="detail-card"><h3>Internal comments</h3><form data-form="comment" class="form-field"><textarea name="comment" placeholder="Add an internal note for the next team…" required></textarea><div class="form-actions" style="padding-top:9px;margin-top:0"><button class="btn btn-secondary btn-small" type="submit">Add comment</button></div></form></section>
  </div><div class="detail-side">
    <section class="detail-card"><h3>Current status</h3>${statusBadge(ticket.status)}<div style="margin-top:12px" class="detail-fields">${detailField('Support owner',ticket.supportOwner)}${detailField('Finance owner',ticket.financeOwner || 'Not assigned')}${detailField('Stage age',elapsedLabel(ticket))}${detailField('Stage target',slaLabel(ticket))}</div>${isOverdue(ticket)?`<div class="notice warning" style="margin:12px 0 0;padding:10px"><div class="notice-icon">!</div><div><strong>Ageing alert</strong><p>This ticket has exceeded its assumed ${SLA_HOURS[ticket.status]}-hour stage limit.</p></div></div>`:''}</section>
    ${renderRoleActions(ticket)}
    ${renderAgentReplyCard(ticket)}
    <section class="detail-card"><h3>Agent updates · simulated</h3>${ticket.agentUpdates?.length ? ticket.agentUpdates.slice(0,5).map(update=>`<div class="activity-copy" style="padding:0 0 10px;border-bottom:1px solid #f0f2f6;margin-bottom:10px"><strong>Update prepared</strong><p>${escapeHtml(update.message)}</p><time>${dateTime(update.at)} · ${escapeHtml(update.channel)}</time></div>`).join('') : '<p class="footnote">No agent updates prepared yet.</p>'}<p class="footnote">These are in-app previews only. No email or WhatsApp message is sent.</p></section>
  </div></div>`;
  root.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Ticket details"><div class="modal-header">${title}<button class="modal-close" data-action="close-modal" aria-label="Close">×</button></div><div class="modal-body">${details}</div></div>`;
}
function detailField(label, value) { return `<div class="detail-field"><span>${label}</span><strong>${safeText(value)}</strong></div>`; }

function renderRoleActions(ticket) {
  const panel = content => `<section class="action-panel">${content}</section>`;
  if (currentView === 'support' || currentView === 'tickets') {
    if (ticket.status === 'Support Review') return panel(`<h3>Support actions</h3><p class="footnote">Confirm the required details are present, then hand this ticket to Finance. Eligibility is decided by Finance.</p><div class="action-buttons"><button class="btn btn-primary btn-small" data-ticket-action="send-finance" data-ticket-id="${ticket.ticketId}">Send to Finance →</button></div>`);
    if (ticket.status === 'Awaiting Agent Info') return panel(`<h3>Support follow-up</h3><p class="footnote">Record what the agent provided before resubmitting. AI-created tickets require the structured booking reference, route and requested amount before they can move to Support review.</p><div class="action-buttons">${ticket.created_via==='ai_intake'?`<button class="btn btn-secondary btn-small" data-ticket-action="open-complete-intake-details" data-ticket-id="${ticket.ticketId}">Complete ticket details</button>`:`<button class="btn btn-primary btn-small" data-ticket-action="open-info-response" data-ticket-id="${ticket.ticketId}">Record details & resubmit</button>`}</div>`);
    return panel(`<h3>Support visibility</h3><p class="footnote">Support can view progress and add internal comments. Finance controls approval, payment, decline and closure.</p>`);
  }
  if (currentView === 'finance') {
    if (ticket.status === 'Sent to Payout') return panel(`<h3>Finance intake</h3><p class="footnote">Acknowledge receipt to accept ownership and create the linked Finance record.</p><div class="action-buttons"><button class="btn btn-primary btn-small" data-ticket-action="ack-finance" data-ticket-id="${ticket.ticketId}">Acknowledge request</button></div>`);
    if (ticket.status === 'Finance Review') return panel(`<h3>Finance decision</h3><p class="footnote">Review eligibility and policy evidence manually. Requests above ${money(APPROVAL_THRESHOLD)} must go to a manager before payout.</p><div class="action-buttons"><button class="btn btn-success btn-small" data-ticket-action="approve-finance" data-ticket-id="${ticket.ticketId}">${ticket.amountRequested > APPROVAL_THRESHOLD ? 'Request manager approval' : 'Approve for payout'}</button><button class="btn btn-secondary btn-small" data-ticket-action="open-request-info" data-ticket-id="${ticket.ticketId}">Request info</button><button class="btn btn-danger btn-small" data-ticket-action="open-decline" data-ticket-id="${ticket.ticketId}">Decline</button></div>`);
    if (ticket.status === 'Pending Approval') return panel(`<h3>Manager approval pending</h3><p class="footnote">This request exceeds the ${money(APPROVAL_THRESHOLD)} threshold. Management must record an approval decision.</p>`);
    if (ticket.status === 'Processing') return panel(`<h3>Payout processing</h3><p class="footnote">Once the payout is confirmed, enter the amount actually paid and explain any deduction. This is the only action that marks the ticket Paid.</p><div class="action-buttons"><button class="btn btn-success btn-small" data-ticket-action="open-payment" data-ticket-id="${ticket.ticketId}">Record payout & close</button></div>`);
    return panel(`<h3>Finance view</h3><p class="footnote">This ticket is not currently awaiting Finance action.</p>`);
  }
  if (currentView === 'management' && ticket.status === 'Pending Approval') return panel(`<h3>Manager decision required</h3><p class="footnote">Manual approval is required because the requested amount exceeds ${money(APPROVAL_THRESHOLD)}.</p><div class="action-buttons"><button class="btn btn-success btn-small" data-ticket-action="manager-approve" data-ticket-id="${ticket.ticketId}">Approve exception</button><button class="btn btn-danger btn-small" data-ticket-action="open-manager-decline" data-ticket-id="${ticket.ticketId}">Reject approval</button></div>`);
  return panel(`<h3>Management controls</h3><p class="footnote">Management monitors queue health and approves high-value exceptions. Finance remains responsible for recording payout or decline.</p>`);
}

function openNewTicketModal() {
  selectedTicketId = null; modalAction = null;
  $('#modalRoot').innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Create refund ticket"><div class="modal-header"><div><div class="eyebrow">SUPPORT INTAKE</div><h2>Create refund request</h2><p>A permanent ticket ID is generated when you submit this form.</p></div><button class="modal-close" data-action="close-modal" aria-label="Close">×</button></div><div class="modal-body">
    <div class="notice info"><div class="notice-icon">i</div><div><strong>No ticket, no refund.</strong><p>For requests arriving through email, WhatsApp or phone, create the ticket here and return its ID to the agent immediately. Duplicate checks run before saving.</p></div></div>
    <form data-form="create-ticket" id="createTicketForm"><div class="form-grid">
      ${field('Agent name','agentName','text','e.g. Aditi Sharma',true)}${field('Agency / company','agentCompany','text','e.g. Horizon Travel Desk',true)}
      ${field('Agent email','agentEmail','email','agent@example.com',true)}${field('Booking reference','bookingRef','text','e.g. BKG-DEL-12345',true)}
      ${field('Route','route','text','e.g. DEL → DXB',true)}${field('Requested refund amount (₹)','amountRequested','number','e.g. 18500',true,'min="1" step="1"')}
      <div class="form-field"><label for="source">Request received via <span class="required">*</span></label><select name="source" id="source" required><option value="Email">Email</option><option value="WhatsApp">WhatsApp</option><option value="Phone">Phone</option><option value="Portal">Portal</option><option value="Other">Other</option></select></div>
      <div class="form-field"><label for="reason">Refund reason <span class="required">*</span></label><select name="reason" id="reason" required><option value="Flight cancellation">Flight cancellation</option><option value="Passenger cancellation">Passenger cancellation</option><option value="Schedule change">Schedule change</option><option value="Duplicate booking">Duplicate booking</option><option value="Hotel cancellation">Hotel cancellation</option><option value="Other">Other</option></select></div>
      <div class="form-field full"><label for="notes">Request details / supporting context</label><textarea name="notes" id="notes" placeholder="Summarise the request and note any evidence received…"></textarea><span class="form-hint">Do not enter card, bank-account, passport or other sensitive information in this demo.</span></div>
      <div class="form-field"><label for="supportOwner">Assigned Support owner <span class="required">*</span></label><select name="supportOwner" id="supportOwner">${SUPPORT_USERS.map(user=>`<option ${user===SUPPORT_USERS[0]?'selected':''}>${user}</option>`).join('')}</select></div>
    </div><div id="duplicateWarning"></div><div id="createError" class="form-error" role="alert"></div><div class="form-actions"><button type="button" class="btn btn-secondary" data-action="close-modal">Cancel</button><button type="submit" class="btn btn-primary">Generate ticket ID & create →</button></div></form>
    <p class="footnote" style="margin:12px 0 0">After creation, the new Ticket ID is displayed for the Support agent to share with the requester. Actual email / WhatsApp delivery is not connected.</p>
  </div></div>`;
  const form = $('#createTicketForm');
  form?.addEventListener('input', event => { if (event.target.id !== 'duplicateOverride') updateDuplicateWarning(); });
  form?.addEventListener('change', event => { if (event.target.id !== 'duplicateOverride') updateDuplicateWarning(); });
}
function field(label, name, type, placeholder, required = false, extra = '') {
  return `<div class="form-field"><label for="${name}">${label} ${required?'<span class="required">*</span>':''}</label><input id="${name}" name="${name}" type="${type}" placeholder="${placeholder}" ${required?'required':''} ${extra} /></div>`;
}
function findPotentialDuplicates(data) {
  const booking = normalize(data.bookingRef);
  const email = normalize(data.agentEmail);
  const route = normalize(data.route);
  const amount = Number(data.amountRequested || 0);
  return state.tickets.filter(ticket => {
    const sameBooking = booking && normalize(ticket.bookingRef) === booking;
    const sameAgentRouteAmount = email && normalize(ticket.agentEmail) === email && route && normalize(ticket.route) === route && Math.abs(Number(ticket.amountRequested)-amount) <= Math.max(100, amount * .01);
    return sameBooking || sameAgentRouteAmount;
  });
}
function updateDuplicateWarning() {
  const form = $('#createTicketForm');
  const warning = $('#duplicateWarning');
  if (!form || !warning) return;
  const data = Object.fromEntries(new FormData(form).entries());
  if (!data.bookingRef || !data.agentEmail || !data.amountRequested || !data.route) { warning.innerHTML = ''; return; }
  const matches = findPotentialDuplicates(data);
  if (!matches.length) { warning.innerHTML = ''; return; }
  const wasChecked = Boolean($('#duplicateOverride')?.checked);
  warning.innerHTML = `<div class="duplicate-warning"><strong>⚠ Possible duplicate request found</strong>${matches.map(t=>`${t.ticketId} · ${escapeHtml(t.agentName)} · ${escapeHtml(t.bookingRef)} · ${statusBadge(t.status)}`).join('<br>')}<label class="checkbox-row"><input type="checkbox" name="duplicateOverride" id="duplicateOverride" /> I checked the existing ticket(s) and confirm this is a separate refund request.</label><span class="form-hint">A reason for creating a second ticket will be added to its audit history.</span></div>`;
  if (wasChecked) $('#duplicateOverride').checked = true;
}

function closeModal() { selectedTicketId = null; modalAction = null; $('#modalRoot').innerHTML = ''; }
function openTicket(id) { selectedTicketId = id; modalAction = null; renderTicketModal(); }
function showActionPanel(ticketId, type) {
  const ticket = getTicket(ticketId); if (!ticket) return;
  modalAction = type; selectedTicketId = ticketId;
  const title = ({'request-info':'Request additional information','decline':'Decline refund request','payment':'Record payout','manager-decline':'Reject manager approval','info-response':'Record information received','complete-intake-details':'Complete missing ticket details'})[type] || 'Ticket action';
  const helper = ({'request-info':'Explain exactly what Finance needs from the agent. This moves the ticket back to the Support queue.','decline':'A clear decline reason is required. Finance will own and record this outcome.','payment':'Enter the actual amount paid. A deduction reason is required if the paid amount is lower than requested.','manager-decline':'Provide the reason the high-value approval is rejected. Finance must communicate and record the final decline.','info-response':'Record the information received from the agent. The ticket will be resubmitted to Finance.','complete-intake-details':'Enter the booking reference and requested amount confirmed by the agent. Do not guess missing values.'})[type];
  const formFields = type === 'payment'
    ? `<div class="form-field"><label>Amount paid (₹) <span class="required">*</span></label><input name="paidAmount" type="number" min="0" step="1" value="${ticket.amountRequested || ''}" required /></div><div class="form-field"><label>Deduction reason</label><textarea name="deductionReason" placeholder="Required when amount paid is lower than amount requested…"></textarea></div>`
    : type === 'complete-intake-details'
      ? `<div class="form-grid"><div class="form-field"><label>Agent / agency name <span class="required">*</span></label><input name="agentCompany" value="${escapeHtml(ticket.agentCompany === 'Agency not identified' ? '' : ticket.agentCompany || '')}" required /></div><div class="form-field"><label>Booking reference <span class="required">*</span></label><input name="bookingRef" value="${escapeHtml(ticket.bookingRef || '')}" required /></div><div class="form-field"><label>Requested amount (₹) <span class="required">*</span></label><input name="amountRequested" type="number" min="1" step="1" value="${ticket.amountRequested || ''}" required /></div><div class="form-field"><label>Route <span class="required">*</span></label><input name="route" value="${escapeHtml(ticket.route || '')}" required /></div><div class="form-field"><label>Agent email (optional)</label><input name="agentEmail" type="email" value="${escapeHtml(ticket.agentEmail || '')}" /></div><div class="form-field full"><label>Additional context (optional)</label><textarea name="actionReason" placeholder="Record any additional detail received…"></textarea></div></div>`
      : `<div class="form-field"><label>${type==='info-response'?'Information received':'Reason / details'} <span class="required">*</span></label><textarea name="actionReason" required placeholder="${type==='request-info'?'e.g. Please share the airline cancellation confirmation…':type==='decline'?'e.g. Non-refundable fare as per airline policy…':type==='manager-decline'?'e.g. Exception not supported by policy…':'Describe the additional information received…'}"></textarea></div>`;
  const actionLabel = ({'request-info':'Send request to Support','decline':'Record decline & close','payment':'Confirm payout & close','manager-decline':'Record rejection','info-response':'Resubmit to Finance','complete-intake-details':'Save details & return to Support review'})[type];
  const container = $('.detail-side', $('#modalRoot'));
  if (!container) return;
  const existing = $('#actionFormPanel', container); if (existing) existing.remove();
  const html = `<section class="action-panel" id="actionFormPanel"><h3>${title}</h3><p class="footnote">${helper}</p><form data-form="ticket-action" data-ticket-id="${ticketId}" data-action-type="${type}">${formFields}<div id="actionError" class="form-error"></div><div class="action-buttons"><button type="submit" class="btn ${type.includes('decline')?'btn-danger':'btn-primary'} btn-small">${actionLabel}</button><button type="button" class="btn btn-secondary btn-small" data-action="cancel-action">Cancel</button></div></form></section>`;
  container.insertAdjacentHTML('afterbegin', html);
  $('#actionFormPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function createTicket(form, options = {}) {
  const data = options.data || Object.fromEntries(new FormData(form).entries());
  const isAIIntake = options.createdVia === 'ai_intake';
  const error = $('#createError');
  if (!isAIIntake && (!data.agentName || !data.agentCompany || !data.agentEmail || !data.bookingRef || !data.route || !data.amountRequested || Number(data.amountRequested) <= 0)) {
    if (error) error.textContent = 'Complete all required fields and enter a valid amount.';
    else showToast('Complete all required fields and enter a valid amount.', 'error');
    return null;
  }
  const duplicates = isAIIntake ? [] : findPotentialDuplicates(data);
  if (duplicates.length && !data.duplicateOverride) {
    if (error) error.textContent = 'A possible duplicate exists. Review the match and confirm this is a separate request before creating.';
    else showToast('A possible duplicate exists. Review it before creating another ticket.', 'warning');
    return null;
  }
  const ticketId = nextTicketId();
  const createdAt = now();
  const route = String(data.route || '').trim().toUpperCase().replace(/\s*[-→]\s*/g, ' → ');
  const ticket = {
    ticketId, financeRefId:null, agentName:String(data.agentName || '').trim() || (isAIIntake ? 'Contact not provided' : ''), agentCompany:String(data.agentCompany || '').trim() || (isAIIntake ? 'Agency not identified' : ''), agentEmail:String(data.agentEmail || '').trim(), bookingRef:String(data.bookingRef || '').trim().toUpperCase(), route, amountRequested:data.amountRequested === '' || data.amountRequested == null ? null : Number(data.amountRequested), paidAmount:null, deductionReason:'', reason:data.reason || (isAIIntake ? 'Refund request' : ''), source:data.source || options.sourceChannel || 'Unknown', notes:String(data.notes || '').trim(), status:options.status || 'Support Review', supportOwner:data.supportOwner || currentUser || SUPPORT_USERS[0], financeOwner:null, createdAt, updatedAt:createdAt, stageStartedAt:createdAt, financeAckAt:null, financeRecord:null, declineReason:'', activity:[], agentUpdates:[],
    source_channel:options.sourceChannel || data.source || 'Unknown', created_via:options.createdVia || 'manual', original_message:options.originalMessage || '', reply_status:options.replyStatus || 'not_applicable', reply_text:options.replyText || '', reply_drafted_at:options.replyStatus === 'drafted' ? createdAt : null, reply_sent_at:null, referenced_ticket_id:options.referencedTicketId || null
  };
  addActivity(ticket, isAIIntake ? 'Refund request created from AI Intake after Support review. Unique ticket ID generated; reply remains a draft.' : 'Refund request logged. Unique ticket ID generated and ready for Support review.', 'Support', ticket.supportOwner, 'created');
  if (duplicates.length) addActivity(ticket, `Potential duplicate override recorded after review of ${duplicates.map(t=>t.ticketId).join(', ')}.`, 'Support', ticket.supportOwner, 'note');
  state.tickets.unshift(ticket);
  if (!isAIIntake) queueAgentUpdate(ticket, `Your refund request has been registered. Please use reference ${ticket.ticketId} for all follow-ups.`);
  saveState();
  if (options.silent) {
    render();
    return ticket;
  }
  $('#modalRoot').innerHTML = `<div class="modal" role="dialog" aria-modal="true"><div class="modal-header"><div><div class="eyebrow">TICKET CREATED</div><h2>Request successfully logged</h2><p>Return this reference to the agent immediately.</p></div><button class="modal-close" data-action="close-modal">×</button></div><div class="modal-body"><div class="metric-callout"><div class="callout-label">NEW TICKET ID</div><strong style="font-size:25px">${ticketId}</strong><p>This ID is the single reference for Support and Finance. Agent notification is simulated in this prototype.</p></div><div class="form-actions"><button class="btn btn-secondary" data-action="copy-ticket" data-ticket-id="${ticketId}">Copy ticket ID</button><button class="btn btn-primary" data-action="open-created-ticket" data-ticket-id="${ticketId}">View ticket →</button></div></div></div>`;
  render();
  showToast(`Ticket ${ticketId} created. Share this reference with the agent.`, 'success');
  return ticket;
}

function sendToFinance(ticket) {
  if (!SUPPORT_QUEUE.has(ticket.status)) return showToast('Only Support-owned requests can be submitted to Finance.', 'warning');
  if (!ticket.agentName || !ticket.agentCompany || !ticket.bookingRef || !ticket.route || !ticket.amountRequested || !ticket.reason || (ticket.created_via==='ai_intake' && ticket.agentCompany==='Agency not identified')) return showToast('Complete the ticket details before handoff.', 'error');
  ticket.financeOwner = FINANCE_USERS[state.tickets.indexOf(ticket) % FINANCE_USERS.length];
  changeStatus(ticket, 'Sent to Payout', 'Support submitted the complete request to the Finance intake queue. Finance acknowledgement is pending.', 'Support', ticket.supportOwner, `Your refund request ${ticket.ticketId} has been submitted to BharatTrip Finance for review.`);
  saveState(); render(); renderTicketModal(); showToast(`${ticket.ticketId} routed to Finance. Awaiting acknowledgement.`, 'success');
}
function acknowledgeFinance(ticket) {
  if (ticket.status !== 'Sent to Payout') return;
  const record = ensureFinanceRecord(ticket);
  ticket.financeOwner = currentUser === MANAGER_USER ? FINANCE_USERS[0] : currentUser;
  record.acknowledgedBy = ticket.financeOwner;
  changeStatus(ticket, 'Finance Review', `Finance acknowledged receipt and created linked record ${record.financeRefId}.`, 'Finance', ticket.financeOwner, `Finance has acknowledged request ${ticket.ticketId}. The refund is now under review.`);
  saveState(); render(); renderTicketModal(); showToast(`Finance record ${record.financeRefId} created and linked.`, 'success');
}
function approveFinance(ticket) {
  if (ticket.status !== 'Finance Review') return;
  ensureFinanceRecord(ticket);
  if (Number(ticket.amountRequested) > APPROVAL_THRESHOLD) {
    changeStatus(ticket, 'Pending Approval', `Finance completed its initial review and routed the ${money(ticket.amountRequested)} request for manager approval.`, 'Finance', currentUser, `Your request ${ticket.ticketId} has passed initial Finance review and is awaiting additional approval.`);
    showToast('Manager approval required for this amount.', 'warning');
  } else {
    changeStatus(ticket, 'Processing', 'Finance approved the request for payout processing.', 'Finance', currentUser, `Your refund request ${ticket.ticketId} has been approved and is being processed.`);
    showToast('Request approved and moved to payout processing.', 'success');
  }
  saveState(); render(); renderTicketModal();
}
function managerApprove(ticket) {
  if (ticket.status !== 'Pending Approval') return;
  changeStatus(ticket, 'Processing', `Management approved the high-value exception (${money(ticket.amountRequested)}). Finance retains responsibility for payout.`, 'Management', MANAGER_USER, `The additional approval for request ${ticket.ticketId} has been granted. Finance will continue payout processing.`);
  saveState(); render(); renderTicketModal(); showToast('Exception approved. Finance can now record the payout.', 'success');
}
function requestInfo(ticket, reason) {
  if (!reason.trim()) return showToast('Enter the information Finance needs.', 'error');
  ticket.requestedInfo = reason.trim();
  changeStatus(ticket, 'Awaiting Agent Info', `Finance requested additional information: ${reason.trim()}`, 'Finance', currentUser, `We need additional information to continue refund request ${ticket.ticketId}: ${reason.trim()}`);
  saveState(); render(); renderTicketModal(); showToast('Request returned to Support for agent follow-up.', 'success');
}
function submitInfoResponse(ticket, reason) {
  if (!reason.trim()) return showToast('Record the information received before resubmitting.', 'error');
  ticket.notes = `${ticket.notes ? ticket.notes+'\n' : ''}Additional agent information: ${reason.trim()}`;
  ticket.financeOwner = ticket.financeOwner || FINANCE_USERS[0];
  changeStatus(ticket, 'Sent to Payout', `Support recorded additional information and resubmitted the request to Finance: ${reason.trim()}`, 'Support', ticket.supportOwner, `The additional information for request ${ticket.ticketId} has been received and sent back to Finance for review.`);
  saveState(); render(); renderTicketModal(); showToast('Updated request resubmitted to Finance.', 'success');
}
function completeAIIntakeDetails(ticket, data) {
  const bookingRef = String(data.bookingRef || '').trim().toUpperCase();
  const route = String(data.route || '').trim().toUpperCase().replace(/\s*[-→]\s*/g, ' → ');
  const amount = Number(data.amountRequested);
  const agentCompany = String(data.agentCompany || '').trim();
  if (!agentCompany || !bookingRef || !route || !Number.isFinite(amount) || amount <= 0) return showToast('Enter an agent / agency name, booking reference, route and valid requested amount before continuing.', 'error');
  ticket.agentCompany = agentCompany;
  ticket.bookingRef = bookingRef;
  ticket.route = route;
  ticket.amountRequested = amount;
  if (data.agentEmail) ticket.agentEmail = String(data.agentEmail).trim();
  if (data.actionReason) ticket.notes = `${ticket.notes ? ticket.notes+'\n' : ''}Additional agent information: ${String(data.actionReason).trim()}`;
  changeStatus(ticket, 'Support Review', 'Support completed the missing structured ticket details received from the agent. The request is ready for Support validation and Finance handoff.', 'Support', currentUser);
  saveState(); render(); renderTicketModal(); showToast('Ticket details saved. Support can now validate and send it to Finance.', 'success');
}

function declineTicket(ticket, reason, role = 'Finance') {
  if (!reason.trim()) return showToast('A clear decline reason is required.', 'error');
  if (role === 'Finance' && ticket.status !== 'Finance Review') return showToast('Finance must acknowledge and review the request before declining it.', 'warning');
  ensureFinanceRecord(ticket);
  ticket.declineReason = reason.trim();
  ticket.financeRecord.outcome = 'Declined';
  changeStatus(ticket, 'Declined', `Finance declined the refund request. Reason: ${reason.trim()}`, 'Finance', currentUser, `Finance has declined refund request ${ticket.ticketId}. Reason: ${reason.trim()}`);
  if (!financeRecordExists(ticket)) throw new Error('Closure guard: cannot close a ticket without a Finance record.');
  saveState(); render(); renderTicketModal(); showToast('Decline recorded. Ticket closed by Finance.', 'success');
}
function recordPayment(ticket, paidAmount, deductionReason) {
  if (ticket.status !== 'Processing') return showToast('Only requests in payout processing can be marked paid.', 'warning');
  const amount = Number(paidAmount);
  if (!Number.isFinite(amount) || amount < 0) return showToast('Enter a valid amount paid.', 'error');
  if (amount < Number(ticket.amountRequested) && !deductionReason.trim()) return showToast('Explain any deduction before recording payment.', 'error');
  if (amount > Number(ticket.amountRequested) * 1.1) return showToast('Paid amount is unusually higher than requested. Review the amount.', 'error');
  const record = ensureFinanceRecord(ticket);
  ticket.paidAmount = amount;
  ticket.deductionReason = deductionReason.trim();
  record.paidAmount = amount;
  record.deductionReason = deductionReason.trim();
  record.outcome = 'Paid';
  changeStatus(ticket, 'Paid', `Finance recorded payout of ${money(amount)}${deductionReason.trim() ? `. Deduction: ${deductionReason.trim()}` : ''}.`, 'Finance', currentUser, `Refund request ${ticket.ticketId} has been paid. Amount: ${money(amount)}${deductionReason.trim() ? `. Deduction: ${deductionReason.trim()}` : ''}`);
  if (!financeRecordExists(ticket)) throw new Error('Closure guard: cannot close a ticket without a Finance record.');
  saveState(); render(); renderTicketModal(); showToast('Payout recorded. Ticket closed by Finance.', 'success');
}

function addComment(ticket, comment) {
  if (!comment.trim()) return;
  addActivity(ticket, comment.trim(), currentView === 'finance' ? 'Finance' : currentView === 'management' ? 'Management' : 'Support', currentUser, 'note');
  saveState(); renderTicketModal(); showToast('Internal comment added.', 'success');
}

function showToast(message, type = 'success') {
  const region = $('#toastRegion'); if (!region) return;
  const toast = document.createElement('div'); toast.className = `toast ${type}`; toast.textContent = message; region.appendChild(toast);
  setTimeout(() => toast.remove(), 4200);
}
function exportData() {
  const payload = { exportedAt: now(), notice: 'Synthetic demo data only. This frontend prototype is not a production system.', config: { approvalThreshold: APPROVAL_THRESHOLD, slaHours: SLA_HOURS, intakeReplyLimitHours: INTAKE_REPLY_LIMIT_HOURS }, ...state };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `bharattrip-refundops-demo-${new Date().toISOString().slice(0,10)}.json`; anchor.click(); URL.revokeObjectURL(url);
  showToast('Demo data exported as JSON.', 'success');
}
function resetDemo() {
  if (!confirm('Reset this browser to the original synthetic sample tickets? All locally created demo tickets and changes will be removed.')) return;
  state = seedState(); aiIntakeDraft=null; aiIntakeInput={ message:'', channel:'Email' }; aiIntakeError=''; aiIntakeLoading=false; saveState(); closeModal(); render(); showToast('Demo data reset to the original sample records and process issue list.', 'success');
}
function copyText(value) {
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(value).then(()=>showToast('Copied to clipboard.', 'success')).catch(()=>showToast(value, 'warning'));
  else showToast(value, 'warning');
}

// Event delegation: all static and dynamically rendered controls share these handlers.
document.addEventListener('click', event => {
  const nav = event.target.closest('[data-view]');
  if (nav) {
    currentView = nav.dataset.view;
    currentUser = currentView === 'support' ? SUPPORT_USERS[0] : currentView === 'finance' ? FINANCE_USERS[0] : currentView === 'management' ? MANAGER_USER : 'Operations Viewer';
    filters = { search:'', status:'all', sort:'oldest' };
    notificationOpen = false; $('#notificationPopover').hidden = true;
    $('#sidebar').classList.remove('open');
    closeModal(); render(); return;
  }
  const aiSample = event.target.closest('[data-ai-sample]');
  if (aiSample) {
    const sample = AI_INTAKE_SAMPLES[Number(aiSample.dataset.aiSample)];
    if (sample) { aiIntakeInput = { message:sample.message, channel:sample.channel }; aiIntakeDraft=null; aiIntakeError=''; render(); showToast('Sample message loaded. Select Analyse to continue.', 'success'); }
    return;
  }
  const aiAction = event.target.closest('[data-ai-action]');
  if (aiAction) {
    switch (aiAction.dataset.aiAction) {
      case 'analyse': analyseAIIntake(); break;
      case 'discard': aiIntakeDraft=null; aiIntakeError=''; render(); break;
      case 'confirm': confirmAIIntake(); break;
      case 'flag': flagAIProcessIssue(); break;
    }
    return;
  }
  const openBtn = event.target.closest('[data-open-ticket]');
  if (openBtn) { openTicket(openBtn.dataset.openTicket); return; }
  const ticketAction = event.target.closest('[data-ticket-action]');
  if (ticketAction) {
    const ticket = getTicket(ticketAction.dataset.ticketId); if (!ticket) return;
    switch (ticketAction.dataset.ticketAction) {
      case 'send-finance': sendToFinance(ticket); break;
      case 'ack-finance': acknowledgeFinance(ticket); break;
      case 'approve-finance': approveFinance(ticket); break;
      case 'manager-approve': managerApprove(ticket); break;
      case 'open-request-info': showActionPanel(ticket.ticketId,'request-info'); break;
      case 'open-decline': showActionPanel(ticket.ticketId,'decline'); break;
      case 'open-payment': showActionPanel(ticket.ticketId,'payment'); break;
      case 'open-manager-decline': showActionPanel(ticket.ticketId,'manager-decline'); break;
      case 'open-info-response': showActionPanel(ticket.ticketId,'info-response'); break;
      case 'open-complete-intake-details': showActionPanel(ticket.ticketId,'complete-intake-details'); break;
      case 'mark-reply-sent': markReplyAsSent(ticket); break;
    }
    return;
  }
  const action = event.target.closest('[data-action]');
  if (!action) return;
  switch (action.dataset.action) {
    case 'new-ticket': openNewTicketModal(); break;
    case 'close-modal': closeModal(); break;
    case 'export': exportData(); break;
    case 'reset-demo': resetDemo(); break;
    case 'clear-filters': filters = { search:'', status:'all', sort:'oldest' }; render(); break;
    case 'cancel-action': $('#actionFormPanel')?.remove(); break;
    case 'copy-ticket': copyText(action.dataset.ticketId); break;
    case 'copy-reply': { const ticket = getTicket(action.dataset.ticketId); if (ticket) copyText(ticket.reply_text || ''); break; }
    case 'open-created-ticket': currentView='tickets'; currentUser='Operations Viewer'; closeModal(); render(); openTicket(action.dataset.ticketId); break;
  }
  if (event.target.id === 'notificationsButton' || event.target.closest('#notificationsButton')) toggleNotifications();
});

document.addEventListener('submit', event => {
  const form = event.target;
  if (form.matches('[data-form="create-ticket"]')) { event.preventDefault(); createTicket(form); return; }
  if (form.matches('[data-form="ai-intake-review"]')) { event.preventDefault(); confirmAIIntake(); return; }
  if (form.matches('[data-form="comment"]')) {
    event.preventDefault(); const ticket = getTicket(selectedTicketId); if (ticket) addComment(ticket, new FormData(form).get('comment')); return;
  }
  if (form.matches('[data-form="ticket-action"]')) {
    event.preventDefault(); const ticket = getTicket(form.dataset.ticketId); if (!ticket) return;
    const data = Object.fromEntries(new FormData(form).entries());
    switch (form.dataset.actionType) {
      case 'request-info': requestInfo(ticket, data.actionReason); break;
      case 'decline': declineTicket(ticket, data.actionReason); break;
      case 'payment': recordPayment(ticket, data.paidAmount, data.deductionReason || ''); break;
      case 'manager-decline': showToast('Manager rejection must be returned to Finance for a formal, reasoned decision. No ticket was closed.', 'warning'); ticket.managerRejectionReason=data.actionReason; addActivity(ticket, `Management did not approve the exception: ${data.actionReason}. Returned to Finance for policy decision.`, 'Management', MANAGER_USER, 'note'); changeStatus(ticket,'Finance Review','Management returned the request to Finance for a final policy decision.','Management',MANAGER_USER,`Additional approval for ${ticket.ticketId} was not granted. Finance will review the outcome.`); saveState(); render(); renderTicketModal(); break;
      case 'info-response': submitInfoResponse(ticket, data.actionReason); break;
      case 'complete-intake-details': completeAIIntakeDetails(ticket, data); break;
    }
  }
});

document.addEventListener('change', event => {
  if (event.target.id === 'aiClassification') updateAIReviewMode();
  if (event.target.name === 'resolution' && aiIntakeDraft) aiIntakeDraft.resolutionTouched = true;
  if (event.target.closest('#aiIntakeReviewForm') && event.target.matches('[data-ai-review-field]')) {
    const key = event.target.dataset.aiReviewField;
    if (['agent_name','route','referenced_ticket_id'].includes(key)) refreshAIReviewMatches();
    const confirmation = $(`[data-ai-confirm-field="${key}"]`, $('#aiIntakeReviewForm'));
    if (confirmation) confirmation.checked = false;
    if (key === 'confidence') updateAIReviewMode();
  }
  if (event.target.id === 'financeFilter') {
    const value = event.target.value;
    const tickets = sortTickets(state.tickets.filter(t=>FINANCE_QUEUE.has(t.status) && (value==='all'||t.status===value)), 'overdue');
    $('#financeTable').innerHTML = tableMarkup(tickets, 'No requests match this stage filter.', {owner:'finance'});
  }
  if (event.target.id === 'ticketStatusFilter') { filters.status=event.target.value; refreshAllTicketsTable(); }
  if (event.target.id === 'ticketSort') { filters.sort=event.target.value; refreshAllTicketsTable(); }
});
document.addEventListener('input', event => {
  if (event.target.id === 'aiClassification') updateAIReviewMode();
  if (event.target.closest('#aiIntakeReviewForm') && event.target.matches('[data-ai-review-field]')) {
    const key = event.target.dataset.aiReviewField;
    if (['agent_name','route','referenced_ticket_id'].includes(key)) refreshAIReviewMatches();
    const confirmation = $(`[data-ai-confirm-field="${key}"]`, $('#aiIntakeReviewForm'));
    if (confirmation) confirmation.checked = false;
    if (key === 'confidence') updateAIReviewMode();
  }
  if (event.target.id === 'ticketSearch') { filters.search=event.target.value; refreshAllTicketsTable(); }
});
function refreshAllTicketsTable() {
  const container = $('#allTicketsTable'); if (!container) return;
  const tickets = filterTickets(); container.innerHTML = tableMarkup(tickets, 'No tickets match these filters.');
  const tag = $('.panel-header .tag'); if (tag) tag.textContent = `${tickets.length} shown / ${state.tickets.length} total`;
}

function toggleNotifications() {
  notificationOpen = !notificationOpen;
  const panel = $('#notificationPopover');
  if (!panel) return;
  panel.hidden = !notificationOpen;
  if (notificationOpen) {
    lastViewedUpdateCount = state.notifications.length;
    $('#notificationDot').style.display = 'none';
    panel.innerHTML = `<h3>Recent workflow updates</h3>${state.notifications.length ? state.notifications.slice(0,8).map(note=>`<div class="notification-item"><strong>${escapeHtml(note.title)} · ${escapeHtml(note.ticketId)}</strong><p>${escapeHtml(note.message)}</p><time>${dateTime(note.at)}</time></div>`).join('') : '<p class="footnote">No new updates.</p>'}<p class="footnote" style="margin:10px 0 0">Agent notifications are simulated; no message is actually sent.</p>`;
  }
}

$('#mobileMenu')?.addEventListener('click', () => $('#sidebar').classList.toggle('open'));
$('#notificationsButton')?.addEventListener('click', event => { event.stopPropagation(); toggleNotifications(); });
document.addEventListener('click', event => {
  if (notificationOpen && !event.target.closest('#notificationPopover') && !event.target.closest('#notificationsButton')) {
    notificationOpen=false; $('#notificationPopover').hidden=true;
  }
  if (event.target === $('#modalRoot')) closeModal();
});

// Initial render. Ageing is recalculated on refresh and when views are changed.
render();
