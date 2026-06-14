# Service-Business Lead Automation (Gmail + Apps Script)

A lightweight lead-response automation built on Gmail and Google Apps Script. When a new lead lands in your inbox, it sends a templated first reply, then automatically follows up if the customer hasn't responded within a set window — without ever sending twice for the same lead.

Although the defaults are filled in with a **hot water system** example, nothing service-specific is hard-coded in the logic. Everything (company name, the service you offer, the details you request, subjects, and email copy) lives in a single `CONFIG` block, so the same engine works for solar, HVAC, plumbing, roofing, pest control, or any quote-based service business.

---

## How it works

1. **Initial response** (`processLeads`)
   - Scans threads under your "leads" label that haven't been processed yet.
   - Parses `Name:` and `Email:` from the lead email body.
   - Sends (or drafts) a personalised first reply and stores lead metadata so follow-ups don't need to re-parse the thread.
   - Tags the thread *Processed* (so it's never answered twice) and *FollowUp-Pending*.

2. **Follow-up** (`processFollowUps`)
   - For each pending lead, finds the original email in your Sent mail.
   - If `FOLLOWUP_AFTER_HOURS` have passed **and** the customer hasn't replied, it sends (or drafts) a follow-up.
   - If the customer *did* reply, it tags the thread *FollowUp-Not-Needed* and stops.
   - Marks the thread *FollowUp-Sent* once handled, preventing duplicates.
   - Also prunes stored lead metadata older than `META_RETENTION_DAYS`.

---

## Prerequisites

- A Google / Gmail account (or Google Workspace).
- Access to [Google Apps Script](https://script.google.com).
- A predictable subject line for incoming lead notifications (e.g. the email your ad platform or website form sends you), so a Gmail filter can label them automatically.

---

## Setup

### 1. Create the Apps Script project

1. Go to [script.google.com](https://script.google.com) → **New project**.
2. Delete the placeholder `Code.gs` contents.
3. Paste in the full script from this repo.
4. Rename the project something memorable (one project per service / inbox is recommended).

### 2. Enable the Advanced Gmail Service

The signature lookup uses the Gmail API directly.

1. In the editor's left sidebar, click **Services** (the `+` puzzle icon).
2. Add **Gmail API** and save.

### 3. Configure the `CONFIG` block

Open the script and edit **only** the `CONFIG` object near the top. The fields you'll almost always change first:

| Setting | What it does |
| --- | --- |
| `COMPANY_NAME` | Your business name, used in the email copy. |
| `COMPANY_DOMAIN` | Your sending domain (e.g. `acmeservices.com.au`). Used to tell *your* replies apart from a genuine customer reply — **must be accurate**. |
| `SERVICE_NAME` | Lowercase service name used mid-sentence (e.g. `hot water system`, `solar system`). |
| `LEAD_SOURCE` | Where the lead came from (e.g. `Facebook ad form`, `website contact form`). |
| `REQUIRED_ITEMS` | The list of details/documents you ask each lead to send back. Add or remove freely. |
| `WHY_WE_NEED_THIS` | One sentence explaining why you need those details. |
| `QUOTE_TURNAROUND` | How long your formal quotes take (e.g. `2-4 business days`). |
| `CLOSING_LINE` | The sign-off line of the first email. |
| `CALL_NUMBER` | Phone number shown in the emails. |

Subjects (keep these consistent with your service):

| Setting | Notes |
| --- | --- |
| `LEAD_SUBJECT` | Subject of the initial reply. |
| `FOLLOWUP_SUBJECT` | Subject of the follow-up (when sent as a new email). |
| `INITIAL_SENT_SUBJECT_MATCH_TEXT` | **Must be a substring of `LEAD_SUBJECT`** — it's how the follow-up step finds the original email in Sent. |

Behaviour and timing:

| Setting | Default | Notes |
| --- | --- | --- |
| `LEAD_MODE` | `"SEND"` | Use `"DRAFT"` while testing. |
| `FOLLOWUP_MODE` | `"SEND"` | Use `"DRAFT"` while testing. |
| `TEST_RECIPIENT_OVERRIDE` | `""` | Set to your own address to route **all** outgoing mail to yourself during testing. Leave empty in production. |
| `FOLLOWUP_AFTER_HOURS` | `24` | Wait time before a follow-up. |
| `FOLLOWUP_SEND_STYLE` | `"NEW_EMAIL"` | `"NEW_EMAIL"` or `"REPLY_THREAD"` (reply within the original thread). |
| `LEAD_NEWER_THAN_DAYS` | `14` | How far back the initial processor looks. |
| `FOLLOWUP_LOOKBACK_DAYS` | `14` | How far back the follow-up search looks. Raise (e.g. 30–60) to follow up with a backlog of older leads. |
| `META_RETENTION_DAYS` | `30` | Keep this comfortably **above** `FOLLOWUP_LOOKBACK_DAYS`. |
| `REQUIRE_UNREAD_LEADS` | `false` | If `true`, only acts on unread lead emails. |
| `SIGNATURE_SEND_AS_EMAIL` | `""` | Leave empty to use your default Gmail signature, or set a Send-As alias address. |

Labels are nested under `LABEL_ROOT` (default `Lead-Automation`). The script creates any that don't exist on first run.

### 4. Lead email format

The parser expects the lead email body to contain lines like:

```
Name: Jane Smith
Email: jane@example.com
```

Most ad-platform and form notifications already include these. The `Name:` match is anchored to the start of a line, so fields like `Ad Set Name:` won't be mistaken for the customer's name.

### 5. Create a Gmail filter to label incoming leads

1. In Gmail, **Settings → Filters and Blocked Addresses → Create a new filter**.
2. Match your lead notifications (e.g. by subject or sender).
3. Choose **Apply the label** → create/select the leads label, which should be:
   `Lead-Automation/HWS-Leads` (or whatever you set `LABEL_ROOT` / `LABEL_LEADS_CHILD` to).

### 6. Test in DRAFT mode

1. Set `LEAD_MODE` and `FOLLOWUP_MODE` to `"DRAFT"` (optionally set `TEST_RECIPIENT_OVERRIDE` to your own email).
2. Run `processLeads` once from the editor and authorise the script when prompted.
3. Check that the generated drafts look correct.

### 7. Add triggers

In the editor, open **Triggers** (clock icon) → **Add Trigger**:

| Function | Event source | Interval |
| --- | --- | --- |
| `processLeads` | Time-driven | Every 1 minute |
| `processFollowUps` | Time-driven | Every 15 minutes (or hourly) |

### 8. Go live

Once the drafts look right, switch `LEAD_MODE` and `FOLLOWUP_MODE` to `"SEND"` and clear `TEST_RECIPIENT_OVERRIDE`.

---

## Adapting it to another service

To re-theme the whole automation, change the **Service & messaging** fields in `CONFIG`:

- Set `SERVICE_NAME`, `LEAD_SOURCE`, `CLOSING_LINE`, and `WHY_WE_NEED_THIS`.
- Replace `REQUIRED_ITEMS` with the details that service actually needs (for solar, for example, a photo of the roof and its orientation).
- Update the three subject fields and your Gmail filter / label names to match.

No changes to the logic are required.

---

## Notes & limitations

- Apps Script time-driven triggers run on a best-effort schedule; a "1 minute" trigger may run slightly less frequently under load.
- Reply detection ignores your own outbound mail (via `COMPANY_DOMAIN`) and common automated senders (`mailer-daemon`, `postmaster`, `no-reply`).
- Lead metadata is stored in Script Properties and pruned automatically; it is scoped to this single Apps Script project.
- Gmail sending and API usage are subject to Google's daily quotas.
