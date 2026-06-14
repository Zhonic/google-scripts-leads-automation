/**
 *
 * Created by: Harnish Patel
 * Last Edited: 14/06/2026
 * Template Version: 1
 *
 * A reusable service-business lead automation for Gmail + Apps Script.
 * Everything service-specific (your company name, the service you offer, the
 * lead source, the details you request back, subjects, and email copy) lives in
 * the CONFIG block below — nothing service-specific is hard-coded in the logic.
 *
 * The defaults are filled in with a hot water system (HWS) example so you can
 * see how a real deployment reads; swap them out for your own service.
 *
 * Designed to run as its OWN Apps Script project (one per service / inbox).
 *
 * NOTE: LEAD_MODE and FOLLOWUP_MODE can be set to "DRAFT" for initial testing.
 *       Switch both to "SEND" once you've confirmed the drafts look correct.
 */

/**
 * Service-Business Lead Automation (Gmail + Apps Script)
 * ----------------------------------------------------------------
 * What this script does:
 *  1) Initial Response Automation:
 *     - Watches for lead emails under a label (nested label supported).
 *     - Extracts "Name:" and "Email:" from the lead email body.
 *     - Sends (or drafts) a templated response to the customer.
 *     - Stores lead metadata (email/name) so follow-ups don't need to re-parse threads.
 *     - Adds a "Processed" label so it never sends twice for the same lead.
 *
 *  2) Follow-Up Automation:
 *     - For any lead thread (including past leads) where initial email in Sent meets the following criteria:
 *       - If 24 hours have passed since the initial sent time AND customer hasn't replied,
 *         it drafts/sends a follow-up (configurable as new email or same thread reply).
 *     - Marks the lead as FollowUp-Sent to prevent duplicates.
 *
 * Requirements:
 *  - Advanced Gmail Service enabled:
 *      Apps Script Editor → Services (puzzle icon) → + → Gmail API
 *  - Gmail labels exist (script can create them if missing).
 *  - A Gmail filter applying the leads label to incoming leads
 *    (e.g. matching the subject your lead-source notifications use).
 *
 * Triggers:
 *  - processLeads        → every 1 minute
 *  - processFollowUps    → every 15 minutes (or hourly)
 */

/* =========================
 *         CONFIG
 * ========================= */

/**
 * Central configuration for labels, timing, subjects, and behavior.
 * Update ONLY here unless you know what you're doing.
 */
const CONFIG = {
  /**
   * Your business identity (used in email templates and reply detection).
   * Replace these with your own values before deploying.
   */
  COMPANY_NAME: "Acme Services",
  COMPANY_DOMAIN: "example.com.au", // your sending domain, e.g. "acmeservices.com.au"

  /**
   * Service & messaging.
   * This is where you describe WHAT your business offers. All of it is woven
   * into the email copy below, so changing these re-themes the whole automation
   * for a different service (solar, HVAC, plumbing, roofing, pest control, etc.).
   */
  // Lowercase, used mid-sentence, e.g. "...help you with your hot water system enquiry."
  SERVICE_NAME: "hot water system",

  // Where the lead came from, e.g. "website contact form", "Google ad form".
  LEAD_SOURCE: "Facebook ad form",

  // How long formal quotes/proposals typically take.
  QUOTE_TURNAROUND: "2-4 business days",

  // One short sentence explaining why you need the details below.
  WHY_WE_NEED_THIS:
    "This information helps us understand your current power usage, connection type, and site setup so we can recommend the most efficient and cost-effective system.",

  // The closing/sign-off line of the initial email.
  CLOSING_LINE: "Looking forward to helping you save on energy!",

  /**
   * The details / documents you ask every new lead to send back.
   * Add or remove freely — they're rendered as a numbered list in both the
   * plain-text and HTML versions of the initial and follow-up emails.
   * For a different service, just replace this list (e.g. for solar:
   * "A clear photo of your roof and its orientation", etc.).
   */
  REQUIRED_ITEMS: [
    "A clear photo of your switchboard (with the door open)",
    "A clear photo of your meter box",
    "A PDF copy of your most recent electricity bill",
    "A clear photo of your existing hot water system, including where it's currently located",
    "A clear photo of the name plate on your existing hot water system (this shows the model and specifications)",
  ],

  /**
   * Parent label (Gmail nested label root).
   * Actual labels should appear like:
   *   Lead-Automation/HWS-Leads
   *   Lead-Automation/HWS-Leads-Processed
   * etc.
   */
  LABEL_ROOT: "Lead-Automation",

  /** Child label names (will be nested under LABEL_ROOT). */
  LABEL_LEADS_CHILD: "HWS-Leads",
  LABEL_PROCESSED_CHILD: "HWS-Leads-Processed",
  LABEL_FOLLOWUP_PENDING_CHILD: "HWS-FollowUp-Pending",
  LABEL_FOLLOWUP_SENT_CHILD: "HWS-FollowUp-Sent",
  LABEL_FOLLOWUP_NOT_NEEDED_CHILD: "HWS-FollowUp-Not-Needed",

  /**
   * Initial response mode:
   * - "SEND"  → sends immediately
   * - "DRAFT" → creates a draft (for testing purposes)
   */
  LEAD_MODE: "SEND",

  /**
   * Follow-up mode:
   * - "SEND"  → sends follow-ups automatically
   * - "DRAFT" → creates follow-up draft (for testing purposes)
   */
  FOLLOWUP_MODE: "SEND",

  /**
   * Safety override:
   * If set to an email address, ALL outgoing lead responses will go to that address (for testing purposes).
   * Leave "" in production.
   */
  TEST_RECIPIENT_OVERRIDE: "",

  /**
   * Subjects.
   * Keep these consistent with your SERVICE_NAME. Importantly,
   * INITIAL_SENT_SUBJECT_MATCH_TEXT must be a substring of LEAD_SUBJECT — it's
   * how the follow-up step locates the original email in your Sent mail.
   */
  LEAD_SUBJECT: "Re. Hot Water System Enquiry",
  FOLLOWUP_SUBJECT: "Follow-up: Hot Water System Enquiry",

  /**
   * Used to find the initial email in Sent.
   * This should match something contained in your initial subject (LEAD_SUBJECT).
   */
  INITIAL_SENT_SUBJECT_MATCH_TEXT: "Hot Water System Enquiry",

  /** Search / batching */
  LEAD_BATCH_LIMIT: 25,
  FOLLOWUP_BATCH_LIMIT: 25,

  /**
   * Lookback windows:
   * - LEAD_NEWER_THAN_DAYS: how far back the lead-response processor looks.
   * - FOLLOWUP_LOOKBACK_DAYS: how far back the script searchs for leads and Sent messages for follow-ups.
   *
   * NOTE: To send follow-ups to *past* customers, set FOLLOWUP_LOOKBACK_DAYS high enough
   *       to cover the backlog (e.g., 30 or 60). Keep reasonable for performance.
   */
  LEAD_NEWER_THAN_DAYS: 14,
  FOLLOWUP_LOOKBACK_DAYS: 14,

  /** Follow-up timing */
  FOLLOWUP_AFTER_HOURS: 24,

  /**
   * Lead metadata retention (days).
   * Stored lead metadata in Script Properties is deleted once it is older than
   * this many days, so it can't accumulate forever. Keep this comfortably ABOVE
   * FOLLOWUP_LOOKBACK_DAYS so metadata is never pruned while a lead is still
   * within the follow-up window.
   */
  META_RETENTION_DAYS: 30,

  /**
   * Follow-up send style:
   * - "NEW_EMAIL"    → sends a new message with FOLLOWUP_SUBJECT
   * - "REPLY_THREAD" → replies to the initial Sent thread (keeps everything together)
   */
  FOLLOWUP_SEND_STYLE: "NEW_EMAIL",

  /** If true, lead processing will only act on unread lead emails. */
  REQUIRE_UNREAD_LEADS: false,

  /** Phone number used in templates. */
  CALL_NUMBER: "0400 000 000",

  /**
   * Signature behavior:
   * Leave blank to use the Gmail account's default Send-As signature.
   * If aliases are used and want a specific signature, set the Send-As email address.
   */
  SIGNATURE_SEND_AS_EMAIL: "",
};

/* =========================
 *       LABEL HELPERS
 * ========================= */

function fullLabel_(childLabelName) {
  return `${CONFIG.LABEL_ROOT}/${childLabelName}`;
}

function ensureLabelExists_(fullLabelName) {
  const parts = String(fullLabelName).split("/");
  let current = "";

  for (let i = 0; i < parts.length; i++) {
    current = current ? `${current}/${parts[i]}` : parts[i];
    const existing = GmailApp.getUserLabelByName(current);
    if (!existing) GmailApp.createLabel(current);
  }
}

function ensureLabelsExist_() {
  ensureLabelExists_(CONFIG.LABEL_ROOT);

  ensureLabelExists_(fullLabel_(CONFIG.LABEL_LEADS_CHILD));
  ensureLabelExists_(fullLabel_(CONFIG.LABEL_PROCESSED_CHILD));
  ensureLabelExists_(fullLabel_(CONFIG.LABEL_FOLLOWUP_PENDING_CHILD));
  ensureLabelExists_(fullLabel_(CONFIG.LABEL_FOLLOWUP_SENT_CHILD));
  ensureLabelExists_(fullLabel_(CONFIG.LABEL_FOLLOWUP_NOT_NEEDED_CHILD));
}

/* =========================
 *    LEAD META STORAGE
 * ========================= */

const LEAD_META_PREFIX = "LEAD_META:";

function leadMetaKey_(threadId) {
  return `${LEAD_META_PREFIX}${threadId}`;
}

function saveLeadMeta_(thread, meta) {
  const threadId = thread.getId();
  const key = leadMetaKey_(threadId);

  const payload = {
    customerEmail: meta.customerEmail || "",
    customerName: meta.customerName || "",
    firstName: meta.firstName || "",
    capturedAtIso: meta.capturedAtIso || new Date().toISOString(),
  };

  PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(payload));
}

function getLeadMeta_(thread) {
  const threadId = thread.getId();
  const key = leadMetaKey_(threadId);
  const raw = PropertiesService.getScriptProperties().getProperty(key);
  if (!raw) return null;

  try {
    const obj = JSON.parse(raw);
    if (!obj || !obj.customerEmail) return null;
    return obj;
  } catch (e) {
    return null;
  }
}

function deleteLeadMeta_(thread) {
  const threadId = thread.getId();
  const key = leadMetaKey_(threadId);
  PropertiesService.getScriptProperties().deleteProperty(key);
}

function extractLeadMetaFromThread_(thread) {
  const msgs = thread.getMessages();

  for (let i = 0; i < msgs.length; i++) {
    const text = getBestBodyText_(msgs[i]);
    const customerEmail = extractCustomerEmail_(text);
    if (!customerEmail) continue;

    const customerName = extractCustomerName_(text);
    const firstName = formatFirstName_(toFirstName_(customerName)) || "there";

    return { customerEmail, customerName, firstName };
  }

  return null;
}

/**
 * Removes stale lead metadata from Script Properties.
 *
 * An entry is removed if ANY of the following are true:
 *  - It can't be parsed / has no customer email (corrupt or empty).
 *  - It is older than CONFIG.META_RETENTION_DAYS (the lead is well past the
 *    follow-up window, so the metadata is no longer useful).
 *  - The underlying Gmail thread no longer exists (e.g., deleted).
 *
 * This prevents the metadata store from growing without bound over time.
 */
function cleanupOrphanedLeadMeta_() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();

  const nowMs = Date.now();
  const retentionMs = CONFIG.META_RETENTION_DAYS * 24 * 60 * 60 * 1000;

  let removed = 0;

  Object.keys(all).forEach((key) => {
    if (key.indexOf(LEAD_META_PREFIX) !== 0) return;

    let shouldDelete = false;
    let obj = null;

    // 1) Corrupt / unparseable → delete
    try {
      obj = JSON.parse(all[key]);
    } catch (e) {
      shouldDelete = true;
    }

    // 2) Empty / missing email → delete
    if (!shouldDelete && (!obj || !obj.customerEmail)) {
      shouldDelete = true;
    }

    // 3) Past retention age → delete
    if (!shouldDelete) {
      const capturedMs = obj.capturedAtIso ? new Date(obj.capturedAtIso).getTime() : NaN;
      if (isNaN(capturedMs) || (nowMs - capturedMs) > retentionMs) {
        shouldDelete = true;
      }
    }

    // 4) Still within retention but the thread is gone → delete
    if (!shouldDelete) {
      const threadId = key.substring(LEAD_META_PREFIX.length);
      let thread = null;
      try {
        thread = GmailApp.getThreadById(threadId);
      } catch (e) {
        thread = null;
      }
      if (!thread) shouldDelete = true;
    }

    if (shouldDelete) {
      props.deleteProperty(key);
      removed++;
      Logger.log(`Cleaned orphaned lead meta: ${key}`);
    }
  });

  if (removed) Logger.log(`cleanupOrphanedLeadMeta_ removed ${removed} stale entr${removed === 1 ? "y" : "ies"}.`);
}

/* =========================
 *     INITIAL LEAD FLOW
 * ========================= */

function processLeads() {
  ensureLabelsExist_();

  const leadsLabel = fullLabel_(CONFIG.LABEL_LEADS_CHILD);
  const processedLabel = fullLabel_(CONFIG.LABEL_PROCESSED_CHILD);
  const followupPendingLabel = fullLabel_(CONFIG.LABEL_FOLLOWUP_PENDING_CHILD);

  const queryParts = [
    `label:${leadsLabel}`,
    `-label:${processedLabel}`,
    `newer_than:${CONFIG.LEAD_NEWER_THAN_DAYS}d`,
  ];
  if (CONFIG.REQUIRE_UNREAD_LEADS) queryParts.push("is:unread");

  const threads = GmailApp.search(queryParts.join(" "), 0, CONFIG.LEAD_BATCH_LIMIT);
  if (!threads.length) return;

  const processed = GmailApp.getUserLabelByName(processedLabel);
  const pending = GmailApp.getUserLabelByName(followupPendingLabel);

  const signatureHtmlRaw = getGmailSignatureHtml_(CONFIG.SIGNATURE_SEND_AS_EMAIL);
  const signatureHtml = normalizeSignatureHtml_(signatureHtmlRaw);
  const signaturePlain = htmlToPlain_(signatureHtmlRaw);

  threads.forEach((thread) => {
    try {
      // Find the message in the thread that actually contains the lead details
      // (Name:/Email:), rather than blindly reading the LAST message — a stray
      // reply in the thread could be from anyone and would parse incorrectly.
      const extracted = extractLeadMetaFromThread_(thread);

      if (!extracted || !extracted.customerEmail) {
        Logger.log(`Lead skipped (no email parsed). ThreadId=${thread.getId()}`);
        return;
      }

      const customerEmail = extracted.customerEmail;
      const customerName = extracted.customerName;
      const firstName = extracted.firstName || "there";

      // Store meta for follow-ups (store real customer email, not any test override)
      saveLeadMeta_(thread, {
        customerEmail,
        customerName,
        firstName,
        capturedAtIso: new Date().toISOString(),
      });

      const recipient = CONFIG.TEST_RECIPIENT_OVERRIDE || customerEmail;

      const templatePlain = buildLeadTemplatePlain_(firstName);
      const templateHtml = buildLeadTemplateHtml_(firstName);

      const finalPlain = signaturePlain
        ? (templatePlain.trimEnd() + "\n\n" + signaturePlain.trimStart()).trimEnd()
        : templatePlain.trimEnd();

      const finalHtml = signatureHtml
        ? (templateHtml + '<div><br></div>' + signatureHtml)
        : templateHtml;

      if (CONFIG.LEAD_MODE === "DRAFT") {
        GmailApp.createDraft(recipient, CONFIG.LEAD_SUBJECT, finalPlain, { htmlBody: finalHtml });
        Logger.log(`Lead draft created for ${recipient}`);
      } else if (CONFIG.LEAD_MODE === "SEND") {
        GmailApp.sendEmail(recipient, CONFIG.LEAD_SUBJECT, finalPlain, { htmlBody: finalHtml });
        Logger.log(`Lead email sent to ${recipient}`);
      } else {
        throw new Error(`Invalid CONFIG.LEAD_MODE: ${CONFIG.LEAD_MODE}`);
      }

      thread.addLabel(processed);
      thread.markRead();

      thread.addLabel(pending);

    } catch (err) {
      Logger.log(`Error processing lead thread ${thread.getId()}: ${err}`);
    }
  });
}

/* =========================
 *     FOLLOW-UP FLOW
 * ========================= */

function processFollowUps() {
  ensureLabelsExist_();

  // Prune stale lead metadata first, so it runs even when there are no active
  // lead threads to follow up on (orphans are exactly the aged-out ones).
  // A cleanup failure must never block follow-ups, so it's wrapped in try/catch.
  try {
    cleanupOrphanedLeadMeta_();
  } catch (e) {
    Logger.log(`cleanupOrphanedLeadMeta_ error: ${e}`);
  }

  const leadsLabel = fullLabel_(CONFIG.LABEL_LEADS_CHILD);
  const followupPendingLabel = fullLabel_(CONFIG.LABEL_FOLLOWUP_PENDING_CHILD);
  const followupSentLabel = fullLabel_(CONFIG.LABEL_FOLLOWUP_SENT_CHILD);
  const followupNotNeededLabel = fullLabel_(CONFIG.LABEL_FOLLOWUP_NOT_NEEDED_CHILD);

  const pending = GmailApp.getUserLabelByName(followupPendingLabel);
  const sent = GmailApp.getUserLabelByName(followupSentLabel);
  const notNeeded = GmailApp.getUserLabelByName(followupNotNeededLabel);

  const query = [
    `label:${leadsLabel}`,
    `-label:${followupSentLabel}`,
    `-label:${followupNotNeededLabel}`,
    `newer_than:${CONFIG.FOLLOWUP_LOOKBACK_DAYS}d`,
  ].join(" ");

  const leadThreads = GmailApp.search(query, 0, CONFIG.FOLLOWUP_BATCH_LIMIT);
  if (!leadThreads.length) return;

  const signatureHtmlRaw = getGmailSignatureHtml_(CONFIG.SIGNATURE_SEND_AS_EMAIL);
  const signatureHtml = normalizeSignatureHtml_(signatureHtmlRaw);
  const signaturePlain = htmlToPlain_(signatureHtmlRaw);

  const nowMs = Date.now();
  const thresholdMs = CONFIG.FOLLOWUP_AFTER_HOURS * 60 * 60 * 1000;

  leadThreads.forEach((leadThread) => {
    try {
      let meta = getLeadMeta_(leadThread);

      if (!meta) {
        const extracted = extractLeadMetaFromThread_(leadThread);
        if (extracted) {
          meta = {
            customerEmail: extracted.customerEmail,
            customerName: extracted.customerName || "",
            firstName: extracted.firstName || "there",
            capturedAtIso: new Date().toISOString(),
          };
          saveLeadMeta_(leadThread, meta);
        }
      }

      if (!meta || !meta.customerEmail) return;

      const customerEmail = meta.customerEmail;
      const firstName = meta.firstName || "there";

      // Find the initial sent context for this customer (anchorDate = earliest outreach in the chosen thread)
      const initial = findInitialSentContext_(customerEmail);
      if (!initial) return;

      // Use anchorDate (earliest outreach) for the 24h threshold
      if ((nowMs - initial.anchorDate.getTime()) < thresholdMs) return;

      // Check if the customer replied after the anchorDate in that thread
      if (customerRepliedAfter_(initial.thread, customerEmail, initial.anchorDate)) {
        leadThread.removeLabel(pending);
        leadThread.addLabel(notNeeded);
        deleteLeadMeta_(leadThread);
        return;
      }

      // Avoid duplicates if a follow-up already exists
      if (alreadyFollowedUp_(customerEmail, initial)) {
        leadThread.removeLabel(pending);
        leadThread.addLabel(sent);
        deleteLeadMeta_(leadThread);
        return;
      }

      const followPlain = buildFollowupTemplatePlain_(firstName);
      const followHtml = buildFollowupTemplateHtml_(firstName);

      const finalPlain = signaturePlain
        ? (followPlain.trimEnd() + "\n\n" + signaturePlain.trimStart()).trimEnd()
        : followPlain.trimEnd();

      const finalHtml = signatureHtml
        ? (followHtml + '<div><br></div>' + signatureHtml)
        : followHtml;

      if (CONFIG.FOLLOWUP_SEND_STYLE === "REPLY_THREAD") {
        if (CONFIG.FOLLOWUP_MODE === "DRAFT") {
          GmailApp.createDraft(customerEmail, CONFIG.FOLLOWUP_SUBJECT, finalPlain, { htmlBody: finalHtml });
        } else if (CONFIG.FOLLOWUP_MODE === "SEND") {
          // replyMessage is the most recent matching outreach in that thread
          initial.replyMessage.reply(finalPlain, { htmlBody: finalHtml });
        } else {
          throw new Error(`Invalid CONFIG.FOLLOWUP_MODE: ${CONFIG.FOLLOWUP_MODE}`);
        }
      } else {
        if (CONFIG.FOLLOWUP_MODE === "DRAFT") {
          GmailApp.createDraft(customerEmail, CONFIG.FOLLOWUP_SUBJECT, finalPlain, { htmlBody: finalHtml });
        } else if (CONFIG.FOLLOWUP_MODE === "SEND") {
          GmailApp.sendEmail(customerEmail, CONFIG.FOLLOWUP_SUBJECT, finalPlain, { htmlBody: finalHtml });
        } else {
          throw new Error(`Invalid CONFIG.FOLLOWUP_MODE: ${CONFIG.FOLLOWUP_MODE}`);
        }
      }

      leadThread.removeLabel(pending);
      leadThread.addLabel(sent);

      deleteLeadMeta_(leadThread);

      Logger.log(`Follow-up handled (${CONFIG.FOLLOWUP_MODE}) for ${customerEmail}`);

    } catch (err) {
      Logger.log(`Error processing follow-up for lead thread ${leadThread.getId()}: ${err}`);
    }
  });
}

/* =========================
 *        TEMPLATES
 * ========================= */

/**
 * Renders CONFIG.REQUIRED_ITEMS as a numbered plain-text list, e.g.:
 *   1. First item
 *   2. Second item
 */
function renderItemsPlain_() {
  return CONFIG.REQUIRED_ITEMS
    .map((item, i) => `  ${i + 1}. ${item}`)
    .join("\n");
}

/** Renders CONFIG.REQUIRED_ITEMS as an HTML ordered list (values are escaped). */
function renderItemsHtml_() {
  const lis = CONFIG.REQUIRED_ITEMS
    .map((item) => `      <li style="margin:0 0 8px 0;">${escapeHtml_(item)}</li>`)
    .join("\n");

  return `    <ol style="margin:0; padding-left:22px;">
${lis}
    </ol>`;
}

function buildLeadTemplatePlain_(firstName) {
  return (
`Hi ${firstName},

Thank you for submitting your details through our ${CONFIG.LEAD_SOURCE}! We appreciate you reaching out to ${CONFIG.COMPANY_NAME}, and we're excited to help you with your ${CONFIG.SERVICE_NAME} enquiry.

To prepare an accurate quote and recommend the best option for you, we'll need a few details from you:

Please reply with:
${renderItemsPlain_()}

${CONFIG.WHY_WE_NEED_THIS}

Once we receive it, our team will review everything and get your personalised proposal underway.

Please note: once we have the above details, formal proposals are typically sent within ${CONFIG.QUOTE_TURNAROUND}. If your enquiry is urgent, please give us a call.

If you have any questions in the meantime, feel free to reply to this email or call me on ${CONFIG.CALL_NUMBER}.

${CONFIG.CLOSING_LINE}`
  );
}

function buildLeadTemplateHtml_(firstName) {
  const safeName = escapeHtml_(firstName);

  return `
<div style="font-family:Arial,sans-serif; font-size:11pt; line-height:1.5;">
  <p style="margin:0 0 12px 0;">Hi ${safeName},</p>

  <p style="margin:0 0 12px 0;">
    Thank you for submitting your details through our ${escapeHtml_(CONFIG.LEAD_SOURCE)}! We appreciate you reaching out to ${escapeHtml_(CONFIG.COMPANY_NAME)}, and we're excited to help you with your ${escapeHtml_(CONFIG.SERVICE_NAME)} enquiry.
  </p>

  <p style="margin:0 0 12px 0;">
    To prepare an accurate quote and recommend the best option for you, we'll need a few details from you:
  </p>

  <p style="margin:0 0 8px 0;"><strong>Please reply with:</strong></p>

  <div style="margin-left:22px;">
${renderItemsHtml_()}
  </div>

  <p style="margin:12px 0 12px 0;">
    ${escapeHtml_(CONFIG.WHY_WE_NEED_THIS)}
  </p>

  <p style="margin:0 0 12px 0;">
    Once we receive it, our team will review everything and get your personalised proposal underway.
  </p>

  <p style="margin:0 0 12px 0;">
    <strong>Please note:</strong> once we have the above details, formal proposals are typically sent within ${escapeHtml_(CONFIG.QUOTE_TURNAROUND)}. If your enquiry is urgent, please give us a call.
  </p>

  <p style="margin:0 0 12px 0;">
    If you have any questions in the meantime, feel free to reply to this email or call me on ${escapeHtml_(CONFIG.CALL_NUMBER)}.
  </p>

  <p style="margin:0;">${escapeHtml_(CONFIG.CLOSING_LINE)}</p>
</div>
`.trim();
}

function buildFollowupTemplatePlain_(firstName) {
  return (
`Hi ${firstName},

Just following up on our previous email regarding your ${CONFIG.SERVICE_NAME} enquiry.

If you're still interested, please reply with the details below so we can prepare your quote:
${renderItemsPlain_()}

If you've already sent these through, thank you — we'll review everything and be in touch shortly.

If it's urgent, please call us on ${CONFIG.CALL_NUMBER}.`
  );
}

function buildFollowupTemplateHtml_(firstName) {
  const safeName = escapeHtml_(firstName);

  return `
<div style="font-family:Arial,sans-serif; font-size:11pt; line-height:1.5;">
  <p style="margin:0 0 12px 0;">Hi ${safeName},</p>

  <p style="margin:0 0 12px 0;">
    Just following up on our previous email regarding your ${escapeHtml_(CONFIG.SERVICE_NAME)} enquiry.
  </p>

  <p style="margin:0 0 8px 0;">
    If you're still interested, please reply with the details below so we can prepare your quote:
  </p>

  <div style="margin-left:22px;">
${renderItemsHtml_()}
  </div>

  <p style="margin:12px 0 12px 0;">
    If you've already sent these through, thank you - we'll review everything and be in touch shortly.
  </p>

  <p style="margin:0;">
    If it's urgent, please call us on ${escapeHtml_(CONFIG.CALL_NUMBER)}.
  </p>
</div>
`.trim();
}

/* =========================
 *   PARSING + FORMATTERS
 * ========================= */

function extractCustomerEmail_(text) {
  const m = String(text).match(/Email:\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
  return m ? m[1].trim() : "";
}

function extractCustomerName_(text) {
  // Anchored to the start of a line (multiline) so fields like "Ad Set Name:"
  // can never be mistaken for the customer "Name:" line.
  const m = String(text).match(/^\s*Name:\s*([^\n\r]+)/im);
  return m ? m[1].trim() : "";
}

function toFirstName_(fullName) {
  if (!fullName) return "";
  const cleaned = String(fullName).replace(/\s+/g, " ").trim();
  return cleaned.split(" ")[0] || "";
}

function formatFirstName_(name) {
  if (!name) return "";
  const cleaned = String(name).trim().toLowerCase();
  return cleaned.replace(/(^|[-'])[a-z]/g, (m) => m.toUpperCase());
}

function escapeHtml_(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* =========================
 *     FOLLOW-UP LOGIC
 * ========================= */

/**
 * Finds the best sent thread for a customer and returns:
 * - anchorDate: earliest matching outreach in that thread (used for reply detection & 24h threshold)
 * - replyMessage: latest matching outreach in that thread (used if replying in-thread)
 */
function findInitialSentContext_(customerEmail) {
  const q = [
    "in:sent",
    `to:${customerEmail}`,
    `subject:"${CONFIG.INITIAL_SENT_SUBJECT_MATCH_TEXT}"`,
    `newer_than:${CONFIG.FOLLOWUP_LOOKBACK_DAYS}d`,
  ].join(" ");

  const threads = GmailApp.search(q, 0, 10);
  if (!threads.length) return null;

  let best = null;

  threads.forEach((t) => {
    const matches = [];

    t.getMessages().forEach((m) => {
      const to = (m.getTo() || "").toLowerCase();
      const subj = (m.getSubject() || "").toLowerCase();

      if (!to.includes(String(customerEmail).toLowerCase())) return;
      if (!subj.includes(String(CONFIG.INITIAL_SENT_SUBJECT_MATCH_TEXT).toLowerCase())) return;

      // Exclude obvious follow-up subjects to avoid anchoring on them
      if (subj.includes("follow-up") || subj.includes("follow up")) return;

      matches.push(m);
    });

    if (!matches.length) return;

    // Oldest -> newest
    matches.sort((a, b) => a.getDate().getTime() - b.getDate().getTime());

    const anchorMsg = matches[0];
    const replyMsg = matches[matches.length - 1];

    const candidate = {
      thread: t,
      anchorDate: anchorMsg.getDate(),
      replyMessage: replyMsg,
      lastSentDate: replyMsg.getDate(),
    };

    // Choose the thread whose latest matching outreach is most recent
    if (!best || candidate.lastSentDate.getTime() > best.lastSentDate.getTime()) {
      best = candidate;
    }
  });

  return best;
}

function customerRepliedAfter_(thread, customerEmail, afterDate) {
  const afterMs = afterDate.getTime();
  const msgs = thread.getMessages();

  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i];
    if (msg.getDate().getTime() <= afterMs) continue;

    const from = (msg.getFrom() || "").toLowerCase();

    // Ignore our own outbound emails (set COMPANY_DOMAIN in CONFIG).
    if (from.includes("@" + String(CONFIG.COMPANY_DOMAIN).toLowerCase())) continue;

    // Ignore common automated/bounce senders
    if (from.includes("mailer-daemon") || from.includes("postmaster") || from.includes("no-reply")) continue;

    // Anything else is effectively an incoming reply in that thread
    return true;
  }
  return false;
}

function alreadyFollowedUp_(customerEmail, initial) {
  const initialMs = initial.anchorDate.getTime();

  // 1) Thread-based check (covers reply-style follow-up)
  const msgs = initial.thread.getMessages();
  let myMessagesAfter = 0;

  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i];
    if (msg.getDate().getTime() <= initialMs) continue;

    const from = (msg.getFrom() || "").toLowerCase();
    if (!from.includes(String(customerEmail).toLowerCase())) {
      myMessagesAfter++;
    }
  }

  if (myMessagesAfter >= 1) return true;

  // 2) Sent-search check (covers NEW_EMAIL follow-up)
  const q = [
    "in:sent",
    `to:${customerEmail}`,
    `subject:"${CONFIG.FOLLOWUP_SUBJECT}"`,
    `newer_than:${CONFIG.FOLLOWUP_LOOKBACK_DAYS}d`,
  ].join(" ");

  const followThreads = GmailApp.search(q, 0, 5);
  for (let t = 0; t < followThreads.length; t++) {
    const th = followThreads[t];
    const messages = th.getMessages();

    for (let m = 0; m < messages.length; m++) {
      const msg = messages[m];
      const d = msg.getDate().getTime();
      if (d > initialMs) return true;
    }
  }

  return false;
}

/* =========================
 *     SIGNATURE HANDLING
 * ========================= */

function getGmailSignatureHtml_(sendAsEmailOverride) {
  const cache = CacheService.getScriptCache();
  const cacheKey = "gmail_signature_html:" + (sendAsEmailOverride || "DEFAULT");
  const cached = cache.get(cacheKey);
  if (cached !== null) return cached;

  const userId = "me";
  let sendAsEmail = sendAsEmailOverride;

  if (!sendAsEmail) {
    const listResp = Gmail.Users.Settings.SendAs.list(userId);
    const sendAsList = (listResp && listResp.sendAs) ? listResp.sendAs : [];

    const chosen =
      sendAsList.find(s => s.isDefault) ||
      sendAsList.find(s => s.isPrimary) ||
      sendAsList[0];

    sendAsEmail = chosen ? chosen.sendAsEmail : "";
  }

  if (!sendAsEmail) {
    cache.put(cacheKey, "", 21600);
    return "";
  }

  const sendAs = Gmail.Users.Settings.SendAs.get(userId, sendAsEmail);
  const signature = (sendAs && sendAs.signature) ? sendAs.signature : "";

  cache.put(cacheKey, signature || "", 21600);
  return signature || "";
}

function normalizeSignatureHtml_(html) {
  if (!html) return "";

  let s = String(html).trim();

  s = s.replace(/^(?:\s*<br\s*\/?>\s*)+/gi, "");
  s = s.replace(/^(?:\s*<(?:div|p)[^>]*>\s*(?:<br\s*\/?>|\s|&nbsp;)*\s*<\/(?:div|p)>\s*)+/gi, "");

  return s.trim();
}

function htmlToPlain_(html) {
  if (!html) return "";

  return String(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* =========================
 *        BODY READ
 * ========================= */

function getBestBodyText_(msg) {
  const plain = msg.getPlainBody();
  if (plain && plain.trim()) return plain.trim();

  const html = msg.getBody() || "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .trim();
}