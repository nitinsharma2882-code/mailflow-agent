#!/bin/bash
echo "🚀 Installing Mailflow Agent..."

# Update system
apt-get update -y
apt-get install -y curl git

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Install PM2 for auto-restart
npm install -g pm2

# Create agent directory
mkdir -p /opt/mailflow-agent
cd /opt/mailflow-agent

# Download agent files
cat > server.js << 'AGENTEOF'
PASTE THE ENTIRE server.js CONTENT HERE
AGENTEOF

cat > package.json << 'PKGEOF'
{
  "name": "mailflow-agent",
  "version": "1.0.0",
  "main": "server.js",
  "dependencies": { "express": "^4.18.2", "nodemailer": "^6.9.13" }
}
PKGEOF

# Install dependencies
npm install

# Start with PM2
pm2 start server.js --name mailflow-agent
pm2 startup
pm2 save

echo "✅ Mailflow Agent installed and running on port 3000"
echo "   Token: mailflow-agent-2026"
