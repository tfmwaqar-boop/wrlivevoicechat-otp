const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT) || 3000;

let FROM = process.env.EMAIL_FROM || "Voice Chat <no-reply@example.com>";

function smtpConfig() {
  const cfgPath = path.join(__dirname, "smtp.json");

  if (fs.existsSync(cfgPath)) {
    console.log("EMAIL: using credentials from smtp.json (Gmail SMTP)");
    return JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  }

  const cfg = {
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT) || 465,
    secure: process.env.SMTP_SECURE !== "false",
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
  };

  if (!cfg.user || !cfg.pass) return null;

  console.log("EMAIL: using Gmail SMTP from environment variables");
  return cfg;
}

let transporter = null;

let resendKey = process.env.RESEND_API_KEY || "";
let sendgridKey = process.env.SENDGRID_API_KEY || "";
let sendgridFrom = process.env.SENDGRID_FROM || "";

if (resendKey) {
  console.log("EMAIL: using Resend API");
} else if (sendgridKey) {
  console.log("EMAIL: using SendGrid API");
} else {
  const smtp = smtpConfig();

  if (!smtp) {
    console.error(
      "EMAIL: no provider configured. Set RESEND_API_KEY or SENDGRID_API_KEY, " +
      "or SMTP_USER/SMTP_PASS env vars (or create backend/smtp.json)."
    );
    process.exit(1);
  }

  FROM = `"Voice Chat" <${smtp.user}>`;

  const nodemailer = require("nodemailer");

  transporter = nodemailer.createTransport({
    host: smtp.host,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: smtp.user,
      pass: smtp.pass,
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
  });
}

async function sendEmail(to, subject, text) {
  if (resendKey) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to,
        subject,
        text,
      }),
    });

    if (!res.ok) {
      throw new Error(
        "Resend API " + res.status + ": " + (await res.text())
      );
    }

    return;
  }

  if (sendgridKey) {
    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sendgridKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [
          {
            to: [{ email: to }],
          },
        ],
        from: {
          email: sendgridFrom,
        },
        subject,
        content: [
          {
            type: "text/plain",
            value: text,
          },
        ],
      }),
    });

    if (!res.ok) {
      throw new Error(
        "SendGrid API " + res.status + ": " + (await res.text())
      );
    }

    return;
  }

  await transporter.sendMail({
    from: FROM,
    to,
    subject,
    text,
  });
}

const codes = new Map();

const app = express();

app.use(express.json());
app.use(cors());

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/send-otp", (req, res) => {
  const email = String(
    (req.body && req.body.email) || ""
  ).trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({
      error: "invalid email",
    });
  }

  const code = String(crypto.randomInt(100000, 1000000));

  codes.set(email, {
    code,
    expires: Date.now() + 10 * 60 * 1000,
  });

  sendEmail(
    email,
    "Your verification code",
    "Your Voice Chat verification code is: " +
      code +
      "\n\nIt expires in 10 minutes."
  )
    .then(() => {
      console.log("Code sent to", email);
      res.json({ ok: true });
    })
    .catch((err) => {
      console.error("Email send failed:", err.message);
      codes.delete(email);

      res.status(502).json({
        error: "email send failed",
      });
    });
});

app.post("/verify-otp", (req, res) => {
  const email = String(
    (req.body && req.body.email) || ""
  ).trim().toLowerCase();

  const code = String(
    (req.body && req.body.code) || ""
  ).trim();

  const entry = codes.get(email);

  if (!entry || Date.now() > entry.expires) {
    codes.delete(email);

    return res.status(400).json({
      error: "expired or not requested",
    });
  }

  if (entry.code !== code) {
    return res.status(400).json({
      error: "invalid code",
    });
  }

  codes.delete(email);

  res.json({
    ok: true,
  });
});

app.listen(PORT, () => {
  console.log("OTP server running on port " + PORT);
});
