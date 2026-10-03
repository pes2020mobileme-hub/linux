import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AUTO_GENERATED_KEYS, ENV_SPECS } from "../config/env.js";

const ENV_PATH=path.resolve(".env");

export function generateSecret(bytes=32){
 return crypto.randomBytes(bytes).toString("hex");
}

export function mask(value:string){
 if(!value) return "(ว่าง)";
 return `•••••••• (${value.length} ตัวอักษร)`;
}

function parseEnv(text:string){
 const out:Record<string,string>={};
 for(const line of text.split(/\r?\n/)){
  const m=/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
  if(m) out[m[1]]=m[2].trim();
 }
 return out;
}

export function readEnvFile(){
 return fs.existsSync(ENV_PATH)?parseEnv(fs.readFileSync(ENV_PATH,"utf8")):{};
}

export function writeEnvFile(values:Record<string,string>){
 fs.writeFileSync(ENV_PATH,Object.entries(values).map(([k,v])=>`${k}=${v}`).join("\n")+"\n","utf8");
 try{fs.chmodSync(ENV_PATH,0o600);}catch{}
}

export function listMissingInternalSecrets(env:NodeJS.ProcessEnv=process.env){
 return AUTO_GENERATED_KEYS.filter(k=>!env[k]);
}

export function ensureInternalSecrets(env:NodeJS.ProcessEnv=process.env){
 const created:string[]=[];
 const missing=listMissingInternalSecrets(env);
 if(!missing.length) return {created,persisted:false};
 const file=readEnvFile();
 for(const key of missing){
  const value=generateSecret();
  env[key]=value;
  file[key]=value;
  created.push(key);
 }
 writeEnvFile(file);
 return {created,persisted:true};
}

export function renderEnvExample(){
 const lines=["# คัดลอกไฟล์นี้เป็น .env แล้วใส่เฉพาะค่าที่ระบบขอ","# ค่าที่ระบบสร้างให้เอง เว้นว่างไว้ได้",""];
 for(const spec of ENV_SPECS){
  lines.push(spec.autoGenerate?`# ${spec.description} — สร้างอัตโนมัติ`:spec.description);
  lines.push(`${spec.key}=`);
  lines.push("");
 }
 return lines.join("\n");
}