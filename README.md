# 🐧 LinuxBot V1 — Virtual VPS in Discord

LinuxBot V1 is a Discord bot that provides each Discord user with an isolated **virtual Linux VPS**.

It includes:

- Virtual filesystem
- Terminal
- apt package manager simulation
- users and permissions
- process manager
- server create/delete/list
- File Manager buttons
- upload/write/read/delete file operations
- per-user server isolation
- persistent JSON storage
- safe command parser (no host shell execution)

## Important

This version does NOT execute Linux shell commands on the host.

Commands such as `rm`, `apt`, `service`, etc. operate on the virtual Linux state only.

A future real-container backend can replace the virtual engine, but must enforce CPU/RAM/disk/network/time limits and a dedicated sandbox.

## Setup

Requirements: Node.js 20+

```bash
npm install
```

Copy `.env.example` to `.env` and fill:

```env
DISCORD_TOKEN=your_bot_token
CLIENT_ID=your_application_id
GUILD_ID=your_test_server_id
ADMIN_ROLE_ID=
```

Register commands:

```bash
npm run register
```

Start:

```bash
npm run dev
```

Windows: use `install.bat`, then `start.bat`.

## Discord commands

### Server

```text
/server create <name>
/server list
/server use <name>
/server delete <name>
/server info
```

### Terminal

```text
/terminal
/terminal command:ls
/terminal command:mkdir myproject
/terminal command:cd myproject
/terminal command:touch index.js
/terminal command:echo hello > index.js
/terminal command:cat index.js
```

### Packages

```text
apt update
apt install nginx
apt install nodejs
apt install python3
apt remove nginx
apt list
```

### Users / permissions

```text
whoami
users
id
useradd alice
userdel alice
chmod 755 file
chown alice file
```

### Processes

```text
ps
top
kill 42
service nginx status
service nginx start
service nginx stop
service nginx restart
```

### Files

```text
/files
/read <path>
/write <path> <content>
/delete <path>
```

The File Manager also provides buttons for common operations.

## Architecture

```text
Discord
   │
   ▼
LinuxBot
   │
   ├── Server Manager
   ├── Terminal
   ├── File Manager
   ├── Package Manager
   ├── User/Permission Manager
   └── Process Manager
          │
          ▼
   Virtual Linux State
   per Discord user
```

## Data isolation

Each Discord user has their own virtual servers:

```text
data/
  users.json
```

Each server has its own filesystem, users, packages and processes.

## Real Linux containers

The V1 code intentionally does not call Docker, bash, PowerShell or child_process.

For a real-container implementation, use a separate sandbox backend with:

- one container per server
- non-root container user
- CPU/RAM/PID limits
- disk quota
- network disabled by default
- command timeout
- syscall/security profile
- container lifecycle manager
- audit log

## 🚀 GitHub Actions — กด Run เพื่อเปิด Bot

มี workflow พร้อมใช้งานที่ `.github/workflows/linuxbot.yml`

1. อัปโหลดโปรเจกต์ขึ้น GitHub
2. เพิ่ม GitHub Secrets: `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID` และ `ADMIN_ROLE_ID` (ถ้ามี)
3. ไปที่ **Actions → 🐧 LinuxBot — Run → Run workflow**
4. เมื่อขั้นตอน `Start LinuxBot` กำลังทำงาน Bot จะออนไลน์

อ่านคู่มือเต็มได้ที่ `GITHUB-RUN.md`

> GitHub Actions runner เป็นเครื่องชั่วคราว วิธีนี้เหมาะสำหรับทดสอบ/เปิดชั่วคราว หากต้องการ 24/7 และเก็บข้อมูลถาวร ควรใช้ VPS/Cloud + database/volume
