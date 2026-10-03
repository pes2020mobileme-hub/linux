import crypto from "node:crypto";

export type PluginPermission="read_settings"|"write_settings"|"register_command"|"register_event"|"register_route"|"register_model";

export const PLUGIN_PERMISSIONS:PluginPermission[]=["read_settings","write_settings","register_command","register_event","register_route","register_model"];

export type PluginManifest={
 name:string; version:string; author:string; description:string;
 permissions:PluginPermission[];
 dependencies:string[];
 commands:{name:string;description:string}[];
 events:string[];
 routes:{method:string;path:string}[];
};

export type ValidationResult={ ok:boolean; errors:string[]; manifest?:PluginManifest };

const SEMVER=/^\d+\.\d+\.\d+$/;
const PLUGIN_NAME=/^[a-z0-9][a-z0-9-]{1,39}$/;

export function validateManifest(raw:unknown):ValidationResult{
 const errors:string[]=[];
 const m=raw as Partial<PluginManifest>|null;
 if(!m||typeof m!=="object") return {ok:false,errors:["manifest ไม่ใช่ object"]};
 if(typeof m.name!=="string"||!PLUGIN_NAME.test(m.name)) errors.push("name ต้องเป็นตัวอักษรเล็ก a-z 0-9 และ - ความยาว 2-40");
 if(typeof m.version!=="string"||!SEMVER.test(m.version)) errors.push("version ต้องเป็น semver เช่น 1.0.0");
 if(typeof m.author!=="string"||!m.author.trim()) errors.push("author ห้ามว่าง");
 if(typeof m.description!=="string"||!m.description.trim()) errors.push("description ห้ามว่าง");
 if(!Array.isArray(m.permissions)) errors.push("permissions ต้องเป็น array");
 else{
  const bad=m.permissions.filter(p=>!PLUGIN_PERMISSIONS.includes(p as PluginPermission));
  if(bad.length) errors.push(`permission ไม่ถูกต้อง: ${bad.join(", ")}`);
 }
 if(m.permissions?.includes("write_settings")&&!m.permissions.includes("read_settings")) errors.push("write_settings ต้องมี read_settings ด้วย");
 if(!Array.isArray(m.dependencies)) errors.push("dependencies ต้องเป็น array");
 if(!Array.isArray(m.commands)) errors.push("commands ต้องเป็น array");
 else{
  const names=m.commands.map(c=>String(c?.name??""));
  if(names.some(n=>!PLUGIN_NAME.test(n.replace(/^\//,"")))) errors.push("ชื่อคำสั่งไม่ถูกต้อง");
  if(new Set(names).size!==names.length) errors.push("ชื่อคำสั่งซ้ำกันภายใน plugin");
 }
 if(!Array.isArray(m.events)) errors.push("events ต้องเป็น array");
 if(!Array.isArray(m.routes)) errors.push("routes ต้องเป็น array");
 else if(m.routes.some(r=>!/^(GET|POST|PUT|PATCH|DELETE)$/.test(String(r?.method))||!String(r?.path??"").startsWith("/"))) errors.push("route ต้องมี method ที่ถูกต้องและ path ขึ้นต้นด้วย /");
 if(errors.length) return {ok:false,errors};
 return {ok:true,errors:[],manifest:m as PluginManifest};
}

export type PluginApi={
 name:string;
 registerCommand:(name:string,description:string,handler:(...args:unknown[])=>unknown)=>void;
 registerEvent:(event:string,handler:(...args:unknown[])=>unknown)=>void;
 registerRoute:(method:string,path:string,handler:(...args:unknown[])=>unknown)=>void;
 registerDatabaseModel:(name:string,definition:unknown)=>void;
 getSetting:(key:string)=>string|null;
 setSetting:(key:string,value:string|null)=>void;
};

export type RegisteredPlugin={ manifest:PluginManifest; commands:string[]; events:string[]; routes:string[]; models:string[] };

export type RegistryState={
 plugins:Map<string,RegisteredPlugin>;
 commands:Map<string,{plugin:string;handler:(...args:unknown[])=>unknown}>;
 events:Map<string,Array<{plugin:string;handler:(...args:unknown[])=>unknown}>>;
 routes:Map<string,{plugin:string;method:string;handler:(...args:unknown[])=>unknown}>;
 models:Map<string,{plugin:string;definition:unknown}>;
 settings:Map<string,Map<string,string|null>>;
 enabled:Set<string>;
};

export function createRegistry():RegistryState{
 return {plugins:new Map(),commands:new Map(),events:new Map(),routes:new Map(),models:new Map(),settings:new Map(),enabled:new Set()};
}

const SECRET_KEYS=["DISCORD_TOKEN","DISCORD_CLIENT_SECRET","OPENROUTER_API_KEY","SESSION_SECRET","ENCRYPTION_KEY","INTERNAL_API_SECRET","COOKIE_SECRET","WEBHOOK_SIGNING_SECRET","BACKUP_ENCRYPTION_KEY"];

export function install(registry:RegistryState,raw:unknown):ValidationResult{
 const check=validateManifest(raw);
 if(!check.ok||!check.manifest) return check;
 const manifest=check.manifest;
 if(registry.plugins.has(manifest.name)) return {ok:false,errors:[`plugin ${manifest.name} ติดตั้งอยู่แล้ว`]};
 const missing=manifest.dependencies.filter(d=>!registry.plugins.has(d));
 if(missing.length) return {ok:false,errors:[`ขาด dependency: ${missing.join(", ")}`]};

 const entry:RegisteredPlugin={manifest,commands:[],events:[],routes:[],models:[]};
 const api:PluginApi={
  name:manifest.name,
  registerCommand:(name,description,handler)=>{
   if(!manifest.permissions.includes("register_command")) throw new Error(`${manifest.name} ไม่มีสิทธิ์ register_command`);
   if(registry.commands.has(name)) throw new Error(`คำสั่ง ${name} ถูกจองไว้แล้ว`);
   registry.commands.set(name,{plugin:manifest.name,handler});
   entry.commands.push(name);
  },
  registerEvent:(event,handler)=>{
   if(!manifest.permissions.includes("register_event")) throw new Error(`${manifest.name} ไม่มีสิทธิ์ register_event`);
   const list=registry.events.get(event)??[];
   list.push({plugin:manifest.name,handler});
   registry.events.set(event,list);
   entry.events.push(event);
  },
  registerRoute:(method,path,handler)=>{
   if(!manifest.permissions.includes("register_route")) throw new Error(`${manifest.name} ไม่มีสิทธิ์ register_route`);
   const key=`${method} ${path}`;
   if(registry.routes.has(key)) throw new Error(`route ${key} ถูกจองไว้แล้ว`);
   registry.routes.set(key,{plugin:manifest.name,method,handler});
   entry.routes.push(path);
  },
  registerDatabaseModel:(name,definition)=>{
   if(!manifest.permissions.includes("register_model")) throw new Error(`${manifest.name} ไม่มีสิทธิ์ register_model`);
   if(registry.models.has(name)) throw new Error(`model ${name} ถูกจองไว้แล้ว`);
   registry.models.set(name,{plugin:manifest.name,definition});
   entry.models.push(name);
  },
  getSetting:(key)=>{
   if(!manifest.permissions.includes("read_settings")) throw new Error(`${manifest.name} ไม่มีสิทธิ์ read_settings`);
   if(isSecretKey(key)) throw new Error("plugin อ่าน secret โดยตรงไม่ได้");
   return registry.settings.get(manifest.name)?.get(key)??null;
  },
  setSetting:(key,value)=>{
   if(!manifest.permissions.includes("write_settings")) throw new Error(`${manifest.name} ไม่มีสิทธิ์ write_settings`);
   if(isSecretKey(key)) throw new Error("plugin เขียน secret ไม่ได้");
   const map=registry.settings.get(manifest.name)??new Map<string,string|null>();
   map.set(key,value);
   registry.settings.set(manifest.name,map);
  }
 };
 Object.freeze(api);
 (registry.plugins as Map<string,unknown>).set(manifest.name,{...entry,api});
 return check;
}

export function isSecretKey(key:string){
 return SECRET_KEYS.indexOf(key)>=0||/SECRET|TOKEN|PASSWORD|API_KEY/i.test(key);
}

export function enable(registry:RegistryState,name:string){
 if(!registry.plugins.has(name)) throw new Error(`ไม่พบ plugin ${name}`);
 registry.enabled.add(name);
}

export function disable(registry:RegistryState,name:string){
 registry.enabled.delete(name);
}

export function uninstall(registry:RegistryState,name:string){
 const entry=registry.plugins.get(name) as (RegisteredPlugin & {api:PluginApi})|undefined;
 if(!entry) throw new Error(`ไม่พบ plugin ${name}`);
 for(const c of entry.commands) registry.commands.delete(c);
 for(const e of entry.events){
  const list=(registry.events.get(e)??[]).filter(x=>x.plugin!==name);
  if(list.length) registry.events.set(e,list); else registry.events.delete(e);
 }
 for(const r of entry.routes){
  const route=registry.routes.get(r);
  if(route) registry.routes.delete(`${route.method} ${r}`);
 }
 for(const m of entry.models) registry.models.delete(m);
 registry.settings.delete(name);
 registry.enabled.delete(name);
 registry.plugins.delete(name);
}

export function manifestOf(registry:RegistryState,name:string){
 return registry.plugins.get(name)?.manifest??null;
}

export function securityReport(registry:RegistryState){
 const issues:string[]=[];
 for(const p of registry.plugins.values()){
  if(p.manifest.permissions.includes("register_route")&&p.routes.length>5) issues.push(`${p.manifest.name} ลงทะเบียน route มากผิดปกติ (${p.routes.length})`);
  if(p.manifest.permissions.length>=PLUGIN_PERMISSIONS.length) issues.push(`${p.manifest.name} ขอสิทธิ์ครบทุกตัว ควรตรวจสอบก่อนใช้`);
 }
 return issues;
}

export function fingerprint(manifest:PluginManifest){
 return crypto.createHash("sha256").update(JSON.stringify(manifest),"utf8").digest("hex").slice(0,16);
}
