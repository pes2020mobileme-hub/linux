import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS, type Migration } from "./migrations.js";

export const DEFAULT_DB_FILE="data/linuxbot.db";

export type Db=DatabaseSync;

export function openDatabase(file:string=process.env.DATABASE_FILE??DEFAULT_DB_FILE){
 if(file!==":memory:") fs.mkdirSync(path.dirname(path.resolve(file)),{recursive:true});
 const db=new DatabaseSync(file);
 if(file!==":memory:") db.exec("PRAGMA journal_mode = WAL");
 db.exec("PRAGMA foreign_keys = ON");
 return db;
}

const HISTORY_SQL="CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)";

function appliedVersions(db:Db){
 db.exec(HISTORY_SQL);
 return db.prepare("SELECT version FROM schema_migrations").all().map(r=>Number((r as {version:unknown}).version));
}

export type MigrationResult={ applied:string[]; skipped:string[] };

export function runMigrations(db:Db,migrations:Migration[]=MIGRATIONS):MigrationResult{
 const done=new Set(appliedVersions(db));
 const result:MigrationResult={applied:[],skipped:[]};
 for(const m of migrations){
  const label=`${String(m.version).padStart(3,"0")}_${m.name}`;
  if(done.has(m.version)){result.skipped.push(label);continue;}
  db.exec("BEGIN");
  try{
   db.exec(m.sql);
   db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(m.version,m.name,new Date().toISOString());
   db.exec("COMMIT");
   result.applied.push(label);
  }catch(e){
   db.exec("ROLLBACK");
   throw new Error(`migration ${label} ล้มเหลวและถูกย้อนกลับแล้ว: ${e instanceof Error?e.message:String(e)}`);
  }
 }
 return result;
}

export function migrationHistory(db:Db){
 db.exec(HISTORY_SQL);
 return db.prepare("SELECT version, name, applied_at FROM schema_migrations ORDER BY version").all();
}

export function rollbackLast(db:Db,migrations:Migration[]=MIGRATIONS){
 db.exec(HISTORY_SQL);
 const rows=db.prepare("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1").all();
 if(!rows.length) throw new Error("ไม่มี migration ที่จะย้อนกลับ");
 const version=Number((rows[0] as {version:unknown}).version);
 const target=migrations.find(m=>m.version===version);
 if(!target) throw new Error(`ไม่พบ migration เวอร์ชัน ${version} ใน source code`);
db.exec("BEGIN");
  try{
   db.exec(target.down);
   db.prepare("DELETE FROM schema_migrations WHERE version = ?").run(version);
   db.exec("COMMIT");
  }catch(e){
  db.exec("ROLLBACK");
  throw new Error(`ย้อนกลับ ${target.name} ล้มเหลวและถูกย้อนกลับแล้ว: ${e instanceof Error?e.message:String(e)}`);
 }
 return `${String(version).padStart(3,"0")}_${target.name}`;
}

export function tableNames(db:Db){
 return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .map(r=>String((r as {name:unknown}).name));
}

export function checkDatabase(db:Db){
 try{
  const rows=tableNames(db);
  const migrated=appliedVersions(db).length;
  return {state:"PASS" as const,detail:`เชื่อมต่อได้ · ${rows.length} ตาราง · migration ${migrated} เวอร์ชัน`};
 }catch(e){
  return {state:"FAIL" as const,detail:e instanceof Error?e.message:String(e)};
 }
}