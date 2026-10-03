import type { VNode, VirtualServer } from "./types.js";
import { saveUsers } from "./storage.js";

const MAX = 1800;

function directory(node: VNode) {
  if (node.type !== "dir") throw new Error("Not a directory");
  return node;
}

function normalize(parts: string[]) {
  const out: string[] = [];
  for (const p of parts) {
    if (!p || p === ".") continue;
    if (p === "..") out.pop(); else out.push(p);
  }
  return out;
}

function pathOf(server: VirtualServer, input?: string) {
  if (!input || input === "~") return ["home", "user"];
  if (input === "/") return [];
  if (input.startsWith("/")) return normalize(input.split("/"));
  if (input.startsWith("~/")) return normalize(["home", "user", ...input.slice(2).split("/")]);
  return normalize([...server.cwd, ...input.split("/")]);
}

function resolve(server: VirtualServer, input?: string): VNode | null {
  let node: VNode = server.root;
  for (const p of pathOf(server, input)) {
    if (node.type !== "dir") return null;
    node = node.children[p];
    if (!node) return null;
  }
  return node;
}

function parent(server: VirtualServer, input: string) {
  const parts = pathOf(server, input);
  const name = parts.pop();
  if (!name) throw new Error("Invalid path");
  let node: VNode = server.root;
  for (const p of parts) {
    if (node.type !== "dir" || !node.children[p]) throw new Error("No such directory");
    node = node.children[p];
  }
  return { parent: directory(node), name, full: parts };
}

function abs(parts: string[]) { return "/" + parts.join("/"); }
function prompt(server: VirtualServer) { return `${server.currentUser}@${server.hostname}:${abs(server.cwd)}$`; }

function tokens(input: string) {
  const r = /"([^"]*)"|'([^']*)'|(\\S+)/g;
  const out: string[] = []; let m: RegExpExecArray | null;
  while ((m = r.exec(input))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

function requireAdmin(server: VirtualServer) {
  if (!server.users.find(u => u.username === server.currentUser)?.admin)
    throw new Error("Permission denied");
}

function clone(n: VNode): VNode {
  return n.type === "file"
    ? { ...n }
    : { type: "dir", children: Object.fromEntries(Object.entries(n.children).map(([k,v]) => [k, clone(v)])) };
}

const available = ["nginx","nodejs","python3","git","curl","wget","nano","vim","htop","docker"];

export function runCommand(server: VirtualServer, raw: string) {
  const args = tokens(raw.trim());
  if (!args.length) return "";
  const cmd = args.shift()!.toLowerCase();

  try {
    let out = "";
    switch (cmd) {
      case "help":
        out = [
          "FILE: ls cd pwd mkdir rmdir touch cat echo rm cp mv tree",
          "SYSTEM: whoami users id hostname uname date",
          "PKG: apt update | apt list | apt install <pkg> | apt remove <pkg>",
          "PROC: ps top kill <pid>",
          "SERVICE: service <name> status|start|stop|restart",
          "USER: useradd <name> | userdel <name> | chmod <mode> <file> | chown <user> <file>",
          "OTHER: clear help"
        ].join("\\n");
        break;

      case "pwd": out = abs(server.cwd); break;
      case "whoami": out = server.currentUser; break;
      case "users": out = server.users.map(u => u.username).join(" "); break;
      case "id": {
        const u = server.users.find(x => x.username === server.currentUser)!;
        out = `uid=${u.uid}(${u.username}) gid=${u.uid}(${u.username})`;
        break;
      }
      case "hostname": out = server.hostname; break;
      case "uname": out = args.includes("-a") ? `Linux ${server.hostname} 6.8.0-linuxbot x86_64 GNU/Linux` : "Linux"; break;
      case "date": out = new Date().toString(); break;
      case "clear": out = "\u0000CLEAR\u0000"; break;

      case "ls": {
        const n = resolve(server, args[0]);
        if (!n) throw new Error(`No such file or directory: ${args[0] ?? "."}`);
        out = n.type === "file" ? (args[0] ?? "") : (Object.keys(n.children).sort().join("  ") || "(empty)");
        break;
      }

      case "cd": {
        const target = args[0] ?? "~";
        const n = resolve(server, target);
        if (!n || n.type !== "dir") throw new Error(`Not a directory: ${target}`);
        server.cwd = pathOf(server, target);
        out = abs(server.cwd);
        break;
      }

      case "mkdir": {
        const target = args[0]; if (!target) throw new Error("usage: mkdir <dir>");
        const p = parent(server, target);
        if (p.parent.children[p.name]) throw new Error("File exists");
        p.parent.children[p.name] = { type: "dir", children: {} };
        out = `Directory created: ${abs([...p.full,p.name])}`; break;
      }

      case "rmdir": {
        const target = args[0]; if (!target) throw new Error("usage: rmdir <dir>");
        const p = parent(server,target); const n=p.parent.children[p.name];
        if (!n || n.type !== "dir") throw new Error("Not a directory");
        if (Object.keys(n.children).length) throw new Error("Directory not empty");
        delete p.parent.children[p.name]; out = `Directory removed: ${target}`; break;
      }

      case "touch": {
        const target=args[0]; if(!target) throw new Error("usage: touch <file>");
        const p=parent(server,target);
        if(!p.parent.children[p.name]) p.parent.children[p.name]={type:"file",content:"",owner:server.currentUser,mode:644};
        out=`Created: ${target}`; break;
      }

      case "cat": {
        const target=args[0]; if(!target) throw new Error("usage: cat <file>");
        const n=resolve(server,target); if(!n || n.type!=="file") throw new Error(`No such file: ${target}`);
        out=n.content || "(empty)"; break;
      }

      case "echo": {
        const idx=args.indexOf(">");
        if(idx>=0) {
          const text=args.slice(0,idx).join(" "), target=args[idx+1];
          if(!target) throw new Error("usage: echo text > file");
          const p=parent(server,target); p.parent.children[p.name]={type:"file",content:text+"\\n",owner:server.currentUser,mode:644};
        } else out=args.join(" ");
        break;
      }

      case "rm": {
        const target=args[0]; if(!target) throw new Error("usage: rm <path>");
        const p=parent(server,target); if(!p.parent.children[p.name]) throw new Error("No such file");
        delete p.parent.children[p.name]; out=`Removed: ${target}`; break;
      }

      case "cp": {
        const [src,dest]=args; if(!src||!dest) throw new Error("usage: cp <src> <dest>");
        const n=resolve(server,src); if(!n) throw new Error("Source not found");
        const p=parent(server,dest); if(p.parent.children[p.name]) throw new Error("Destination exists");
        p.parent.children[p.name]=clone(n); out=`Copied: ${src} -> ${dest}`; break;
      }

      case "mv": {
        const [src,dest]=args; if(!src||!dest) throw new Error("usage: mv <src> <dest>");
        const n=resolve(server,src); if(!n) throw new Error("Source not found");
        const sp=parent(server,src), dp=parent(server,dest);
        if(dp.parent.children[dp.name]) throw new Error("Destination exists");
        dp.parent.children[dp.name]=n; delete sp.parent.children[sp.name];
        out=`Moved: ${src} -> ${dest}`; break;
      }

      case "tree": {
        const n=resolve(server,args[0]); if(!n) throw new Error("Path not found");
        const lines:string[]=[];
        const walk=(x:VNode,prefix:string,name:string)=>{
          lines.push(prefix+name+(x.type==="dir"?"/":""));
          if(x.type==="dir") Object.keys(x.children).sort().forEach(k=>walk(x.children[k],prefix+"  ",k));
        };
        walk(n,"",args[0]??"."); out=lines.join("\\n"); break;
      }

      case "apt": {
        const sub=args.shift();
        if(sub==="update") { server.packages.updatedAt=new Date().toISOString(); out="Fetched virtual package lists.\\n✓ Done"; }
        else if(sub==="list") out=available.map(x=>`${server.packages.installed.includes(x)?"[installed] ":"[available] "}${x}`).join("\\n");
        else if(sub==="install") {
          const p=args[0]; if(!p) throw new Error("usage: apt install <package>");
          if(!available.includes(p)) throw new Error(`E: Unable to locate package ${p}`);
          if(!server.packages.installed.includes(p)) server.packages.installed.push(p);
          out=`Installing ${p}...\\n✓ ${p} installed`;
          if(["nginx","nodejs","python3"].includes(p) && !server.processes.some(x=>x.name===p))
            server.processes.push({pid:Math.floor(100+Math.random()*8000),name:p,owner:"root",status:"stopped"});
        } else if(sub==="remove") {
          const p=args[0]; if(!p) throw new Error("usage: apt remove <package>");
          server.packages.installed=server.packages.installed.filter(x=>x!==p); out=`✓ ${p} removed`;
        } else throw new Error("usage: apt update|list|install|remove");
        break;
      }

      case "ps":
      case "top":
        out=["PID\\tSTATUS\\tUSER\\tPROCESS",...server.processes.map(p=>`${p.pid}\\t${p.status}\\t${p.owner}\\t${p.name}`)].join("\\n"); break;

      case "kill": {
        const pid=Number(args[0]); const p=server.processes.find(x=>x.pid===pid);
        if(!p) throw new Error("No such process");
        p.status="stopped"; out=`Killed process ${pid} (${p.name})`; break;
      }

      case "service": {
        const [name,action]=args; if(!name||!action) throw new Error("usage: service <name> status|start|stop|restart");
        let p=server.processes.find(x=>x.name===name);
        if(!p) { if(!server.packages.installed.includes(name)) throw new Error(`Unit ${name} not found`); p={pid:Math.floor(100+Math.random()*8000),name,owner:"root",status:"stopped"}; server.processes.push(p); }
        if(action==="status") out=`${name}: ${p.status}`;
        else if(action==="start"||action==="restart") { p.status="running"; out=`✓ ${name} started`; }
        else if(action==="stop") { p.status="stopped"; out=`✓ ${name} stopped`; }
        else throw new Error("Unknown service action");
        break;
      }

      case "useradd": {
        requireAdmin(server); const name=args[0]; if(!name) throw new Error("usage: useradd <name>");
        if(server.users.some(u=>u.username===name)) throw new Error("User exists");
        const uid=Math.max(...server.users.map(u=>u.uid))+1;
        server.users.push({username:name,uid,admin:false,home:`/home/${name}`});
        const home=resolve(server,"/home"); if(home?.type==="dir") home.children[name]={type:"dir",children:{}};
        out=`✓ User ${name} created`; break;
      }

      case "userdel": {
        requireAdmin(server); const name=args[0]; if(!name||name==="root"||name==="user") throw new Error("Cannot delete this user");
        server.users=server.users.filter(u=>u.username!==name); out=`✓ User ${name} deleted`; break;
      }

      case "chmod": {
        const [mode,target]=args; if(!mode||!target) throw new Error("usage: chmod <mode> <file>");
        const n=resolve(server,target); if(!n) throw new Error("Path not found");
        if(n.type==="file") n.mode=Number(mode); out=`Mode changed to ${mode}`; break;
      }

      case "chown": {
        requireAdmin(server); const [owner,target]=args; if(!owner||!target) throw new Error("usage: chown <user> <file>");
        if(!server.users.some(u=>u.username===owner)) throw new Error("Unknown user");
        const n=resolve(server,target); if(!n) throw new Error("Path not found");
        if(n.type==="file") n.owner=owner; out=`Owner changed to ${owner}`; break;
      }

      default: throw new Error(`command not found: ${cmd}`);
    }

    saveUsers(); return out.length>MAX ? out.slice(0,MAX-30)+"\\n... truncated" : out;
  } catch(e) {
    return `bash: ${e instanceof Error ? e.message : String(e)}`;
  }
}
