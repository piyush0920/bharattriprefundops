# BharatTrip RefundOps — Frontend Prototype

A responsive, frontend-only refund request management prototype for GitHub Pages. It simulates how Support, Finance and Management can work from one shared refund ticket record.

## What is included

- **Support desk:** create refund tickets, generate unique ticket IDs, capture agent/booking details, detect likely duplicates, assign a Support owner and submit complete requests to Finance.
- **Finance desk:** acknowledge handoffs, create a linked Finance reference, request more information, make manual approval/decline decisions, route high-value requests for manager approval, and record the amount paid plus any deduction reason.
- **Management view:** queue distribution, ageing watchlist, operational KPIs, closure-integrity check and configurable-in-code demo assumptions.
- **All tickets:** search, filter, sort, inspect ticket details, comments, agent-update previews and status history.
- **Workflow safeguards:** Support cannot close a ticket; only Finance can mark it Paid or Declined. The close action checks that a linked Finance record exists.
- **Persistence:** ticket data is saved in the browser's `localStorage`.
- **Export/reset:** export the current browser data as JSON or reset to the original synthetic sample records.


## Important prototype limitations

This is a **functional frontend simulation, not a production refund system**.

- All ticket data is synthetic demo data. Do not enter real customer, booking, payment, bank, card or identity information.
- `localStorage` is browser- and device-specific. It is not a shared database, does not synchronize between Support and Finance users, and can be cleared by the user/browser.
- There is no authentication, role-based security, server-side validation, audit-grade event store, encryption, backup, concurrency control or access control. The role navigation is a simulation only.
- Agent email/WhatsApp updates and workflow notifications are previews stored in the browser. They are **not sent**.
- Ticket ID generation is unique within the current local browser dataset, not globally unique across devices or users.
- Ageing checks are elapsed-hour timers, not business-hour calendars. The SLA values and approval threshold are illustrative assumptions only.
- Finance and manager actions simulate decisions; no real payment, approval, refund, airline or bank system is connected.

## Demo assumptions

The values below are intentionally easy to locate near the top of `app.js` and should be validated with BharatTrip before any real deployment:

- Manager approval threshold: **₹50,000**.
- Stage response targets: Support Review 4h; Awaiting Agent Info 24h; Sent to Payout / Finance acknowledgement 4h; Finance Review 24h; Pending Approval 24h; Processing 48h.
- Sample owner names are fictional and are used only to demonstrate assignment and ownership.

## Files

- `index.html` — application shell and navigation.
- `styles.css` — responsive interface styles.
- `app.js` — seeded synthetic data, workflow logic, rendering, localStorage persistence and interaction handlers.
