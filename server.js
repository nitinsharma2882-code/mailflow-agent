const express    = require('express')
const nodemailer = require('nodemailer')
const crypto     = require('crypto')
const fs         = require('fs')
const app        = express()

app.use(express.json({ limit: '50mb' }))

// Auth token — set via environment variable AGENT_TOKEN
const AGENT_TOKEN = process.env.AGENT_TOKEN || 'mailflow-agent-2026'

// Active jobs
const activeJobs = new Map()

// Auth middleware
function requireToken(req, res, next) {
  const token = req.headers['x-agent-token']
  if (token !== AGENT_TOKEN) return res.status(401).json({ error: 'Unauthorized' })
  next()
}

// Health check
app.get('/health', (req, res) => {
  res.json({
    status:   'ok',
    version:  '1.0.0',
    jobs:     activeJobs.size,
    uptime:   process.uptime(),
    ip:       req.socket.localAddress
  })
})

// SMTP provider detection
function getSmtpConfig(email) {
  const domain = (email || '').split('@')[1]?.toLowerCase() || ''
  const configs = {
    'gmail.com':      { host: 'smtp.gmail.com',        port: 587 },
    'googlemail.com': { host: 'smtp.gmail.com',        port: 587 },
    'outlook.com':    { host: 'smtp-mail.outlook.com', port: 587 },
    'hotmail.com':    { host: 'smtp-mail.outlook.com', port: 587 },
    'yahoo.com':      { host: 'smtp.mail.yahoo.com',   port: 587 },
    'icloud.com':     { host: 'smtp.mail.me.com',      port: 587 },
    'zoho.com':       { host: 'smtp.zoho.com',         port: 587 },
  }
  return configs[domain] || { host: 'smtp.' + domain, port: 587 }
}

// Parse SMTP CSV
function parseSmtpCsv(csvText) {
  const lines = csvText.split('\n').map(l => l.trim()).filter(l => l.length > 0)
  const accounts = []
  for (const line of lines) {
    if (line.toLowerCase().startsWith('email,')) continue
    const parts = line.split(',')
    if (parts.length < 2) continue
    if (parts[0].includes('@')) {
      const email    = parts[0].trim()
      const password = parts.slice(1).join(',').trim().replace(/^"|"$/g, '')
      const config   = getSmtpConfig(email)
      accounts.push({ email, password, ...config })
    }
  }
  return accounts
}

// Send one email
async function sendEmail(smtp, mailOptions) {
  const transporter = nodemailer.createTransport({
    host:              smtp.host,
    port:              smtp.port || 587,
    secure:            false,
    requireTLS:        true,
    auth:              { user: smtp.email, pass: smtp.password },
    connectionTimeout: 15000,
    greetingTimeout:   10000,
    socketTimeout:     15000,
    tls:               { rejectUnauthorized: false, minVersion: 'TLSv1' },
  })
  const result = await transporter.sendMail(mailOptions)
  transporter.close()
  if (result.rejected && result.rejected.length > 0) {
    throw new Error('Recipient rejected: ' + result.rejected.join(', '))
  }
  return result
}

// START CAMPAIGN
app.post('/send', requireToken, async (req, res) => {
  const {
    jobId,
    contacts,    // array of { email, name, address, unique_id }
    subject,
    fromName,
    htmlBody,
    textBody,
    smtpCsv,     // CSV text: email,app_password
    smtpList,    // or array of { email, password, host, port }
  } = req.body

  if (!jobId)    return res.status(400).json({ error: 'jobId required' })
  if (!contacts || contacts.length === 0) return res.status(400).json({ error: 'contacts required' })
  if (!subject)  return res.status(400).json({ error: 'subject required' })
  if (!htmlBody) return res.status(400).json({ error: 'htmlBody required' })

  // Parse SMTP accounts
  let smtpAccounts = []
  if (smtpCsv)  smtpAccounts = parseSmtpCsv(smtpCsv)
  if (smtpList) smtpAccounts = smtpList

  if (smtpAccounts.length === 0) {
    return res.status(400).json({ error: 'No SMTP accounts provided' })
  }

  // Create job
  const job = {
    id:        jobId,
    status:    'running',
    total:     contacts.length,
    sent:      0,
    failed:    0,
    errors:    [],
    startedAt: new Date().toISOString(),
    stoppedAt: null,
  }
  activeJobs.set(jobId, job)

  // Respond immediately — processing happens in background
  res.json({ success: true, jobId, total: contacts.length, message: 'Job started' })

  // Process in background
  setImmediate(async () => {
    let smtpIndex = 0

    for (let i = 0; i < contacts.length; i++) {
      if (job.status === 'stopped') break

      const contact   = contacts[i]
      const smtp      = smtpAccounts[smtpIndex % smtpAccounts.length]
      smtpIndex++

      // Merge template tags
      const personalHtml = htmlBody
        .replace(/\{\{name\}\}/gi,  contact.name    || '')
        .replace(/\{\{email\}\}/gi, contact.email   || '')
        .replace(/\{\{st\}\}/gi,    contact.address || '')
        .replace(/\{\{id\}\}/gi,    contact.unique_id || '')
        .replace(/\{\{[^}]+\}\}/g,  '')

      const personalSubject = subject
        .replace(/\{\{name\}\}/gi,  contact.name    || '')
        .replace(/\{\{email\}\}/gi, contact.email   || '')
        .replace(/\{\{[^}]+\}\}/g,  '')

      const fromAddress = fromName
        ? fromName + ' <' + smtp.email + '>'
        : smtp.email

      try {
        await sendEmail(smtp, {
          from:    fromAddress,
          to:      contact.email,
          subject: personalSubject,
          html:    personalHtml,
          text:    textBody || personalHtml.replace(/<[^>]+>/g, ''),
        })
        job.sent++
        console.log('[Agent] ✅ Sent to', contact.email, '(' + job.sent + '/' + job.total + ')')
      } catch (err) {
        job.failed++
        job.errors.push({ email: contact.email, error: err.message })
        console.log('[Agent] ❌ Failed:', contact.email, err.message)
      }

      // Small delay between sends
      await new Promise(r => setTimeout(r, 150))
    }

    job.status    = 'completed'
    job.stoppedAt = new Date().toISOString()
    console.log('[Agent] Job', jobId, 'completed. Sent:', job.sent, 'Failed:', job.failed)
  })
})

// GET JOB STATUS
app.get('/status/:jobId', requireToken, (req, res) => {
  const job = activeJobs.get(req.params.jobId)
  if (!job) return res.status(404).json({ error: 'Job not found' })
  res.json(job)
})

// STOP JOB
app.post('/stop/:jobId', requireToken, (req, res) => {
  const job = activeJobs.get(req.params.jobId)
  if (!job) return res.status(404).json({ error: 'Job not found' })
  job.status    = 'stopped'
  job.stoppedAt = new Date().toISOString()
  res.json({ success: true, message: 'Job stopped' })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 Mailflow Agent v1.0 running on port', PORT)
  console.log('   Token:', AGENT_TOKEN)
})
