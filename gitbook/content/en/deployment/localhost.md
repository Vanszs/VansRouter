# 🏠 Localhost Deployment

Run VansRouter on your local machine for development and personal use.

---

## 📦 Installation

Install VansRouter globally via npm:

```bash
npm install -g vansrouter
```

**Requirements:**
- Node.js 22.5 or higher
- npm 9 or higher

---

## 🚀 Starting the Server

Start VansRouter with a single command:

```bash
vansrouter
```

The dashboard will automatically open in your browser at `http://localhost:20128/masuk`

**Default Configuration:**
- **Dashboard**: `http://localhost:20128/masuk`
- **API Endpoint**: `http://localhost:20128/v1`
- **Data Directory**: `~/.9router` (macOS/Linux) or `%APPDATA%\9router` (Windows)

---

## 🔧 Configuration

### Custom Data Directory

Set a custom data directory using environment variable:

```bash
DATA_DIR=/path/to/data vansrouter
```

### Custom Port

The application port is `20128` by default. Use `--port` or `PORT` to override it.

---

## 🛑 Stopping the Server

Press `Ctrl+C` in the terminal where VansRouter is running.

```bash
# In the terminal running vansrouter
^C  # Press Ctrl+C
```

The server will gracefully shut down and save all data.

---

## 🔄 Restarting the Server

Simply run the start command again:

```bash
vansrouter
```

All your configurations, API keys, and combos are preserved in the data directory.

---

## 📊 Updating VansRouter

Update to the latest version:

```bash
npm update -g vansrouter
```

Check your current version:

```bash
npm list -g vansrouter
```

---

## 🔍 Troubleshooting

### Port Already in Use

If port 20128 or 3000 is already in use:

```bash
# Find process using the port (macOS/Linux)
lsof -i :20128
lsof -i :3000

# Kill the process
kill -9 <PID>
```

### Permission Errors

If you encounter permission errors during installation:

```bash
# Use sudo (not recommended)
sudo npm install -g vansrouter

# Or fix npm permissions (recommended)
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
```

### Data Directory Issues

If the data directory is not accessible:

```bash
# Check permissions
ls -la ~/.9router

# Fix permissions
chmod 755 ~/.9router
```

---

## 📁 Data Directory Structure

```
~/.9router/
├── db.json           # Main database (providers, combos, settings)
├── logs/             # Application logs
└── cache/            # Temporary cache files
```

**Backup Your Data:**

```bash
# Backup
cp -r ~/.9router ~/.9router.backup

# Restore
cp -r ~/.9router.backup ~/.9router
```

---

## 🔗 Next Steps

- [Connect Providers](/providers/subscription.md)
- [Create Combos](/features/combos.md)
- [Integrate with CLI Tools](/integration/cursor.md)
