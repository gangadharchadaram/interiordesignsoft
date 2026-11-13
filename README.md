# North East Interiors: project workflow software

A web app for an interior design business. The owner (admin) sends quotations, the client approves and pays, and the supervisor and carpenter run the site. WhatsApp and email alerts go out at every step.

**Stack:** React (Vite) frontend, Firebase (Authentication, Firestore, Storage, Cloud Functions, Hosting), WhatsApp Business Cloud API for messages, and the "Trigger Email from Firestore" extension for emails.

## Product scope and SaaS readiness

The current deployment is a single-business workspace. It supports custom read/write roles, team accounts, project quotations and approval, staff assignment, daily updates, material requests, vendor orders and delivery/spend tracking, and payment plans with recorded payment methods and outstanding balances. Team and client welcome emails send a Firebase password setup link; they do not expose a generated password.

The current app is **not yet a multi-business SaaS**. It uses shared top-level collections (`users`, `roles`, `projects`, `payments`, and `vendors`), one Firebase Authentication project, one configured `APP_URL`, and North East Interiors branding in the interface and messages. Do not create separate design-business accounts in this deployment: the current Firestore rules do not partition records by business.

Before allowing founders to self-register, implement the SaaS foundation as one coordinated change:

1. Create a `companies/{companyId}` record with business name, unique URL slug, logo/brand settings, contact details, timezone, currency, and setup state. The first authenticated owner becomes the company admin.
2. Add a required `companyId` to users, roles, projects, payments, vendors, procurement orders, notifications, and related records. Scope every query, callable function, email/WhatsApp message, and Storage path by that ID.
3. Enforce tenant membership and role permissions in Firestore/Storage rules and Cloud Functions. Never rely on a hidden UI or URL slug to protect another company's data.
4. Add a company-aware sign-in/onboarding route and branding. A URL such as `business-name.software-name.in` also requires control of the parent domain, wildcard DNS, TLS certificate support, and hosting/proxy configuration; changing the app alone cannot create or secure arbitrary subdomains.
5. Decide how one email can belong to multiple companies. Firebase Auth accounts are global to the Firebase project, so a person should be able to join multiple company workspaces without duplicating credentials.
6. Migrate existing North East Interiors records into a default company, then verify all role paths and rules before opening registration.

For client-facing product improvements, industry products commonly bring proposals, project updates, invoices/payments, selections, files, and order tracking into one client dashboard. A useful next product layer for this app is a project timeline with milestones, decisions awaiting client approval, change orders, and a searchable communication/activity history. These should be linked to the same project record so clients and the site team see one current status rather than separate disconnected updates.

## Who does what

| Role          | Can do                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------- |
| Admin (owner) | Create projects and quotations, assign team, request and record payments, see delays, requests and complaints |
| Client        | View quotation, approve, upload payment screenshots, see daily updates and invoices, raise complaints         |
| Supervisor    | Upload daily site photos, see material requests and blocked work, resolve issues after a site visit           |
| Carpenter     | Request material by text or voice, block work with a reason                                                   |

## Daily schedule (India time)

| Time    | What happens                                           |
| ------- | ------------------------------------------------------ |
| 4:30 PM | Supervisors who have not uploaded get a reminder email |
| 5:00 PM | Projects with no update are flagged as delayed (red)   |
| 6:00 PM | Daily report goes to client and admin on WhatsApp      |

---

# Part 1: Set up your computer

### Step 1. Install the tools

1. **Node.js 20 LTS** from https://nodejs.org (choose the LTS version). Check it in a terminal: `node -v` should show v20 or higher.
2. **VS Code** from https://code.visualstudio.com.
3. A Google account (the one you will use for Firebase).

### Step 2. Open the project in VS Code

1. Unzip `nei-final.zip`. You get a folder called `nei`.
2. In VS Code choose **File > Open Folder** and pick the `nei` folder.
3. Open the terminal inside VS Code: **Terminal > New Terminal** (shortcut: Ctrl + backtick).
4. Install the app packages:
   ```
   npm install
   ```
5. Install the Firebase command line tool and log in:
   ```
   npm install -g firebase-tools
   firebase login
   ```
   A browser window opens. Sign in with your Google account and allow access.

---

# Part 2: Create the Firebase project

Open https://console.firebase.google.com and sign in.

### Step 3. Create the project

1. Click **Create a project**. Name it, for example, `north-east-interiors`.
2. Google Analytics is not needed. Turn it off and click **Create project**.

### Step 4. Switch to the Blaze plan

Cloud Functions, scheduled jobs and sending WhatsApp messages all need the pay-as-you-go plan. For a small business the monthly cost is usually very low, and there is a free monthly allowance.

1. In the left menu, click **Upgrade** (or the plan name at the bottom left).
2. Choose **Blaze** and add your payment method.
3. Set a **budget alert** (for example, ₹500) so you are warned about any unexpected cost.

### Step 5. Register the web app and get the config

1. On the project home page, click the web icon **`</>`**.
2. Name the app `nei-web`, leave Hosting unticked for now, and click **Register app**.
3. Firebase shows a block of code with `apiKey`, `authDomain`, `projectId`, `storageBucket` and `appId`. Keep this page open.
4. In VS Code, in the `nei` folder, copy `.env.example` to a new file called `.env` and fill it in:
   ```
   VITE_FB_API_KEY=...apiKey...
   VITE_FB_AUTH_DOMAIN=...authDomain...
   VITE_FB_PROJECT_ID=...projectId...
   VITE_FB_STORAGE_BUCKET=...storageBucket...
   VITE_FB_APP_ID=...appId...
   VITE_APP_URL=https://YOUR-PROJECT-ID.web.app
   ```
   Do not put quotation marks around the values.

### Step 6. Turn on Authentication

1. Left menu: **Build > Authentication > Get started**.
2. Under **Sign-in method**, click **Email/Password**, switch on the first toggle (Email/Password), and click **Save**.

### Step 7. Create the Firestore database

1. Left menu: **Build > Firestore Database > Create database**.
2. Choose a location close to you, for example **asia-south1 (Mumbai)**. This cannot be changed later.
3. Choose **Start in production mode** and click **Create**. The security rules are deployed from the project later.

### Step 8. Turn on Storage

1. Left menu: **Build > Storage > Get started**.
2. Choose **production mode**, keep the same location, and click **Done**.

### Step 9. Connect VS Code to this Firebase project

In the VS Code terminal:

```
firebase use --add
```

Pick your project from the list, and give it the alias `default`.

### Step 10. Create the first admin login

The admin is created by hand once. Everyone else is created by the app.

1. In the console: **Authentication > Users > Add user**. Enter your email and a password, and click **Add user**.
2. Copy the **User UID** shown in the table (a long text like `k3F9...`).
3. Go to **Firestore Database > Start collection**.
   - Collection ID: `users`
   - Document ID: paste the UID you copied
   - Add these fields (all type **string**):
     - `role` = `admin`
     - `name` = your name
     - `email` = your email
4. Click **Save**. The word `admin` must be lowercase and exact.

### Step 11. Deploy the security rules

```
firebase deploy --only firestore:rules,storage
```

If the tool asks whether to allow Cloud Storage to access Firestore for the rules, answer **Yes**. These rules make sure clients only see their own project and only the admin can see client phone numbers and emails.

---

# Part 3: Email setup (login emails and reminders)

### Step 12. Get an email account for sending

The easiest option is a Gmail account used only for this business.

1. Sign in to that Gmail account, go to **Manage your Google Account > Security**, and turn on **2-Step Verification**.
2. Search for **App passwords**, create one named `nei`, and copy the 16-character password (remove the spaces).

Your SMTP connection text is:

```
smtps://YOUR_GMAIL_ADDRESS:APP_PASSWORD@smtp.gmail.com:465
```

Replace the address and the password. If your address contains `@`, write it as `%40`.

### Step 13. Install the email extension

1. Firebase console: **Build > Extensions**, search for **Trigger Email from Firestore**, and click **Install**.
2. Fill in:
   - **Firestore location:** the same as your database
   - **SMTP connection URI:** the text from Step 12
   - **Email documents collection:** `mail`
   - **Default FROM address:** your Gmail address
3. Finish the install. It takes a few minutes.

---

# Part 4: WhatsApp setup

WhatsApp messages sent by a business must use pre-approved templates. Meta usually approves them in minutes to a day.

### Step 14. Create a Meta app

1. Go to https://developers.facebook.com and log in. Click **My Apps > Create App**.
2. Choose **Business** as the type, name it `North East Interiors`, and finish.
3. On the app dashboard, add the product **WhatsApp** and click **Set up**.
4. Under **WhatsApp > API Setup** you will see:
   - a **test phone number**
   - the **Phone number ID** (copy it)
   - a **temporary access token** (valid 24 hours, for first tests only)
5. While testing, add your own phone number in the **To** box and verify it with the code. Until you go live, WhatsApp only delivers to numbers you have added here.

### Step 15. Get a permanent token

The temporary token expires in 24 hours. For real use:

1. Go to **business.facebook.com > Business settings > Users > System users**, and create a system user with the **Admin** role.
2. Click **Add assets**, choose your WhatsApp app, and give it full control.
3. Click **Generate new token**, select your app, tick `whatsapp_business_messaging` and `whatsapp_business_management`, and copy the token. Store it only in Firebase Secret Manager; never paste it into source files or documentation. If a token was previously committed or shared, revoke it and generate a replacement.

To use your own business number instead of the test number, add it under **WhatsApp > API Setup > Add phone number**.

### Step 16. Create the six message templates

In **WhatsApp Manager > Message templates > Create template**, use category **Utility**, language **English** (this must be plain English, code `en`). Use these names exactly. The `{{1}}` style placeholders must be typed as shown, and Meta will ask for a sample value for each one.

1. **quotation_ready**
   `Hello {{1}}, your quotation from North East Interiors is {{2}}. View details and approve here: {{3}} Thank you.`
2. **project_approved**
   `Good news: the project {{1}} has been approved by {{2}}. Open the app to assign your team.`
3. **payment_request**
   `Hello {{1}}, a payment of {{2}} is due for {{3}}. Please pay and upload the screenshot here: {{4}} Thank you.`
4. **invoice_ready** (add a **Document** header when creating it)
   Body: `Hello {{1}}, we have received your payment of {{2}}. Your invoice {{3}} is attached. Thank you.`
5. **daily_update**
   `Hello {{1}}, site update for {{2}}: {{3}} Full details here: {{4}} Thank you.`
6. **issue_alert**
   `Hello {{1}}, update on {{2}}: {{3}} Please check the app for details.`

Meta rejects templates that start or end with a placeholder, which is why each one has words at both ends. Wait until all six show **Approved**.

---

# Part 5: Connect the functions

### Step 17. Save your WhatsApp keys as secrets

In the VS Code terminal:

```
firebase functions:secrets:set WA_TOKEN
firebase functions:secrets:set WA_PHONE_ID
```

Each command asks you to paste a value. Paste the permanent token for `WA_TOKEN` and the Phone number ID for `WA_PHONE_ID`. If it asks to enable the Secret Manager API, answer **Yes**.

### Step 18. Set the app link and your phone number

Create a new file `functions/.env` with two lines:

```
APP_URL=https://YOUR-PROJECT-ID.web.app
ADMIN_PHONE=919876543210
```

`ADMIN_PHONE` is your own WhatsApp number with the country code and no plus sign or spaces. Your project ID is shown in **Project settings** in the Firebase console.

### Step 19. Install and deploy the functions

```
cd functions
npm install
cd ..
firebase deploy --only functions
```

The first deploy asks to enable some Google Cloud services (Cloud Build, Artifact Registry, Cloud Scheduler). Answer **Yes** to each. If it asks how many days to keep old container images, type `1`. The first deploy takes several minutes.

---

# Part 6: Run and publish the app

### Step 20. Try it on your computer

```
npm run dev
```

Open http://localhost:5173 in your browser and sign in with the admin email and password. If you change `.env`, stop the command with Ctrl + C and run it again.

### Step 21. Publish it online

1. In the console: **Build > Hosting > Get started** and click through the prompts (the project is already set up for it).
2. In VS Code:
   ```
   npm run build
   firebase deploy --only hosting
   ```
3. Your app is live at `https://YOUR-PROJECT-ID.web.app`. Make sure this matches `VITE_APP_URL` in `.env` and `APP_URL` in `functions/.env`. If you changed either, run `npm run build` again and redeploy with `firebase deploy`.

---

# Part 7: First full test

Use your own second email and phone so you can play every role.

1. **Add staff.** Sign in as admin, open the **Team** tab, and add a supervisor and a carpenter using two emails you can open. Each gets an email with a link and password.
2. **Create a project.** Open **New project**. For the client, use another email of yours and your own WhatsApp number (added in Step 14 while testing). Add a few images, sft and rate. Click **Create and send on WhatsApp**.
3. **Client side.** You get a WhatsApp message and a login email. Sign in in a private browser window, and click **Approve quotation**.
4. **Admin.** You get an approval alert. On the project card, choose the supervisor, carpenter and end date, then click **Assign team and start project**.
5. **Payment.** On the card, type an amount and click **Request payment**. As the client, upload any image as the screenshot. As admin, open the **Payments** tab, split the amount (for example, PhonePe 60,000 and Cash 20,000), and click **Update payment and send invoice**. The invoice arrives on WhatsApp.
6. **Site work.** Sign in as supervisor and upload a photo and a note. Sign in as carpenter and send a material request (try the Speak button in Chrome), then try **Block work**.
7. **Complaint.** As client, raise a complaint. As supervisor, mark it resolved with a note.
8. **Schedules.** To test the 5 PM and 6 PM jobs without waiting, go to https://console.cloud.google.com, select your project, open **Cloud Scheduler**, and click **Force run** beside `markDelays` and `dailyReport`.

---

# Everyday use and maintenance

- **Forgot password:** in the console, open **Authentication > Users**, click the three dots beside the user, and choose **Reset password**.
- **See errors:** console **Functions > Logs** shows what happened when a message or email failed.
- **Check email delivery:** open the `mail` collection in Firestore. Each email has a `delivery` field with the result or an error.
- **Update the code:** after changing files run `npm run build` and `firebase deploy`.
- **Keep secrets safe:** `.env` files and the WhatsApp token must never be shared or uploaded to a public place. The `.gitignore` already excludes them.

# Troubleshooting

| Problem                                          | What to check                                                                                                                                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Blank page or Firebase error on start            | `.env` is missing or has a typo. Fix it and restart `npm run dev`                                                                                                                          |
| "Missing or insufficient permissions"            | You did not deploy the rules (Step 11), or the user has no `users` document with a valid `role`                                                                                            |
| Login works but you see "Your … screens" message | The user's `role` value is wrong or missing in the `users` collection                                                                                                                      |
| Team tab says permission denied                  | Your admin `users` document must have `role` exactly `admin`                                                                                                                               |
| No WhatsApp message                              | Check the `whatsappError` fields on the project and the `sendQuotation` function logs. The template may not be approved, the recipient may not be verified on the test-number allowlist, credentials may be invalid, or the phone may be missing its country calling code. |
| Email arrived but no WhatsApp message             | Open the project document in Firestore and check `whatsappError`, `whatsappErrorCode`, and `whatsappHttpStatus`. Then run `firebase functions:log --only sendQuotation --project interiors-e3831` and look for `WhatsApp API rejected request`. Confirm the recipient is verified in the Meta test-number allowlist, the `quotation_ready` template is Approved in English (`en`), and `WA_TOKEN`/`WA_PHONE_ID` are the correct current Meta credentials. The recipient phone must include its country calling code. After changing secrets or function code, redeploy `sendQuotation`; this trigger only runs when the private contact document is first created, so an existing project will not resend automatically. |
| No email                                         | The extension is not installed or the SMTP text is wrong. Check the `delivery` field on the `mail` document                                                                                |
| Neither quotation email nor WhatsApp message     | Confirm `sendQuotation` is deployed with `firebase functions:list --project interiors-e3831`. It triggers only when `projects/{id}/private/contact` is first created. Check `firebase functions:log --only sendQuotation --project interiors-e3831`, then inspect `quotationEmailQueued`, `quotationEmailError`, `quotationPdfError`, and `whatsappError` on the project document. |
| Functions deploy fails                           | The project is not on the Blaze plan, or you skipped the service prompts. Run the command again                                                                                            |
| A page says an index is required                 | Click the link in the browser console message; it opens the exact index to create. Wait a few minutes after creating it                                                                    |
| Voice input does nothing                         | Use Chrome on Android or desktop. Assamese recognition may be weaker than Hindi or English                                                                                                 |

# Project layout

```
src/                 React app (pages for admin, client, staff, updates, issues)
functions/index.js   Cloud Functions: WhatsApp, invoices, staff/client logins, schedules
firestore.rules      Who can read and write what (client contacts are admin-only)
storage.rules        Rules for uploaded images
firebase.json        Firebase deployment settings
```

# Privacy note

Client phone numbers and emails are stored only in `projects/{id}/private/contact`, which only the admin can read. Staff and clients see the client's name only. Projects created with early test versions of this app need to be created again.
