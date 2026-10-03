import fs from "node:fs";
import path from "node:path";
import type { UserState, VNode, VirtualServer } from "./types.js";

const DATA_DIR = path.resolve("data");
const FILE = path.join(DATA_DIR, "users.json");
let users: Record<string, UserState> = {};

function initialRoot(): VNode {
  return {
    type: "dir", children: {
      home: { type: "dir", children: {
        user: { type: "dir", children: {} }
      }},
      tmp: { type: "dir", children: {} },
      var: { type: "dir", children: {
        log: { type: "dir", children: {
          "system.log": { type: "file", content: "LinuxBot virtual system started\n", owner: "root", mode: 644 }
        }}
      }},
      etc: { type: "dir", children: {
        "os-release": {
          type: "file",
          content: 'NAME="LinuxBot OS"\nVERSION="1.0"\nID=linuxbot\n',
          owner: "root", mode: 644
        }
      }}
    }
  };
}

export function createServer(name: string): VirtualServer {
  const safe = name.trim().replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 32);
  if (!safe) throw new Error("Invalid server name");

  return {
    name: safe,
    createdAt: new Date().toISOString(),
    root: initialRoot(),
    cwd: ["home", "user"],
    currentUser: "user",
    users: [
      { username: "root", uid: 0, admin: true, home: "/root" },
      { username: "user", uid: 1000, admin: false, home: "/home/user" }
    ],
    processes: [
      { pid: 1, name: "init", owner: "root", status: "running" },
      { pid: 42, name: "systemd", owner: "root", status: "running" }
    ],
    packages: { installed: ["base-files", "bash", "coreutils", "apt"] },
    hostname: safe,
    distro: "LinuxBot OS 1.0"
  };
}

export function loadUsers() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(FILE)) {
    try { users = JSON.parse(fs.readFileSync(FILE, "utf8")); }
    catch { users = {}; }
  }
}

export function saveUsers() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(users, null, 2), "utf8");
}

export function getState(userId: string): UserState {
  if (!users[userId]) users[userId] = { servers: {}, activeServer: null };
  return users[userId];
}

export function getActiveServer(userId: string): VirtualServer {
  const state = getState(userId);
  if (!state.activeServer || !state.servers[state.activeServer]) {
    throw new Error("ยังไม่มี server ที่เลือก ใช้ /server create <name> ก่อน");
  }
  return state.servers[state.activeServer];
}

export function addServer(userId: string, name: string) {
  const state = getState(userId);
  const server = createServer(name);
  if (state.servers[server.name]) throw new Error("Server already exists");
  state.servers[server.name] = server;
  state.activeServer = server.name;
  saveUsers();
  return server;
}

export function useServer(userId: string, name: string) {
  const state = getState(userId);
  if (!state.servers[name]) throw new Error("Server not found");
  state.activeServer = name;
  saveUsers();
  return state.servers[name];
}

export function deleteServer(userId: string, name: string) {
  const state = getState(userId);
  if (!state.servers[name]) throw new Error("Server not found");
  delete state.servers[name];
  if (state.activeServer === name) state.activeServer = Object.keys(state.servers)[0] ?? null;
  saveUsers();
}

export function listServers(userId: string) {
  return Object.values(getState(userId).servers);
}
