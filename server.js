const express=require('express'),nodemailer=require('nodemailer'),app=express()
app.use(express.json({limit:'50mb'}))
const TOKEN=process.env.AGENT_TOKEN||'mailflow-agent-2026'
const jobs=new Map()
function auth(req,res,next){if(req.headers['x-agent-token']!==TOKEN)return res.status(401).json({error:'Unauthorized'});next()}
app.get('/health',(req,res)=>res.json({status:'ok',version:'1.0.0',jobs:jobs.size,uptime:process.uptime()}))
function getSMTP(email){const d=(email||'').split('@')[1]?.toLowerCase()||'';const c={'gmail.com':{host:'smtp.gmail.com',port:587},'googlemail.com':{host:'smtp.gmail.com',port:587},'outlook.com':{host:'smtp-mail.outlook.com',port:587},'hotmail.com':{host:'smtp-mail.outlook.com',port:587},'yahoo.com':{host:'smtp.mail.yahoo.com',port:587},'yahoo.co.in':{host:'smtp.mail.yahoo.com',port:587},'icloud.com':{host:'smtp.mail.me.com',port:587},'me.com':{host:'smtp.mail.me.com',port:587}};return c[d]||{host:'smtp.'+d,port:587}}
function parseCSV(csv){const lines=csv.split('\n').map(function(l){return l.trim()}).filter(function(l){return l.length>0});var accounts=[];for(var i=0;i<lines.length;i++){var line=lines[i];if(line.toLowerCase().startsWith('email,'))continue;var parts=line.split(',');if(parts.length<2||!parts[0].includes('@'))continue;var email=parts[0].trim();var password=parts.slice(1).join(',').trim().replace(/^"|"$/g,'');var cfg=getSMTP(email);accounts.push({email:email,password:password,host:cfg.host,port:cfg.port})}return accounts}
function buildAttachments(raw){if(!raw||!Array.isArray(raw)||raw.length===0)return [];var out=[];for(var i=0;i<raw.length;i++){var a=raw[i];try{var content=a.content||a.data||'';var filename=a.filename||a.name||('attachment'+(i+1));var contentType=a.contentType||a.mimeType||'application/octet-stream';if(!content||content.length<10){console.log('[Agent] Skipping empty attachment:',filename);continue;}out.push({filename:filename,content:Buffer.from(content,'base64'),contentType:contentType});}catch(e){console.log('[Agent] Attachment error:',e.message);}}console.log('[Agent] Built',out.length,'attachments for nodemailer');return out;}
async function sendOne(smtp,opts){var t=nodemailer.createTransport({host:smtp.host,port:smtp.port||587,secure:false,requireTLS:true,auth:{user:smtp.email,pass:smtp.password},connectionTimeout:15000,greetingTimeout:10000,socketTimeout:15000,tls:{rejectUnauthorized:false}});var r=await t.sendMail(opts);t.close();return r}
app.post('/send',auth,async function(req,res){var jobId=req.body.jobId,contacts=req.body.contacts,subject=req.body.subject,fromName=req.body.fromName,htmlBody=req.body.htmlBody,textBody=req.body.textBody,smtpCsv=req.body.smtpCsv,smtpList=req.body.smtpList,rawAttachments=req.body.rawAttachments||req.body.attachments||[];console.log('[Agent] Job received:',jobId,'contacts:',contacts&&contacts.length,'attachments:',rawAttachments.length);if(!jobId||!contacts||!subject||!htmlBody)return res.status(400).json({error:'Missing required fields'});var smtps=smtpCsv?parseCSV(smtpCsv):(smtpList||[]);if(smtps.length===0)return res.status(400).json({error:'No SMTP accounts'});var jobAttachments=buildAttachments(rawAttachments);var job={id:jobId,status:'running',total:contacts.length,sent:0,failed:0,errors:[],startedAt:new Date().toISOString()};jobs.set(jobId,job);res.json({success:true,jobId:jobId,total:contacts.length});setImmediate(async function(){var si=0;for(var i=0;i<contacts.length;i++){if(job.status==='stopped')break;var c=contacts[i];var smtp=smtps[si%smtps.length];si++;var html=(htmlBody||'').replace(/\{\{name\}\}/gi,c.name||'').replace(/\{\{email\}\}/gi,c.email||'').replace(/\{\{st\}\}/gi,c.address||'').replace(/\{\{id\}\}/gi,c.unique_id||'').replace(/\{\{[^}]+\}\}/g,'');var subj=(subject||'').replace(/\{\{name\}\}/gi,c.name||'').replace(/\{\{email\}\}/gi,c.email||'').replace(/\{\{[^}]+\}\}/g,'');var from=fromName?fromName+' <'+smtp.email+'>':smtp.email;var mailOpts={from:from,to:c.email,subject:subj,html:html,text:textBody||html.replace(/<[^>]+>/g,'')};if(jobAttachments.length>0)mailOpts.attachments=jobAttachments;try{await sendOne(smtp,mailOpts);job.sent++}catch(e){job.failed++;job.errors.push({email:c.email,error:e.message})}await new Promise(function(r){setTimeout(r,150)})}job.status='completed';job.stoppedAt=new Date().toISOString()})})
app.get('/status/:id',auth,function(req,res){var j=jobs.get(req.params.id);if(!j)return res.status(404).json({error:'Not found'});res.json(j)})
app.post('/stop/:id',auth,function(req,res){var j=jobs.get(req.params.id);if(!j)return res.status(404).json({error:'Not found'});j.status='stopped';j.stoppedAt=new Date().toISOString();res.json({success:true})})

app.post('/auth-gmail', auth, async function(req, res) {
  const { email, password, clientId, clientSecret, projectId, accountId, callbackUrl } = req.body

  if (!email || !password || !clientId || !clientSecret) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  res.json({ success: true, message: 'Authentication started', accountId })

  // Run in background
  setImmediate(async function() {
    let browser = null
    try {
      console.log('[Gmail Auth] Starting Puppeteer auth for:', email)

      const puppeteer = require('puppeteer')

      // Launch fresh browser with no cached data
      browser = await puppeteer.launch({
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--incognito'
        ],
        // Fresh user data dir each time
        userDataDir: '/tmp/puppeteer-' + Date.now()
      })

      const page = await browser.newPage()

      // Set viewport
      await page.setViewport({ width: 1280, height: 800 })

      // Build OAuth URL
      const scope = encodeURIComponent('https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email')
      const redirectUri = encodeURIComponent('http://localhost:8765/callback')
      const authUrl = 'https://accounts.google.com/o/oauth2/auth' +
        '?response_type=code' +
        '&client_id=' + clientId +
        '&redirect_uri=' + redirectUri +
        '&scope=' + scope +
        '&access_type=offline' +
        '&prompt=consent'

      console.log('[Gmail Auth] Opening OAuth URL for:', email)
      await page.goto(authUrl, { waitUntil: 'networkidle2', timeout: 60000 })
      await page.waitForTimeout(3000)

      // Step 2 - Enter email with multiple selector fallbacks
      const emailSelectors = [
        'input[type="email"]',
        'input[name="identifier"]',
        'input[id="identifierId"]',
        '#identifierId'
      ]
      let emailInput = null
      for (const selector of emailSelectors) {
        try {
          await page.waitForSelector(selector, { timeout: 5000 })
          emailInput = await page.$(selector)
          if (emailInput) { console.log('[Gmail Auth] Found email input:', selector); break }
        } catch(e) {}
      }
      if (!emailInput) throw new Error('Could not find email input field')
      await emailInput.click()
      await emailInput.type(email, { delay: 100 })
      await page.waitForTimeout(1000)

      // Click Next button
      const nextSelectors = ['#identifierNext', 'button[type="button"]', '.VfPpkd-LgbsSe']
      for (const sel of nextSelectors) {
        try {
          const btn = await page.$(sel)
          if (btn) { await btn.click(); break }
        } catch(e) {}
      }
      await page.waitForTimeout(3000)

      // Step 3 - Enter password with multiple selector fallbacks
      const passSelectors = [
        'input[type="password"]',
        'input[name="password"]',
        'input[name="Passwd"]'
      ]
      let passInput = null
      for (const selector of passSelectors) {
        try {
          await page.waitForSelector(selector, { timeout: 8000 })
          passInput = await page.$(selector)
          if (passInput) { console.log('[Gmail Auth] Found password input:', selector); break }
        } catch(e) {}
      }
      if (!passInput) throw new Error('Could not find password input field')
      await passInput.click()
      await passInput.type(password, { delay: 100 })
      await page.waitForTimeout(1000)

      // Click Next/Sign in button
      const signInSelectors = ['#passwordNext', 'button[type="button"]', '.VfPpkd-LgbsSe']
      for (const sel of signInSelectors) {
        try {
          const btn = await page.$(sel)
          if (btn) { await btn.click(); break }
        } catch(e) {}
      }
      await page.waitForTimeout(5000)

      // Step 4 - Check for phone/challenge verification
      const currentUrl = page.url()
      console.log('[Gmail Auth] After login URL:', currentUrl)
      const pageContent = await page.content()

      if (currentUrl.includes('challenge') ||
          currentUrl.includes('phone') ||
          pageContent.includes('phone') ||
          pageContent.includes('verify') ||
          pageContent.includes('Verify')) {
        console.log('[Gmail Auth] Phone/challenge verification required for:', email)
        await browser.close()
        browser = null
        await notifyLicenseServer(accountId, 'needs_phone', 'Phone verification required')
        return
      }

      // Check if on consent screen
      if (currentUrl.includes('accounts.google.com/o/oauth2')) {
        // Click Allow button
        try {
          await page.waitForSelector('button', { timeout: 5000 })
          const buttons = await page.$$('button')
          for (const btn of buttons) {
            const text = await btn.evaluate(el => el.textContent)
            if (text.includes('Allow') || text.includes('Continue')) {
              await btn.click()
              await page.waitForTimeout(2000)
              break
            }
          }
        } catch(e) {
          console.log('[Gmail Auth] Could not find Allow button:', e.message)
        }
      }

      // Wait for redirect to localhost callback
      await page.waitForFunction(
        () => window.location.href.includes('localhost:8765'),
        { timeout: 15000 }
      ).catch(() => {})

      const finalUrl = page.url()
      console.log('[Gmail Auth] Final URL:', finalUrl)

      // Extract code from URL
      const urlParams = new URL(finalUrl.replace('http://localhost:8765/callback', 'http://localhost:8765/callback'))
      const code = urlParams.searchParams.get('code')

      if (!code) {
        throw new Error('No auth code received. Final URL: ' + finalUrl)
      }

      console.log('[Gmail Auth] Got auth code, exchanging for tokens...')

      // Exchange code for tokens
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code:          code,
          client_id:     clientId,
          client_secret: clientSecret,
          redirect_uri:  'http://localhost:8765/callback',
          grant_type:    'authorization_code'
        }).toString()
      })

      const tokenData = await tokenRes.json()

      if (tokenData.error) {
        throw new Error('Token exchange failed: ' + tokenData.error)
      }

      console.log('[Gmail Auth] Tokens received for:', email)

      // Save tokens to license server
      await notifyLicenseServer(accountId, 'ready', null, {
        accessToken:  tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        tokenExpiry:  Date.now() + (tokenData.expires_in || 3600) * 1000
      })

      console.log('[Gmail Auth] Successfully authenticated:', email)

    } catch(err) {
      console.log('[Gmail Auth] Error for', email, ':', err.message)
      await notifyLicenseServer(accountId, 'failed', err.message)
    } finally {
      if (browser) {
        await browser.close().catch(() => {})
      }
    }
  })
})

// Helper to notify license server of auth result
async function notifyLicenseServer(accountId, status, notes, tokens) {
  try {
    const LICENSE_SERVER = process.env.LICENSE_SERVER_URL || 'https://mailflow-license-server-production.up.railway.app'

    if (status === 'ready' && tokens) {
      await fetch(LICENSE_SERVER + '/api/admin/gmail-pool/' + accountId + '/save-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-key': 'mailflow-admin-2026' },
        body: JSON.stringify(tokens)
      })
    } else {
      await fetch(LICENSE_SERVER + '/api/admin/gmail-pool/' + accountId + '/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-key': 'mailflow-admin-2026' },
        body: JSON.stringify({ status, notes: notes || '' })
      })
    }
    console.log('[Gmail Auth] Notified license server:', status, 'for account:', accountId)
  } catch(e) {
    console.log('[Gmail Auth] Failed to notify license server:', e.message)
  }
}

app.listen(process.env.PORT||3000,'0.0.0.0',function(){console.log('Mailflow Agent ready on port '+(process.env.PORT||3000))})
