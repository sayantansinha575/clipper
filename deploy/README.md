# AI Shorts Studio — GitHub to Ubuntu 24.04 GCP VM Deployment Guide

## Credentials Needed (Zero-Budget Friendly)

| Credential | Required? | Purpose | Cost |
| :--- | :--- | :--- | :--- |
| **GitHub Repo / PAT** | Only if private repo | `git clone` onto your GCP VM (public repos need no token) | Free |
| **Ollama (`qwen3.5:4b`)** | Optional (Recommended for $0 budget) | Runs clip selection locally or on your second VM (`OLLAMA_BASE_URL`) | **$0** |
| **Gemini API Key** | Optional | Free-tier cloud selection & audio transcription; auto-falls back to Ollama on `429` | **$0** (Free tier) |
| **`ADMIN_API_KEY`** | Optional | Protects settings/delete endpoints if exposed publicly | **$0** |
| **Domain + Certbot** | Optional | Free HTTPS via Let's Encrypt if binding a domain | **$0** |

> **Zero-cost setup**: With `AI_PROVIDER=ollama_only` (or `gemini_with_ollama_fallback`) + local `faster-whisper` (`small`, `cpu`, `int8`, `4` threads) + FFmpeg, you can process videos with **no paid API keys or subscriptions**.

---

## Connecting Your Second VM Running Ollama (`qwen3.5:4b`)

### Option A: Same GCP VPC (Fastest, Internal IP — Zero Egress Cost)
1. On your **Ollama VM**, bind Ollama to the internal interface:
   ```bash
   sudo systemctl edit ollama
   # Add under [Service]:
   # Environment="OLLAMA_HOST=0.0.0.0:11434"
   sudo systemctl restart ollama
   ```
2. In GCP VPC Firewall, allow TCP `11434` **only** from your `e2-standard-4` VM's internal IP (never `0.0.0.0/0`).
3. Set `OLLAMA_BASE_URL=http://<OLLAMA_VM_INTERNAL_IP>:11434` and `OLLAMA_MODEL=qwen3.5:4b` in `.env` (or in **Settings** in the UI) and click **Test Ollama Connection**.

### Option B: Different Cloud / Home PC (SSH Tunnel — Zero Firewall Changes)
From your `e2-standard-4` VM, forward port `11434` securely over SSH:
```bash
ssh -f -N -L 11434:127.0.0.1:11434 user@YOUR_OLLAMA_HOST
```
Then leave `OLLAMA_BASE_URL=http://127.0.0.1:11434` in `.env`.

---

## Deploy From GitHub on Ubuntu 24.04 (`e2-standard-4`, AMD Rome)

1. **Clone from GitHub**:
   ```bash
   sudo mkdir -p /opt/ai-shorts-studio && sudo chown $USER:$USER /opt/ai-shorts-studio
   git clone https://github.com/<YOUR_USER>/<YOUR_REPO>.git /opt/ai-shorts-studio
   cd /opt/ai-shorts-studio
   ```
2. **Configure `.env`**:
   ```bash
   cp .env.example .env
   nano .env
   # Set AI_PROVIDER=gemini_with_ollama_fallback (or ollama_only)
   # Set OLLAMA_BASE_URL=http://<OLLAMA_IP>:11434
   # Set OLLAMA_MODEL=qwen3.5:4b
   # Optionally set GEMINI_API_KEY=...
   ```
3. **Install & Build** (reuses existing system FFmpeg):
   ```bash
   chmod +x deploy/scripts/*.sh
   ./deploy/scripts/install.sh
   ```
4. **Start with systemd**:
   ```bash
   sudo cp deploy/systemd/ai-shorts-studio.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now ai-shorts-studio
   ```
5. **Configure Nginx & Free HTTPS (Optional)**:
   ```bash
   sudo cp deploy/nginx/ai-shorts-studio.conf /etc/nginx/sites-available/ai-shorts-studio
   sudo ln -s /etc/nginx/sites-available/ai-shorts-studio /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot --nginx -d shorts.yourdomain.com
   ```
6. **Updating later from GitHub**:
   ```bash
   cd /opt/ai-shorts-studio && git pull && npm install && npm run build
   sudo systemctl restart ai-shorts-studio
   ```
