#!/bin/bash
apt-get update -y
apt-get install -y curl git nodejs npm
npm install -g pm2
mkdir -p /opt/mailflow-agent
cd /opt/mailflow-agent
npm install express nodemailer
cat > server.js << 'EOF'
PASTE FULL server.js content here
EOF
pm2 start server.js --name mailflow-agent
pm2 startup systemd -u root --hp /root
pm2 save
echo "Mailflow Agent Ready" > /tmp/agent-ready.txt
