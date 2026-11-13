const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore')
const { defineSecret } = require('firebase-functions/params')
const admin = require('firebase-admin')
const { getDownloadURL } = require('firebase-admin/storage')
const PDFDocument = require('pdfkit')
admin.initializeApp()

const WA_TOKEN = defineSecret('WA_TOKEN')
const WA_PHONE_ID = defineSecret('WA_PHONE_ID')
// Keep this on a currently supported Graph API version.
const GRAPH_API_VERSION = 'v26.0'
const opts = (document) => ({ document, secrets: [WA_TOKEN, WA_PHONE_ID] })
const APP_URL = process.env.APP_URL || 'https://your-app.web.app'
const ADMIN_PHONE = process.env.ADMIN_PHONE // owner's WhatsApp number, e.g. 919876543210
const inr = (n) => '₹' + Number(n).toLocaleString('en-IN')
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]))
// Client phone and email live only in the admin-only record projects/{id}/private/contact.
const contactOf = async (pid) => (await admin.firestore().doc(`projects/${pid}/private/contact`).get()).data() || {}



async function wa(to, template, params, header) {
  try {
    const phone = String(to || '').replace(/\D/g, '');

    if (!phone) {
      throw new Error('Client phone number is missing');
    }

    const components = [
      {
        type: 'body',
        parameters: params.map((text) => ({
          type: 'text',
          text: String(text)
        }))
      }
    ];

    if (header) {
      components.unshift({
        type: 'header',
        parameters: [
          {
            type: 'document',
            document: header
          }
        ]
      });
    }

    const payload = {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'template',
      template: {
        name: template,
        language: {
          code: 'en'
        },
        components
      }
    };

    console.log('WhatsApp request:', {
      to: phone,
      template,
      parameterCount: params.length
    });

    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${WA_PHONE_ID.value()}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${WA_TOKEN.value()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      }
    );

    const responseText = await res.text();

    let result;

    try {
      result = JSON.parse(responseText);
    } catch {
      result = {
        raw: responseText
      };
    }

    if (!res.ok) {
      console.error('WhatsApp API rejected request:', {
        status: res.status,
        response: result
      });

      return {
        success: false,
        error: result.error?.message || 'WhatsApp API request failed',
        code: result.error?.code || null,
        status: res.status
      };
    }

    console.log('WhatsApp API accepted request:', {
      messageId: result.messages?.[0]?.id,
      contacts: result.contacts
    });

    return {
      success: true,
      messageId: result.messages?.[0]?.id || null,
      error: null,
      code: null,
      status: res.status
    };

  } catch (error) {
    console.error('WhatsApp sending exception:', error);

    return {
      success: false,
      error: error.message || 'Unknown WhatsApp error',
      code: null,
      status: null
    };
  }
}

// Template "quotation_ready": {{1}} client, {{2}} total, {{3}} link
// Runs when the admin-only contact record is created: makes the client login, links it to the project, sends the quotation.
async function ensureClient(email, name) {
  try { return (await admin.auth().getUserByEmail(email)).uid } catch (err) { if (err.code !== 'auth/user-not-found') throw err }
  const password = require('crypto').randomBytes(6).toString('base64url')
  const u = await admin.auth().createUser({ email, password, displayName: name })
  await admin.firestore().doc(`users/${u.uid}`).set({ name, email, role: 'client' })
  const setupLink = await admin.auth().generatePasswordResetLink(email, { url: APP_URL })
  await admin.firestore().collection('mail').add({ to: email, message: {
    subject: 'Your North East Interiors login',
    html: `<p>Hello ${name},</p><p>Your project account is ready.</p><p><a href="${setupLink}">Set your password securely</a></p><p>After setting it, sign in at <a href="${APP_URL}">${APP_URL}</a> using ${email}.</p><p>If you did not expect this account, you can ignore this email.</p>` } })
  return u.uid
}

function quotationPdf(project, contact, projectId) {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ margin: 48, size: 'A4' })
    const chunks = []
    document.on('data', (chunk) => chunks.push(chunk))
    document.on('end', () => resolve(Buffer.concat(chunks)))
    document.on('error', reject)

    const createdAt = project.createdAt?.toDate?.() || new Date()
    const date = createdAt.toLocaleDateString('en-IN', {
      day: 'numeric', month: 'long', year: 'numeric'
    })
    const amount = Number(project.total ?? project.quotationTotal ?? project.quotedAmount ?? 0)
    const area = Number(project.sft || 0)
    const rate = Number(project.rate || 0)

    document.fillColor('#087f6a').fontSize(11).text('NORTH EAST INTERIORS')
    document.moveDown(0.5).fillColor('#152a25').fontSize(25).text('QUOTATION')
    document.moveDown(0.25).fillColor('#66736f').fontSize(10)
      .text(`Quotation date: ${date}`)
      .text(`Quotation reference: NEI-${String(projectId).slice(-8).toUpperCase()}`)

    document.moveDown(1.5).fillColor('#087f6a').fontSize(10).text('PREPARED FOR')
    document.moveDown(0.35).fillColor('#152a25').fontSize(14).text(project.clientName || 'Customer')
    document.fillColor('#66736f').fontSize(10)
    if (contact.clientEmail) document.text(contact.clientEmail)
    if (contact.clientPhone) document.text(contact.clientPhone)

    document.moveDown(1.2).fillColor('#087f6a').fontSize(10).text('PROJECT')
    document.moveDown(0.35).fillColor('#152a25').fontSize(14).text(project.name || 'Interior project')
    document.fillColor('#66736f').fontSize(10).text(project.siteAddress || 'Site address not provided')

    document.moveDown(1.4).fillColor('#087f6a').fontSize(10).text('QUOTATION SUMMARY')
    const summaryTop = document.y + 10
    document.roundedRect(48, summaryTop, 499, 86, 8).fill('#f0f7f5')
    document.fillColor('#66736f').fontSize(9).text('AREA', 64, summaryTop + 17)
    document.fillColor('#152a25').fontSize(13).text(`${area.toLocaleString('en-IN')} sq. ft.`, 64, summaryTop + 35)
    document.fillColor('#66736f').fontSize(9).text('RATE PER SQ. FT.', 225, summaryTop + 17)
    document.fillColor('#152a25').fontSize(13).text(inr(rate), 225, summaryTop + 35)
    document.fillColor('#66736f').fontSize(9).text('QUOTED TOTAL', 390, summaryTop + 17)
    document.fillColor('#087f6a').fontSize(15).text(inr(amount), 390, summaryTop + 34)
    document.y = summaryTop + 108

    const installments = Array.isArray(project.installments) ? project.installments : []
    if (installments.length) {
      document.fillColor('#087f6a').fontSize(10).text('PAYMENT MILESTONES')
      document.moveDown(0.5)
      installments.forEach((item, index) => {
        const label = item.label || item.type || `Milestone ${index + 1}`
        const dueDate = item.dueDate ? ` · Due ${item.dueDate}` : ''
        document.fillColor('#263a35').fontSize(10)
          .text(label, { continued: true })
          .text(`  ${inr(item.amount)}${dueDate}`, { align: 'right' })
        document.moveDown(0.3)
      })
    }

    document.moveDown(1.2).fillColor('#087f6a').fontSize(10).text('NOTES')
    document.moveDown(0.4).fillColor('#66736f').fontSize(9)
      .text('This quotation is prepared from the project details provided. Project dates and final scope will be confirmed with the customer before work begins.')
    document.moveDown(1.2).fillColor('#66736f').fontSize(9)
      .text('Thank you for choosing North East Interiors.')
    document.end()
  })
}

function quotationEmailHtml(project, contact, quotationUrl, projectId, pdfReady = true) {
  const amount = Number(project.total ?? project.quotationTotal ?? project.quotedAmount ?? 0)
  const rows = (Array.isArray(project.installments) ? project.installments : [])
    .map((item) => `<tr><td style="padding:10px 0;border-bottom:1px solid #e8eeeb">${escapeHtml(item.label || item.type || 'Milestone')}</td><td style="padding:10px 0;border-bottom:1px solid #e8eeeb;text-align:right">${escapeHtml(inr(item.amount))}</td></tr>`)
    .join('')
  const buttonLabel = pdfReady ? 'Download quotation PDF' : 'View project quotation'
  return `<!doctype html><html><body style="margin:0;background:#f4f6f3;font-family:Arial,sans-serif;color:#24352f"><div style="max-width:640px;margin:32px auto;background:#fff;border:1px solid #e6e9e4;border-radius:14px;overflow:hidden"><div style="padding:28px 32px;background:#087f6a;color:#fff"><div style="font-size:13px;letter-spacing:1.5px">NORTH EAST INTERIORS</div><h1 style="margin:18px 0 4px;font-size:26px">Your project quotation</h1><div style="opacity:.9">Reference NEI-${escapeHtml(String(projectId).slice(-8).toUpperCase())}</div></div><div style="padding:30px 32px"><p>Hello ${escapeHtml(project.clientName || 'Customer')},</p><p>Thank you for choosing North East Interiors. Here is the quotation for your project.</p><table style="width:100%;border-collapse:collapse;margin:24px 0"><tr><td style="padding:9px 0;color:#68766f">Project</td><td style="padding:9px 0;text-align:right;font-weight:bold">${escapeHtml(project.name || 'Interior project')}</td></tr><tr><td style="padding:9px 0;color:#68766f">Site</td><td style="padding:9px 0;text-align:right">${escapeHtml(project.siteAddress || '—')}</td></tr><tr><td style="padding:9px 0;color:#68766f">Area</td><td style="padding:9px 0;text-align:right">${escapeHtml(Number(project.sft || 0).toLocaleString('en-IN'))} sq. ft.</td></tr><tr><td style="padding:9px 0;color:#68766f">Rate per sq. ft.</td><td style="padding:9px 0;text-align:right">${escapeHtml(inr(project.rate || 0))}</td></tr><tr><td style="padding:14px 0;border-top:1px solid #e8eeeb;font-weight:bold">Quotation total</td><td style="padding:14px 0;border-top:1px solid #e8eeeb;text-align:right;font-size:20px;font-weight:bold;color:#087f6a">${escapeHtml(inr(amount))}</td></tr>${rows}</table><p style="text-align:center;margin:28px 0"><a href="${escapeHtml(quotationUrl)}" style="display:inline-block;padding:13px 22px;border-radius:8px;background:#087f6a;color:#fff;text-decoration:none;font-weight:bold">${buttonLabel}</a></p><p style="font-size:13px;color:#68766f">You can also review your project at <a href="${escapeHtml(APP_URL)}/p/${encodeURIComponent(projectId)}">North East Interiors</a>.</p><p style="margin-top:28px">Regards,<br><strong>North East Interiors</strong></p></div></div></body></html>`
}

exports.sendQuotation = onDocumentCreated(
  opts('projects/{id}/private/contact'),
  async (e) => {
    const c = e.data.data();
    console.log('sendQuotation triggered', { projectId: e.params.id });
    const pref = admin.firestore().doc(`projects/${e.params.id}`);
    const p = (await pref.get()).data();

    if (!p) {
      console.error('Quotation not sent because the project document is missing:', e.params.id);
      return;
    }

    let clientUid = null;
    let clientSetupError = null;
    try {
      clientUid = await ensureClient(c.clientEmail, p.clientName);
    } catch (error) {
      clientSetupError = error.message || 'Could not create or load the client account';
      console.error('Client account setup failed; continuing with quotation delivery:', error);
    }

    const quotationFilename = `NEI-Quotation-${String(e.params.id).slice(-8).toUpperCase()}.pdf`;
    const quotationPath = `quotations/${e.params.id}/${quotationFilename}`;
    const projectUrl = `${APP_URL}/p/${encodeURIComponent(e.params.id)}`;
    let quotationUrl = projectUrl;
    let pdfError = null;
    try {
      const quotationFile = admin.storage().bucket().file(quotationPath);
      const downloadToken = require('crypto').randomUUID();
      await quotationFile.save(await quotationPdf(p, c, e.params.id), {
        contentType: 'application/pdf',
        metadata: {
          contentDisposition: `attachment; filename="${quotationFilename}"`,
          metadata: { firebaseStorageDownloadTokens: downloadToken }
        }
      });
      quotationUrl = await getDownloadURL(quotationFile);
    } catch (error) {
      pdfError = error.message || 'Could not create the quotation PDF';
      console.error('Quotation PDF generation failed; sending project link instead:', error);
    }

    let emailQueued = false;
    let emailError = null;
    try {
      await admin.firestore().collection('mail').add({
        to: c.clientEmail,
        message: {
          subject: `Quotation for ${p.name || 'your interior project'}`,
          html: quotationEmailHtml(p, c, quotationUrl, e.params.id, !pdfError)
        }
      });
      emailQueued = true;
    } catch (error) {
      emailError = error.message || 'Could not queue quotation email';
      console.error('Quotation email could not be queued:', error);
    }

    const result = await wa(
      c.clientPhone,
      'quotation_ready',
      [
        p.clientName,
        inr(p.total),
        quotationUrl
      ]
    );

    await pref.update({
      clientUid,
      quotationPdfPath: quotationPath,
      quotationPdfError: pdfError,
      clientSetupError,
      quotationEmailQueued: emailQueued,
      quotationEmailError: emailError,
      quotationEmailAttemptedAt: admin.firestore.FieldValue.serverTimestamp(),
      whatsappSent: result.success,
      whatsappError: result.success ? null : result.error,
      whatsappErrorCode: result.code || null,
      whatsappHttpStatus: result.status || null,
      whatsappMessageId: result.messageId || null,
      whatsappAttemptedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log('Quotation delivery processing complete', {
      projectId: e.params.id,
      pdfGenerated: !pdfError,
      emailQueued,
      whatsappAccepted: result.success,
      clientSetupFailed: !!clientSetupError
    });
  }
);

// Client approved: notify admin in app and on WhatsApp. Template "project_approved": {{1}} project, {{2}} client
exports.onApproved = onDocumentUpdated(opts('projects/{id}'), async (e) => {
  const [a, b] = [e.data.before.data(), e.data.after.data()]
  if (a.status === 'approved' || b.status !== 'approved') return
  await admin.firestore().collection('notifications').add({
    type: 'approved', projectId: e.params.id, text: `${b.clientName} approved ${b.name}`,
    createdAt: admin.firestore.FieldValue.serverTimestamp() })
  if (ADMIN_PHONE) await wa(ADMIN_PHONE, 'project_approved', [b.name, b.clientName])
})

// Template "payment_request": {{1}} client, {{2}} amount, {{3}} project, {{4}} link
exports.onPaymentRequest = onDocumentCreated(opts('payments/{id}'), async (e) => {
  const p = e.data.data()
  await wa((await contactOf(p.projectId)).clientPhone, 'payment_request', [p.clientName, inr(p.amount), p.projectName, APP_URL])
})

function invoicePdf(p) {
  return new Promise((resolve) => {
    const d = new PDFDocument({ margin: 50 }), chunks = []
    d.on('data', c => chunks.push(c)).on('end', () => resolve(Buffer.concat(chunks)))
    d.fontSize(22).text('North East Interiors').fontSize(12).moveDown()
    d.text(`Invoice ${p.invoiceNo}`).text(`Date: ${new Date().toLocaleDateString('en-IN')}`)
    d.text(`Client: ${p.clientName}`).text(`Project: ${p.projectName}`).moveDown()
    p.splits.forEach(s => d.text(`${s.method}: ${inr(s.amount)}`))
    d.moveDown().fontSize(14).text(`Total received: ${inr(p.received)}`)
    d.end()
  })
}

// Admin recorded the payment: build invoice, store it, send on WhatsApp. Template "invoice_ready" has a document header,
// body {{1}} client, {{2}} amount, {{3}} invoice number.
exports.onPaymentRecorded = onDocumentUpdated(opts('payments/{id}'), async (e) => {
  const [a, p] = [e.data.before.data(), e.data.after.data()]
  if (a.status === 'recorded' || p.status !== 'recorded') return
  const file = admin.storage().bucket().file(`invoices/${p.invoiceNo}.pdf`)
  await file.save(await invoicePdf(p), { contentType: 'application/pdf' })
  const [url] = await file.getSignedUrl({ action: 'read', expires: Date.now() + 5 * 365 * 864e5 })
  await e.data.after.ref.update({ invoiceUrl: url })
  await wa((await contactOf(p.projectId)).clientPhone, 'invoice_ready', [p.clientName, inr(p.received), p.invoiceNo],
    { link: url, filename: `${p.invoiceNo}.pdf` })
})

// Admin adds a supervisor or carpenter: creates the login and emails it (Trigger Email extension reads the "mail" collection).
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const crypto = require('crypto')


exports.createStaff = onCall(
  { region: 'asia-south1' },
  async (req) => {
    const db = admin.firestore()

    // 1. Require the Team module write permission (admins have full access).
    const me = req.auth
      ? (await db.doc(`users/${req.auth.uid}`).get()).data()
      : null

    let teamPermission = me?.permissions?.team
    if (me?.customRoleId) {
      const assignedRole = await db.doc(`roles/${me.customRoleId}`).get()
      teamPermission = assignedRole.data()?.permissions?.team || teamPermission
    }
    const canWriteTeam = me?.role === 'admin' || teamPermission === true ||
      (teamPermission?.read === true && teamPermission?.write === true)

    if (!canWriteTeam) {
      throw new HttpsError(
        'permission-denied',
        'Your role does not have permission to add team members.'
      )
    }

    // 2. Read the selected custom role
    const { name, email, customRoleId } = req.data

    if (!name || !email || !customRoleId) {
      throw new HttpsError(
        'invalid-argument',
        'Name, email and role are required.'
      )
    }

    const roleSnap = await db.doc(`roles/${customRoleId}`).get()

    if (!roleSnap.exists) {
      throw new HttpsError(
        'not-found',
        'Selected role was not found.'
      )
    }

    const selectedRole = roleSnap.data()

    if (
      selectedRole.system ||
      selectedRole.baseRole === 'admin'
    ) {
      throw new HttpsError(
        'permission-denied',
        'You cannot create an employee with the admin role.'
      )
    }

    const appRole = selectedRole.baseRole

    if (!['supervisor', 'carpenter', 'client'].includes(appRole)) {
      throw new HttpsError(
        'invalid-argument',
        'This role has an unsupported workspace.'
      )
    }

    // 3. Preserve your existing Firebase Auth account creation
    const password = crypto.randomBytes(6).toString('base64url')
    let user

    try {
      user = await admin.auth().createUser({
        email: email.trim(),
        password,
        displayName: name.trim(),
      })
    } catch (err) {
      if (err.code === 'auth/email-already-exists') {
        throw new HttpsError(
          'already-exists',
          'This email already has a login.'
        )
      }

      throw err
    }

    // 4. Save the workspace role and custom permissions
    try {
      await db.doc(`users/${user.uid}`).set({
        name: name.trim(),
        email: email.trim(),
        role: appRole,
        customRoleId,
        customRoleName: selectedRole.name,
        permissions: selectedRole.permissions || {},
      })
    } catch (err) {
      // Avoid leaving an Auth account behind if profile creation fails.
      await admin.auth().deleteUser(user.uid).catch(() => {})
      throw err
    }

    // 5. Send a secure password setup link instead of exposing a temporary password.
    const setupLink = await admin.auth().generatePasswordResetLink(email.trim(), { url: APP_URL })
    await db.collection('mail').add({
      to: email.trim(),
      message: {
        subject: 'Your North East Interiors login',
        html: `<p>Hello ${name.trim()},</p>
          <p>Your ${selectedRole.name} account is ready.</p>
          <p><a href="${setupLink}">Set your password securely</a></p>
          <p>After setting it, sign in at <a href="${APP_URL}">${APP_URL}</a> using ${email.trim()}.</p>
          <p>If you did not expect this account, you can ignore this email.</p>`,
      },
    })

    return {
      uid: user.uid,
      customRoleId,
      customRoleName: selectedRole.name,
    }
  }
)


// ---- Daily schedule (Asia/Kolkata) ----
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { onDocumentWritten } = require('firebase-functions/v2/firestore')
const TZ = 'Asia/Kolkata'
const istDate = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ })
const sched = (schedule) => ({ schedule, timeZone: TZ, secrets: [WA_TOKEN, WA_PHONE_ID] })
const hasUpdate = (u) => u.exists && u.data().images?.length > 0
const inProgress = () => admin.firestore().collection('projects').where('status', '==', 'in_progress').get()

// 4:30 PM: email supervisors who have not uploaded yet.
exports.reminder = onSchedule(sched('30 16 * * *'), async () => {
  const db = admin.firestore(), d = istDate()
  for (const doc of (await inProgress()).docs) {
    if (hasUpdate(await db.doc(`updates/${doc.id}_${d}`).get())) continue
    const sup = (await db.doc(`users/${doc.data().supervisorUid}`).get()).data()
    if (sup?.email) await db.collection('mail').add({ to: sup.email, message: {
      subject: `Upload today's update for ${doc.data().name}`,
      html: `<p>Hello ${sup.name}, please upload today's site photos before 5 PM: ${APP_URL}</p>` } })
  }
})

// 5 PM: flag projects with no update as delayed (red for admin, client and supervisor).
exports.markDelays = onSchedule(sched('0 17 * * *'), async () => {
  const db = admin.firestore(), d = istDate()
  for (const doc of (await inProgress()).docs)
    if (!hasUpdate(await db.doc(`updates/${doc.id}_${d}`).get())) await doc.ref.update({ delayedDate: d })
})

// 6 PM: send the daily report to client and admin. Template "daily_update":
// {{1}} name, {{2}} project, {{3}} summary, {{4}} link
exports.dailyReport = onSchedule(sched('0 18 * * *'), async () => {
  const db = admin.firestore(), d = istDate()
  for (const doc of (await inProgress()).docs) {
    const p = doc.data(), ref = db.doc(`updates/${doc.id}_${d}`), u = await ref.get()
    const done = hasUpdate(u)
    const text = done ? `Today's work: ${u.data().note || 'see the photos in the app'}`
      : 'No site update was uploaded today. We have alerted the supervisor.'
    await ref.set({ projectId: doc.id, projectName: p.name, clientUid: p.clientUid, clientName: p.clientName,
      supervisorUid: p.supervisorUid, date: d, reported: true, ...(done ? {} : { status: 'missed', images: [] }) }, { merge: true })
    await wa((await contactOf(doc.id)).clientPhone, 'daily_update', [p.clientName, p.name, text, APP_URL])
    if (ADMIN_PHONE) await wa(ADMIN_PHONE, 'daily_update', ['Admin', p.name, text, APP_URL])
  }
})

// When the supervisor uploads, clear the delay. If the 6 PM report already went out as "missed", send a late update.
exports.onUpdateWritten = onDocumentWritten(opts('updates/{id}'), async (e) => {
  const [a, b] = [e.data.before.data(), e.data.after.data()]
  if (!b || !b.images?.length) return
  await admin.firestore().doc(`projects/${b.projectId}`).update({ delayedDate: admin.firestore.FieldValue.delete() })
  if (a?.status === 'missed' && b.reported && b.status === 'submitted') {
    const text = `Late update: ${b.note || 'see the photos in the app'}`
    await wa((await contactOf(b.projectId)).clientPhone, 'daily_update', [b.clientName, b.projectName, text, APP_URL])
    if (ADMIN_PHONE) await wa(ADMIN_PHONE, 'daily_update', ['Admin', b.projectName, text, APP_URL])
  }
})

// ---- Material requests, blocked work, complaints ----
const LABEL = { material: 'Material request', blocked: 'Work blocked', complaint: 'Complaint' }
const userOf = async (uid) => uid ? (await admin.firestore().doc(`users/${uid}`).get()).data() : null
const mail = (to, subject, html) => to && admin.firestore().collection('mail').add({ to, message: { subject, html } })

// New issue: email the supervisor, WhatsApp the admin, and mark the project as blocked if needed.
// Template "issue_alert": {{1}} name, {{2}} project, {{3}} message
exports.onIssueCreated = onDocumentCreated(opts('issues/{id}'), async (e) => {
  const i = e.data.data(), label = LABEL[i.kind]
  const text = `${label}: ${i.text}${i.reason ? ` (${i.reason})` : ''}`
  await mail((await userOf(i.supervisorUid))?.email, `${label} on ${i.projectName}`, `<p>${text}</p><p>Open the app: ${APP_URL}</p>`)
  if (ADMIN_PHONE) await wa(ADMIN_PHONE, 'issue_alert', ['Admin', i.projectName, text])
  if (i.kind === 'blocked') await admin.firestore().doc(`projects/${i.projectId}`).update({ blockedReason: i.reason })
})

// Resolved: tell the client (complaints) or carpenter (material/blocked); lift the block.
exports.onIssueResolved = onDocumentUpdated(opts('issues/{id}'), async (e) => {
  const [a, i] = [e.data.before.data(), e.data.after.data()]
  if (a.status === 'resolved' || i.status !== 'resolved') return
  const text = `${LABEL[i.kind]} resolved: ${i.resolution}`
  if (i.kind === 'blocked') await admin.firestore().doc(`projects/${i.projectId}`).update({ blockedReason: admin.firestore.FieldValue.delete() })
  if (i.kind === 'complaint') {
    const p = (await admin.firestore().doc(`projects/${i.projectId}`).get()).data()
    await wa((await contactOf(i.projectId)).clientPhone, 'issue_alert', [p.clientName, i.projectName, text])
  } else await mail((await userOf(i.raisedBy))?.email, `Update on ${i.projectName}`, `<p>${text}</p>`)
})

// ================================================================
// INVENTORY PROCUREMENT WORKFLOW
// Existing request path: projects/{projectId}/materialRequests/{requestId}
// New order path: procurementOrders/{orderId}
// Vendor access is message/email only; vendors do not get app accounts.
// ================================================================

const procurementLabel = (value = '') =>
  String(value).replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

const safeText = (value, fallback = 'Not provided') => {
  const text = String(value ?? '').trim()
  return text || fallback
}

const notifyDoc = async (id, payload) => {
  // Deterministic IDs make Firestore-trigger retries idempotent.
  await admin.firestore().doc(`notifications/${id}`).set({
    ...payload,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    read: false,
  }, { merge: true })
}

const projectOf = async (projectId) => {
  if (!projectId) return null
  const snap = await admin.firestore().doc(`projects/${projectId}`).get()
  return snap.exists ? { id: snap.id, ...snap.data() } : null
}

const vendorOf = async (vendorId) => {
  if (!vendorId) return null
  const snap = await admin.firestore().doc(`vendors/${vendorId}`).get()
  return snap.exists ? { id: snap.id, ...snap.data() } : null
}

const sendVendorOrderNotice = async ({ order, orderId, project, vendor }) => {
  const itemName = safeText(order.itemName || order.materialName || order.description, 'Materials order')
  const quantity = `${safeText(order.quantity, '1')} ${safeText(order.unit, 'Nos')}`
  const deliveryDate = safeText(order.expectedDeliveryDate || order.deliveryDate, 'To be confirmed')
  const total = inr(order.totalAmount ?? order.purchaseCost ?? order.amount ?? 0)
  const vendorName = safeText(vendor?.name || order.vendorName, 'Supplier')
  const projectName = safeText(project?.name || project?.projectName || order.projectName, 'Project')
  const phone = vendor?.whatsapp || vendor?.phone || vendor?.mobile || order.vendorPhone
  const email = vendor?.email || order.vendorEmail
  const subject = `Purchase order ${order.orderNumber || orderId} — ${projectName}`
  const html = `<p>Hello ${vendorName},</p>
    <p>North East Interiors has placed a materials order.</p>
    <p><b>Order:</b> ${safeText(order.orderNumber || orderId)}<br>
    <b>Project:</b> ${projectName}<br>
    <b>Item:</b> ${itemName}<br>
    <b>Quantity:</b> ${quantity}<br>
    <b>Order amount:</b> ${total}<br>
    <b>Expected delivery:</b> ${deliveryDate}</p>
    <p>Please reply to confirm the order and delivery schedule. This message is not a vendor portal login.</p>`

  let emailQueued = false
  if (email) {
    try {
      await mail(email, subject, html)
      emailQueued = true
    } catch (error) {
      console.error('Vendor order email could not be queued:', error)
    }
  }

  let whatsappResult = { success: false, error: 'Vendor WhatsApp number is missing', messageId: null }
  if (phone) {
    whatsappResult = await wa(phone, 'inventory_order_notice', [
      vendorName,
      projectName,
      safeText(order.orderNumber || orderId),
      itemName,
      quantity,
      total,
      deliveryDate,
    ])
  }

  await admin.firestore().doc(`procurementOrders/${orderId}`).set({
    vendorNotification: {
      emailQueued,
      whatsappAccepted: !!whatsappResult.success,
      whatsappMessageId: whatsappResult.messageId || null,
      whatsappError: whatsappResult.success ? null : (whatsappResult.error || null),
      attemptedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
  }, { merge: true })

  // A successful API response means accepted by WhatsApp, not confirmed delivered.
  return { emailQueued, whatsappResult }
}

// New carpenter/supervisor material request: notify the assigned supervisor and admin.
exports.onMaterialRequestCreated = onDocumentCreated(
  'projects/{projectId}/materialRequests/{requestId}',
  async (event) => {
    const request = event.data?.data()
    if (!request) return

    const { projectId, requestId } = event.params
    const project = await projectOf(projectId)
    const projectName = safeText(project?.name || request.projectName, 'Project')
    const itemName = safeText(request.itemName, 'Material')
    const requestedBy = safeText(request.requestedByName || request.carpenterName, 'Team member')
    const title = 'New material request'
    const text = `${requestedBy} requested ${request.quantity || ''} ${request.unit || ''} ${itemName} for ${projectName}.`.replace(/\s+/g, ' ').trim()

    await notifyDoc(`material-request-${requestId}-created`, {
      type: 'material_request',
      title,
      text,
      message: text,
      projectId,
      requestId,
      targetRole: 'admin',
      source: 'materialRequests',
    })

    const supervisorUid = request.supervisorUid || project?.supervisorUid
    if (supervisorUid) {
      await notifyDoc(`material-request-${requestId}-supervisor`, {
        type: 'material_request',
        title,
        text,
        message: text,
        projectId,
        requestId,
        targetUid: supervisorUid,
        source: 'materialRequests',
      })
      const supervisor = await userOf(supervisorUid)
      if (supervisor?.email) {
        await mail(supervisor.email, `${title}: ${projectName}`, `<p>${text}</p><p>Review the request in North East Interiors: ${APP_URL}</p>`)
      }
    }
  }
)

// Request review: only notify on a real status transition to avoid repeat notifications.
exports.onMaterialRequestReviewed = onDocumentUpdated(
  'projects/{projectId}/materialRequests/{requestId}',
  async (event) => {
    const before = event.data?.before?.data()
    const after = event.data?.after?.data()
    if (!before || !after || before.status === after.status) return
    if (!['approved', 'rejected'].includes(after.status)) return

    const { projectId, requestId } = event.params
    const project = await projectOf(projectId)
    const projectName = safeText(project?.name || after.projectName, 'Project')
    const itemName = safeText(after.itemName, 'Material')
    const text = `${itemName} request for ${projectName} was ${after.status}.`

    await notifyDoc(`material-request-${requestId}-${after.status}`, {
      type: `material_request_${after.status}`,
      title: `Material request ${after.status}`,
      text,
      message: text,
      projectId,
      requestId,
      targetRole: 'admin',
      source: 'materialRequests',
    })

    const requestedByUid = after.requestedByUid || after.carpenterUid
    if (requestedByUid) {
      await notifyDoc(`material-request-${requestId}-${after.status}-requester`, {
        type: `material_request_${after.status}`,
        title: `Material request ${after.status}`,
        text,
        message: text,
        projectId,
        requestId,
        targetUid: requestedByUid,
        source: 'materialRequests',
      })
      const requester = await userOf(requestedByUid)
      if (requester?.email) {
        await mail(requester.email, `Material request ${after.status}: ${projectName}`, `<p>${text}</p><p>${after.rejectionReason ? `Reason: ${after.rejectionReason}` : ''}</p><p>${APP_URL}</p>`)
      }
    }
  }
)

// Order booked: create an admin in-app notification and contact vendor by email/WhatsApp.
// WhatsApp requires an approved template named inventory_order_notice with 7 body parameters:
// vendor name, project, order number, item, quantity, total amount, expected delivery date.
exports.onProcurementOrderCreated = onDocumentCreated(
  opts('procurementOrders/{orderId}'),
  async (event) => {
    const order = event.data?.data()
    if (!order || !order.projectId || !order.vendorId) {
      console.error('Procurement order is missing projectId or vendorId:', event.params.orderId)
      return
    }

    const orderId = event.params.orderId
    const project = await projectOf(order.projectId)
    const vendor = await vendorOf(order.vendorId)
    const projectName = safeText(project?.name || order.projectName, 'Project')
    const vendorName = safeText(vendor?.name || order.vendorName, 'Vendor')
    const orderNumber = safeText(order.orderNumber || orderId)
    const text = `Purchase order ${orderNumber} booked with ${vendorName} for ${projectName}.`

    await notifyDoc(`procurement-order-${orderId}-created`, {
      type: 'procurement_order',
      title: 'Vendor order booked',
      text,
      message: text,
      projectId: order.projectId,
      orderId,
      targetRole: 'admin',
      source: 'procurementOrders',
    })

    try {
      await sendVendorOrderNotice({ order, orderId, project, vendor })
    } catch (error) {
      console.error('Procurement vendor notification failed:', error)
      await admin.firestore().doc(`procurementOrders/${orderId}`).set({
        vendorNotification: {
          attemptedAt: admin.firestore.FieldValue.serverTimestamp(),
          error: error.message || 'Vendor notification failed',
        },
      }, { merge: true })
    }

    const supervisorUid = project?.supervisorUid
    if (supervisorUid) {
      await notifyDoc(`procurement-order-${orderId}-supervisor`, {
        type: 'procurement_order',
        title: 'Vendor order booked',
        text,
        message: text,
        projectId: order.projectId,
        orderId,
        targetUid: supervisorUid,
        source: 'procurementOrders',
      })
    }
  }
)

// Delivery/order updates: notify admin only when the meaningful status changes.
exports.onProcurementOrderUpdated = onDocumentUpdated(
  'procurementOrders/{orderId}',
  async (event) => {
    const before = event.data?.before?.data()
    const after = event.data?.after?.data()
    if (!before || !after) return

    const changed = ['status', 'deliveryStatus', 'deliveredQuantity', 'paymentStatus']
      .some((field) => before[field] !== after[field])
    if (!changed) return

    const { orderId } = event.params
    const projectName = safeText(after.projectName || (await projectOf(after.projectId))?.name, 'Project')
    const status = safeText(after.deliveryStatus || after.status, 'updated')
    const eventKey = `${status}-${String(after.deliveredQuantity ?? '')}-${String(after.paymentStatus ?? '')}`
      .replace(/[^a-zA-Z0-9_-]/g, '-')
    const text = `Order ${safeText(after.orderNumber || orderId)} for ${projectName} updated: ${status}.`

    await notifyDoc(`procurement-order-${orderId}-update-${eventKey}`, {
      type: 'procurement_order_update',
      title: 'Procurement order updated',
      text,
      message: text,
      projectId: after.projectId || null,
      orderId,
      targetRole: 'admin',
      source: 'procurementOrders',
    })
  }
)

// Vendor invoice created: notify admin; invoice file itself should be stored in Storage
// and the document should retain invoiceUrl, invoiceNumber, amount, orderId and projectId.
exports.onVendorInvoiceCreated = onDocumentCreated(
  'vendorInvoices/{invoiceId}',
  async (event) => {
    const invoice = event.data?.data()
    if (!invoice) return
    const invoiceId = event.params.invoiceId
    const project = await projectOf(invoice.projectId)
    const vendor = await vendorOf(invoice.vendorId)
    const text = `Invoice ${safeText(invoice.invoiceNumber || invoice.invoiceNo || invoiceId)} received from ${safeText(vendor?.name || invoice.vendorName, 'vendor')} for ${safeText(project?.name || invoice.projectName, 'project')} (${inr(invoice.amount || invoice.totalAmount || 0)}).`
    await notifyDoc(`vendor-invoice-${invoiceId}-created`, {
      type: 'vendor_invoice',
      title: 'Vendor invoice recorded',
      text,
      message: text,
      projectId: invoice.projectId || null,
      invoiceId,
      targetRole: 'admin',
      source: 'vendorInvoices',
    })
  }
)
