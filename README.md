# BharatTrip RefundOps — Frontend Prototype

A responsive, frontend-only refund request management prototype for GitHub Pages. It simulates how Support, Finance and Management can work from one shared refund ticket record.

## What is included

- **Support desk:** create refund tickets, generate unique ticket IDs, capture agent and booking details, detect likely duplicates, assign a Support owner and submit complete requests to Finance.
- **AI Intake (simulated):** paste an informal email, WhatsApp message, phone note or internal note; choose a channel; and analyse it using canned, local JavaScript results. The three sample buttons load the assessment test cases. Any other message returns a generic `unclear` result.
- **Human review:** extracted fields, classification, confidence, matching tickets and the reply draft are editable. Nothing is created or flagged until a Support agent confirms. Low-confidence and unclear results require explicit confirmation of each field. Process complaints can only be flagged for Management review and never create refund tickets.
- **Ticket matching:** matching is performed in the browser using the same agent/company and route, or the referenced ticket ID. A matched status chase defaults to attaching to the existing ticket.
- **Reply draft:** confirmation replaces `{{TICKET_ID}}` with the selected or newly generated ticket ID and saves a draft. Support can copy it, send it using the normal external channel, then manually mark it sent. The app does not send email or WhatsApp messages.
- **Finance desk:** acknowledge handoffs, create a linked Finance reference, request more information, make manual approval/decline decisions, route high-value requests for manager approval, and record the amount paid plus any deduction reason.
- **Management view:** queue distribution, ageing watchlist, operational KPIs, closure-integrity check, informal-channel intake counts, overdue drafted replies and a Process issues list.
- **Workflow safeguards:** Support cannot close a ticket; only Finance can mark it Paid or Declined. The close action checks that a linked Finance record exists.
- **Persistence:** ticket data and flagged Process issues are saved in this browser's `localStorage`.
- **Export/reset:** export current browser data as JSON or reset tickets and Process issues to the original synthetic sample records.

## Run or view

Open `index.html` to view the prototype. No build step, server, API, API key or frontend dependency is required.

## AI Intake demo behaviour

The AI Intake feature is simulated entirely in the browser. It does not call an AI model, API or backend, and the pasted message does not leave the browser. The Peak Journeys, Nomad Travel and internal process-note samples return pre-written structured results. Other text returns a low-confidence `unclear` result for human review.

After analysis, Support can edit the extracted values and draft reply, attach the message to a matching ticket or create a new ticket. A `status_chase` with a match defaults to attaching. A `process_complaint` can only be flagged for Management review. A reply draft is created only after human confirmation; it is not sent by the app. Support must send it externally and manually mark it as sent.

## Manual test checklist

1. **Peak Journeys · Email:** load the first sample and analyse it. Expected: `new_request`, Peak Journeys, DEL-DXB, English reply asking only for the booking reference. Confirm creation. A ticket should appear with `created_via: ai_intake`, `reply_status: drafted`, and its generated ID inserted in the reply. Copy the reply, send it outside the app, and manually mark it sent.
2. **Nomad Travel · WhatsApp:** load the second sample and analyse it. Expected: `status_chase`, Nomad Travel, BLR-MAA and a Hinglish reply. If a matching ticket exists, attach should be selected by default and the existing ticket ID should be reused; otherwise create a new ticket after review.
3. **Internal process note:** load the third sample and analyse it. Expected: `process_complaint`. Ticket-creation controls should be unavailable. Choose **Flag for review** and confirm the note appears in **Management → Process issues** without increasing the ticket count.
4. Paste an unrelated message. Expected: generic `unclear` result, visible low-confidence warning and explicit confirmation checkboxes for each field. Select a clear classification before confirming a ticket action.
5. Mark a drafted reply as sent and verify the activity history records the action. Reset sample data and confirm created tickets, reply states and Process issues return to the seeded demo state.

## Deploy to GitHub Pages

1. Create a GitHub repository or use an existing repository for the prototype.
2. Add `index.html`, `styles.css`, `app.js` and `README.md` to the repository root.
3. Push the files to the branch you want to publish (commonly `main`).
4. In GitHub, open **Settings → Pages**.
5. Under **Build and deployment**, choose **Deploy from a branch**.
6. Select the publishing branch and `/(root)` folder, then save.
7. Open the Pages URL shown by GitHub after deployment.

GitHub Pages serves the static HTML/CSS/JavaScript files directly. The app can also be opened from the local filesystem using `index.html`.

## Important prototype limitations

This is a **functional frontend simulation, not a production refund system**.

- All ticket data and built-in test messages are synthetic demo data. Do not enter real customer, booking, payment, bank, card or identity information.
- The AI is simulated with canned JavaScript results. It does not contact an AI model or external service; arbitrary messages receive an `unclear` result.
- `localStorage` is browser- and device-specific. It is not a shared database, does not synchronize between Support and Finance users, and can be cleared by the user or browser.
- There is no authentication, role-based security, server-side ticket validation, audit-grade event store, encryption, backup, concurrency control or access control. The role navigation is a simulation only.
- Agent email/WhatsApp replies and workflow notifications are previews / manual status records. They are **not sent by the application**.
- Ticket ID generation is unique within the current local browser dataset, not globally unique across devices or users.
- Ageing checks are elapsed-hour timers, not business-hour calendars. Stage SLAs, the 4-hour AI-intake reply limit and the approval threshold are illustrative assumptions only.
- **Simulated AI output can be wrong, incomplete or misleading. A human Support employee must review and confirm every ticket creation/attachment or Process issue flag.** The confidence score is not a guarantee of correctness.
- Finance and manager actions simulate decisions; no real payment, approval, refund, airline or bank system is connected.

## Demo assumptions

The values below are intentionally easy to locate near the top of `app.js` and should be validated with BharatTrip before any real deployment:

- Manager approval threshold: **₹50,000**.
- Stage response targets: Support Review 4h; Awaiting Agent Info 24h; Sent to Payout / Finance acknowledgement 4h; Finance Review 24h; Pending Approval 24h; Processing 48h.
- Informal-channel drafted-reply follow-up limit: **4 hours** (`INTAKE_REPLY_LIMIT_HOURS`).
- Sample owner names are fictional and are used only to demonstrate assignment and ownership.

## Files

- `index.html` — application shell and navigation.
- `styles.css` — responsive interface styles.
- `app.js` — seeded synthetic data, simulated AI Intake, matching, workflow logic, rendering, localStorage persistence and interaction handlers.
